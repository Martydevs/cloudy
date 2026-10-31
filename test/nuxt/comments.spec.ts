// US8 — Comentarios: acciones por permiso, edición en línea, borrado con confirmación, hilo con sus
// cuatro estados, publicar y sondeo con `since`; contador en la cuadrícula y la lista.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import type { Comment, FileItem } from '#shared/types/api'
import CommentCount from '~/components/comments/CommentCount.vue'
import CommentItem from '~/components/comments/CommentItem.vue'
import CommentThread from '~/components/comments/CommentThread.vue'
import FileCard from '~/components/files/FileCard.vue'
import FileList from '~/components/files/FileList.vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

// El hilo solo sondea con la pestaña visible y el hilo en pantalla: ambos se controlan desde la prueba.
const view = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { document: ref<DocumentVisibilityState>('visible'), thread: ref(true) }
})
mockNuxtImport('useDocumentVisibility', () => () => view.document)
mockNuxtImport('useElementVisibility', () => () => view.thread)

const F1 = '9b2c1f0e-1d2c-4e5f-8a9b-0c1d2e3f4a5b'
const THREAD = `/api/files/${F1}/comments`

const comment = (changes: Partial<Comment> = {}): Comment => ({
  id: 'c1', body: 'Revisar la diapositiva 3', author: { id: 'u1', name: 'Ana' }, createdAt: '2026-10-14T10:00:00.000Z',
  editedAt: null, canEdit: true, canDelete: true, ...changes,
})

const file = (changes: Partial<FileItem> = {}): FileItem => ({
  id: F1, folderId: null, name: 'guion.pdf', extension: 'pdf', mimeType: 'application/pdf', category: 'document', sizeBytes: 2048,
  hasThumbnail: false, origin: 'team', uploadedBy: { id: 'u1', name: 'Ana' }, guestName: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...changes,
})

const buttons = buttonsWithText

// Los hilos comparten los refs de visibilidad simulados: uno que quede montado sondearía en otra prueba.
enableAutoUnmount(afterEach)
const messages = () => useToast().toasts.value.map(t => t.message)

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  view.document.value = 'visible'
  view.thread.value = true
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CommentItem', () => {
  it('muestra autor, fecha y "(editado)"; las acciones dependen de los permisos', async () => {
    const own = await mountSuspended(CommentItem, { props: { comment: comment({ editedAt: '2026-10-14T11:00:00.000Z' }) } })
    expect(own.text()).toContain('Ana')
    expect(own.text()).toContain('(editado)')
    expect(own.get('time').attributes('datetime')).toBe('2026-10-14T10:00:00.000Z')
    expect(own.find('button[aria-label="Editar comentario de Ana"]').exists()).toBe(true)
    expect(own.find('button[aria-label="Eliminar comentario de Ana"]').exists()).toBe(true)

    const moderated = await mountSuspended(CommentItem, { props: { comment: comment({ canEdit: false }) } })
    expect(moderated.text()).not.toContain('(editado)')
    expect(moderated.find('button[aria-label="Editar comentario de Ana"]').exists()).toBe(false)
    expect(moderated.find('button[aria-label="Eliminar comentario de Ana"]').exists()).toBe(true)

    const foreign = await mountSuspended(CommentItem, { props: { comment: comment({ canEdit: false, canDelete: false }) } })
    expect(foreign.findAll('button')).toHaveLength(0)
  })

  it('edita en línea con contador y validación, y guarda', async () => {
    mockApi('PATCH', '/api/comments/c1', comment({ body: 'Corregido', editedAt: '2026-10-14T11:00:00.000Z' }))
    const wrapper = await mountSuspended(CommentItem, { props: { comment: comment() }, attachTo: document.body })
    await wrapper.get('button[aria-label="Editar comentario de Ana"]').trigger('click')
    await flush()
    const textarea = wrapper.get('textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('Revisar la diapositiva 3')
    expect(document.activeElement).toBe(textarea.element)
    expect(wrapper.text()).toContain('24/2000')

    await textarea.setValue('a'.repeat(2001))
    expect(wrapper.text()).toContain('2001/2000')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('p.text-error').text()).toBe('Debe tener como máximo 2000 caracteres')
    expect(textarea.attributes('aria-invalid')).toBe('true')

    await textarea.setValue('  ')
    await textarea.trigger('blur')
    expect(wrapper.get('p.text-error').text()).toBe('Este campo es obligatorio')
    expect(calls).toHaveLength(0)

    await textarea.setValue(' Corregido ')
    await textarea.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flush()
    expect(calls).toEqual([{ method: 'PATCH', url: '/api/comments/c1', body: { body: 'Corregido' } }])
    expect(wrapper.emitted('updated')?.[0]?.[0]).toMatchObject({ body: 'Corregido' })
    expect(messages()).toContain('Comentario actualizado')
    expect(wrapper.find('textarea').exists()).toBe(false)
    wrapper.unmount()
  })

  it('cancelar (botón o Escape) y guardar sin cambios no llaman a la API', async () => {
    const wrapper = await mountSuspended(CommentItem, { props: { comment: comment() } })
    const edit = () => wrapper.get('button[aria-label="Editar comentario de Ana"]').trigger('click')
    await edit()
    await wrapper.get('textarea').setValue('Otro texto')
    await buttons(wrapper, 'Cancelar')[0]!.trigger('click')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).toContain('Revisar la diapositiva 3')

    await edit()
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('textarea').exists()).toBe(false)

    await edit()
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true })
    await flush()
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('al guardar: 422 en el campo, 404 lo quita del hilo y otros errores avisan con un toast', async () => {
    const wrapper = await mountSuspended(CommentItem, { props: { comment: comment() } })
    await wrapper.get('button[aria-label="Editar comentario de Ana"]').trigger('click')
    await wrapper.get('textarea').setValue('Nuevo')

    mockApi('PATCH', '/api/comments/c1', failWith(422, { errors: { body: 'Texto no permitido' } }))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('p.text-error').text()).toBe('Texto no permitido')
    expect(wrapper.get('textarea').attributes('aria-invalid')).toBe('true')
    // Al corregir el texto se limpia el error del servidor.
    await wrapper.get('textarea').setValue('Nuevo texto')
    expect(wrapper.find('p.text-error').exists()).toBe(false)

    // Un 422 sin errores de campo usa el texto de respaldo.
    mockApi('PATCH', '/api/comments/c1', failWith(422))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('p.text-error').text()).toBe('Revisa el comentario')

    mockApi('PATCH', '/api/comments/c1', failWith(409, undefined, 'El archivo está en la papelera'))
    await wrapper.get('form').trigger('submit')
    await flush()
    // El endpoint simulado no transmite `message` (el servidor real sí): queda el texto de respaldo.
    expect(messages()).toContain('No pudimos guardar el comentario. Inténtalo de nuevo.')
    expect(wrapper.find('textarea').exists()).toBe(true)

    mockApi('PATCH', '/api/comments/c1', failWith(404))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(messages()).toContain('Este comentario ya no existe')
    expect(wrapper.emitted('deleted')).toEqual([['c1']])
  })

  it('borrar pide confirmación: cancelar no hace nada y confirmar elimina', async () => {
    mockApi('DELETE', '/api/comments/c1', null)
    const wrapper = await mountSuspended(CommentItem, { props: { comment: comment() } })
    const remove = () => wrapper.get('button[aria-label="Eliminar comentario de Ana"]').trigger('click')

    await remove()
    await flush()
    expect(useConfirm().options.value).toMatchObject({ title: '¿Eliminar este comentario?', danger: true })
    useConfirm().cancel()
    await flush()
    expect(calls).toHaveLength(0)

    await remove()
    await flush()
    useConfirm().accept()
    await flush()
    expect(calls).toEqual([{ method: 'DELETE', url: '/api/comments/c1', body: undefined }])
    expect(wrapper.emitted('deleted')).toEqual([['c1']])
    expect(messages()).toContain('Comentario eliminado')
  })

  it('un borrado fallido avisa y uno ya borrado (404) se quita', async () => {
    const wrapper = await mountSuspended(CommentItem, { props: { comment: comment() } })
    const removeConfirmed = async () => {
      await wrapper.get('button[aria-label="Eliminar comentario de Ana"]').trigger('click')
      await flush()
      useConfirm().accept()
      await flush()
    }

    mockApi('DELETE', '/api/comments/c1', failWith(500))
    await removeConfirmed()
    expect(messages()).toContain('No pudimos eliminar el comentario. Inténtalo de nuevo.')
    expect(wrapper.emitted('deleted')).toBeUndefined()

    mockApi('DELETE', '/api/comments/c1', failWith(404))
    await removeConfirmed()
    expect(wrapper.emitted('deleted')).toEqual([['c1']])
  })
})

describe('CommentThread · los cuatro estados', () => {
  it('cargando muestra el skeleton', async () => {
    mockApi('GET', THREAD, () => new Promise(() => {}))
    const wrapper = await mountSuspended(CommentThread, { props: { fileId: F1 } })
    await flush()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
  })

  it('vacío invita a comentar', async () => {
    mockApi('GET', THREAD, [])
    const wrapper = await mountSuspended(CommentThread, { props: { fileId: F1 } })
    await flush()
    expect(wrapper.text()).toContain('Sé el primero en comentar')
    expect(wrapper.find('h2 .badge').exists()).toBe(false)
  })

  it('error con reintento', async () => {
    mockApi('GET', THREAD, failWith(500))
    const wrapper = await mountSuspended(CommentThread, { props: { fileId: F1 } })
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar los comentarios.')
    mockApi('GET', THREAD, [comment()])
    await buttons(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Revisar la diapositiva 3')
  })

  it('contenido: lista con el contador; editar y borrar actualizan el hilo', async () => {
    mockApi('GET', THREAD, [comment(), comment({ id: 'c2', body: 'Listo', author: { id: 'u2', name: 'Luis' }, createdAt: '2026-10-14T10:05:00.000Z' })])
    mockApi('PATCH', '/api/comments/c1', comment({ body: 'Corregido', editedAt: '2026-10-14T11:00:00.000Z' }))
    mockApi('DELETE', '/api/comments/c2', null)
    const wrapper = await mountSuspended(CommentThread, { props: { fileId: F1 } })
    await flush()
    expect(wrapper.findAll('ul[aria-label="Comentarios"] > li')).toHaveLength(2)
    expect(wrapper.get('h2 .badge').text()).toBe('2')

    await wrapper.get('button[aria-label="Editar comentario de Ana"]').trigger('click')
    await wrapper.get('li textarea').setValue('Corregido')
    await wrapper.get('li form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Corregido')
    expect(wrapper.text()).toContain('(editado)')

    await wrapper.get('button[aria-label="Eliminar comentario de Luis"]').trigger('click')
    await flush()
    useConfirm().accept()
    await flush()
    expect(wrapper.findAll('ul[aria-label="Comentarios"] > li')).toHaveLength(1)
  })
})

describe('CommentThread · publicar', () => {
  async function mountEmpty() {
    mockApi('GET', THREAD, [])
    const wrapper = await mountSuspended(CommentThread, { props: { fileId: F1 } })
    await flush()
    return wrapper
  }

  it('publica, limpia el campo y muestra el comentario', async () => {
    mockApi('POST', THREAD, comment({ body: 'Hola equipo' }))
    const wrapper = await mountEmpty()
    const textarea = wrapper.get('textarea')
    expect(wrapper.get(`label[for="${textarea.attributes('id')}"]`).text()).toBe('Escribe un comentario')
    await textarea.setValue('  Hola equipo ')
    expect(wrapper.text()).toContain('11/2000')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', url: THREAD, body: { body: 'Hola equipo' } }])
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.text()).toContain('Hola equipo')
    expect(wrapper.text()).not.toContain('Sé el primero en comentar')
    expect(messages()).toContain('Comentario publicado')
  })

  it('valida en línea antes de enviar; salir del campo vacío no marca error', async () => {
    const wrapper = await mountEmpty()
    await wrapper.get('textarea').trigger('blur')
    expect(wrapper.find('p.text-error').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('p.text-error').text()).toBe('Este campo es obligatorio')
    await wrapper.get('textarea').setValue('a'.repeat(2001))
    expect(wrapper.get('p.text-error').text()).toBe('Debe tener como máximo 2000 caracteres')
    expect(wrapper.get('span.text-error').text()).toBe('2001/2000')
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0)
  })

  it('409 explica qué hacer, 422 marca el campo y otros errores avisan en el formulario', async () => {
    const wrapper = await mountEmpty()
    await wrapper.get('textarea').setValue('Hola')

    mockApi('POST', THREAD, failWith(409, undefined, 'El archivo está en la papelera'))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('form [role="alert"]').text()).toContain('Restáuralo desde la Papelera para poder comentar')

    mockApi('POST', THREAD, failWith(422, { errors: { body: 'Texto no permitido' } }))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.find('form [role="alert"]').exists()).toBe(false)
    expect(wrapper.get('p.text-error').text()).toBe('Texto no permitido')
    // Al escribir de nuevo se limpia el error del servidor.
    await wrapper.get('textarea').setValue('Hola de nuevo')
    expect(wrapper.find('p.text-error').exists()).toBe(false)

    mockApi('POST', THREAD, failWith(500))
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flush()
    expect(wrapper.get('form [role="alert"]').text()).toContain('No pudimos publicar el comentario')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Hola de nuevo')
  })
})

describe('CommentThread · sondeo cada 5 s', () => {
  it('pide solo los nuevos con since y los fusiona sin duplicar', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const sinceSeen: unknown[] = []
    let next: Comment[] = []
    mockApi('GET', THREAD, (event) => {
      const { since } = getQuery(event)
      if (!since) return [comment()]
      sinceSeen.push(since)
      return next
    })
    const wrapper = await mountSuspended(CommentThread, { props: { fileId: F1 } })
    await flush()
    expect(wrapper.findAll('ul[aria-label="Comentarios"] > li')).toHaveLength(1)

    // El primero vuelve repetido (mismo id) y llega uno nuevo de otra persona.
    next = [comment(), comment({ id: 'c2', body: 'Visto', author: { id: 'u2', name: 'Luis' }, createdAt: '2026-10-14T10:01:00.000Z', canEdit: false, canDelete: false })]
    vi.advanceTimersByTime(5000)
    await flush()
    expect(sinceSeen).toEqual(['2026-10-14T10:00:00.000Z'])
    expect(wrapper.findAll('ul[aria-label="Comentarios"] > li').map(li => li.text())).toEqual([
      expect.stringContaining('Revisar la diapositiva 3'),
      expect.stringContaining('Visto'),
    ])

    // El cursor avanza al último comentario; sin novedades no cambia nada.
    next = []
    vi.advanceTimersByTime(5000)
    await flush()
    expect(sinceSeen.at(-1)).toBe('2026-10-14T10:01:00.000Z')
    expect(wrapper.findAll('ul[aria-label="Comentarios"] > li')).toHaveLength(2)

    // Un sondeo fallido no rompe el hilo.
    mockApi('GET', THREAD, failWith(500))
    vi.advanceTimersByTime(5000)
    await flush()
    expect(wrapper.findAll('ul[aria-label="Comentarios"] > li')).toHaveLength(2)
    wrapper.unmount()
  })

  it('se pausa con la pestaña oculta o el hilo fuera de vista y sondea al volver', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let polls = 0
    mockApi('GET', THREAD, (event) => {
      if (getQuery(event).since) polls++
      return [comment()]
    })
    const wrapper = await mountSuspended(CommentThread, { props: { fileId: F1 } })
    await flush()

    view.document.value = 'hidden'
    await flush()
    vi.advanceTimersByTime(15000)
    await flush()
    expect(polls).toBe(0)

    view.thread.value = false
    view.document.value = 'visible'
    await flush()
    vi.advanceTimersByTime(5000)
    await flush()
    expect(polls).toBe(0)

    view.thread.value = true
    await flush()
    expect(polls).toBe(1)
    wrapper.unmount()
  })
})

describe('contador de comentarios', () => {
  it('aparece con comentarios y se oculta en cero', async () => {
    const many = await mountSuspended(FileCard, { props: { file: file({ commentCount: 3 }) } })
    expect(many.get('[aria-label="3 comentarios"]').text()).toBe('3')
    const one = await mountSuspended(CommentCount, { props: { count: 1 } })
    expect(one.get('[role="img"]').attributes('aria-label')).toBe('1 comentario')
    const none = await mountSuspended(FileCard, { props: { file: file({ commentCount: 0 }) } })
    expect(none.find('[aria-label$="comentarios"]').exists()).toBe(false)
    const unknown = await mountSuspended(FileCard, { props: { file: file() } })
    expect(unknown.find('[role="img"]').exists()).toBe(false)
  })

  it('también en la vista de lista', async () => {
    const list = await mountSuspended(FileList, { props: { folders: [], items: [file({ commentCount: 2 })] } })
    expect(list.get('[aria-label="2 comentarios"]').text()).toBe('2')
  })
})
