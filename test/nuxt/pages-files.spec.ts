import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import type { FileItem, FolderItem } from '#shared/types/api'
import FileExplorer from '~/components/files/FileExplorer.vue'
import FolderPage from '~/pages/archivos/[folderId].vue'
import FilesIndexPage from '~/pages/archivos/index.vue'
import FileDetailPage from '~/pages/archivos/ver/[fileId].vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const D1 = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const F1 = '9b2c1f0e-1d2c-4e5f-8a9b-0c1d2e3f4a5b'

const file = (changes: Partial<FileItem> = {}): FileItem => ({
  id: F1, folderId: null, name: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 2048,
  hasThumbnail: false, origin: 'team', uploadedBy: { id: 'u1', name: 'Ana' }, guestName: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...changes,
})
const folder: FolderItem = { id: D1, name: 'Domingo', parentId: null, createdAt: '', updatedAt: '', itemCount: 2 }

function children(changes: Record<string, unknown> = {}) {
  return { folder: null, breadcrumbs: [{ id: null, name: 'Archivos' }], folders: [folder], files: [file()], nextCursor: null, ...changes }
}

const buttons = buttonsWithText

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  navigateToMock.mockReset()
  useToast().toasts.value = []
  mockApi('GET', '/api/folders/root/children', children())
  mockApi('GET', `/api/files/${F1}/comments`, [])
  mockApi('GET', `/api/files/${F1}/text`, { status: 'ready', text: 'Oremos por Ana', error: null, readAt: null, editedAt: null, editedBy: null })
})

describe('FileExplorer · los cuatro estados', () => {
  it('contenido: carpetas, archivos y título', async () => {
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    expect(wrapper.get('h1').text()).toBe('Archivos')
    expect(wrapper.find('a[aria-label="Abrir carpeta Domingo"]').exists()).toBe(true)
    expect(wrapper.find('a[aria-label="Abrir foto.jpg"]').exists()).toBe(true)
    // En la raíz no hay migas.
    expect(wrapper.find('nav[aria-label="Ruta de la carpeta"]').exists()).toBe(false)
  })

  it('cargando muestra el skeleton', async () => {
    mockApi('GET', '/api/folders/root/children', () => new Promise(() => {}))
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
  })

  it('error con reintento', async () => {
    mockApi('GET', '/api/folders/root/children', failWith(500))
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar los archivos')
    mockApi('GET', '/api/folders/root/children', children())
    await buttons(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(wrapper.find('a[aria-label="Abrir foto.jpg"]').exists()).toBe(true)
  })

  it('vacío: carpeta vacía con acciones para subir o crear', async () => {
    mockApi('GET', '/api/folders/root/children', children({ folders: [], files: [] }))
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    expect(wrapper.text()).toContain('Esta carpeta está vacía')
    await buttons(wrapper, 'Subir archivos')[0]!.trigger('click')
    expect(useUploadDialog().isOpen.value).toBe(true)
    useUploadDialog().close()
    await buttons(wrapper, 'Nueva carpeta').at(-1)!.trigger('click')
    // `LazyItemDialogs`: el diálogo llega en su propio chunk al abrirse.
    await vi.waitFor(() => expect(wrapper.find('dialog h2').text()).toBe('Nueva carpeta'))
  })

  it('vacío por filtro de tipo ofrece quitar el filtro', async () => {
    mockApi('GET', '/api/folders/root/children', children({ folders: [], files: [] }))
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null }, route: '/archivos?type=audio' })
    await flush()
    expect(wrapper.text()).toContain('No hay archivos de este tipo aquí')
    await buttons(wrapper, 'Ver todos')[0]!.trigger('click')
    await flush()
    expect(useRoute().query.type).toBeUndefined()
  })
})

describe('FileExplorer · búsqueda, filtros, orden y vista', () => {
  it('con ?q= busca y muestra resultados o el vacío de búsqueda', async () => {
    mockApi('GET', '/api/files/search', (event) => {
      const { q } = getQuery(event)
      return q === 'dom'
        ? { folders: [{ ...folder, path: [] }], files: [file({ path: ['Domingo'] })], nextCursor: null }
        : { folders: [], files: [], nextCursor: null }
    })
    const found = await mountSuspended(FileExplorer, { props: { folderId: null }, route: '/archivos?q=dom' })
    await flush()
    expect(found.get('h1').text()).toBe('Resultados para «dom»')
    expect(found.find('a[aria-label="Abrir carpeta Domingo"]').exists()).toBe(true)
    expect(found.find('a[href="/archivos"]').text()).toContain('Limpiar búsqueda')

    clearNuxtData()
    const none = await mountSuspended(FileExplorer, { props: { folderId: null }, route: '/archivos?q=zzz' })
    await flush()
    expect(none.text()).toContain('No encontramos nada con «zzz»')
  })

  it('feature 002: insignia «En el texto» en la cuadrícula y la lista, y la nota de búsqueda siempre que hay q', async () => {
    mockApi('GET', '/api/files/search', (event) => {
      const { q } = getQuery(event)
      return q === 'abuela'
        ? { folders: [], files: [file({ path: [], matchedIn: 'text' }), file({ id: D1, name: 'abuela.jpg', path: [], matchedIn: 'name' })], nextCursor: null }
        : { folders: [], files: [], nextCursor: null }
    })
    const found = await mountSuspended(FileExplorer, { props: { folderId: null }, route: '/archivos?q=abuela' })
    await flush()
    expect(found.text()).toContain(messages.imageText.searchHint)
    expect(found.findAll('.badge').filter(b => b.text() === 'En el texto')).toHaveLength(1)
    await found.get('button[aria-label="Ver en lista"]').trigger('click')
    await flush()
    const rows = found.findAll('li').filter(li => li.text().includes('.jpg'))
    expect(rows.map(li => li.text().includes('En el texto'))).toEqual([true, false])

    clearNuxtData()
    const none = await mountSuspended(FileExplorer, { props: { folderId: null }, route: '/archivos?q=zzz' })
    await flush()
    expect(none.text()).toContain('No encontramos nada con «zzz»')
    expect(none.text()).toContain(messages.imageText.searchHint)

    clearNuxtData()
    const folderView = await mountSuspended(FileExplorer, { props: { folderId: null }, route: '/archivos' })
    await flush()
    expect(folderView.text()).not.toContain(messages.imageText.searchHint)
    expect(folderView.text()).not.toContain('En el texto')
  })

  it('el filtro de tipo y el orden se guardan en la URL', async () => {
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null }, route: '/archivos' })
    await flush()
    const audio = buttons(wrapper, 'Audio')[0]!
    expect(audio.attributes('aria-pressed')).toBe('false')
    await audio.trigger('click')
    await flush()
    expect(useRoute().query.type).toBe('audio')

    await wrapper.get('select').setValue('size-desc')
    await flush()
    expect(useRoute().query).toMatchObject({ sort: 'size', dir: 'desc' })
    expect(calls.some(c => c.url === '/api/folders/root/children')).toBe(true)
  })

  it('regresión: quitar el filtro y ordenar enseguida conserva ambos cambios', async () => {
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null }, route: '/archivos?type=audio' })
    await flush()
    // Sin esperar entre clics, como una persona rápida.
    void buttons(wrapper, 'Todos')[0]!.trigger('click')
    void wrapper.get('select').setValue('size-desc')
    await flush()
    expect(useRoute().query).toEqual({ sort: 'size', dir: 'desc' })
  })

  it('alterna entre cuadrícula y lista', async () => {
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    await wrapper.get('button[aria-label="Ver en lista"]').trigger('click')
    expect(wrapper.find('ul.list').exists()).toBe(true)
    expect(wrapper.get('button[aria-label="Ver en lista"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('button[aria-label="Ver en cuadrícula"]').trigger('click')
    expect(wrapper.find('ul.list').exists()).toBe(false)
  })

  it('"Cargar más" agrega la siguiente página con el cursor', async () => {
    mockApi('GET', '/api/folders/root/children', (event) => {
      const { cursor } = getQuery(event)
      return cursor === 'c1'
        ? children({ folders: [], files: [file({ id: 'f2', name: 'b.jpg' })], nextCursor: null })
        : children({ nextCursor: 'c1' })
    })
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    await buttons(wrapper, 'Cargar más')[0]!.trigger('click')
    await flush()
    expect(wrapper.find('a[aria-label="Abrir b.jpg"]').exists()).toBe(true)
    expect(buttons(wrapper, 'Cargar más')).toHaveLength(0)
  })

  it('si falla la página siguiente avisa sin perder lo cargado', async () => {
    mockApi('GET', '/api/folders/root/children', (event) => {
      if (getQuery(event).cursor) failWith(500)(event)
      return children({ nextCursor: 'c1' })
    })
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    await buttons(wrapper, 'Cargar más')[0]!.trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)?.message).toContain('No pudimos cargar más archivos')
    expect(wrapper.find('a[aria-label="Abrir foto.jpg"]').exists()).toBe(true)
  })
})

describe('FileExplorer · acciones', () => {
  it('renombrar, mover y eliminar abren el diálogo o la confirmación', async () => {
    mockApi('DELETE', `/api/files/${F1}`, null)
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    const menu = () => wrapper.get('button[aria-label="Acciones de foto.jpg"]')
    const choose = async (label: string) => {
      await menu().trigger('click')
      await wrapper.findAll('[role="menuitem"]').find(o => o.text() === label)!.trigger('click')
      await flush()
    }

    await choose('Renombrar')
    expect(wrapper.get('dialog h2').text()).toBe('Renombrar archivo')
    await buttons(wrapper, 'Cancelar')[0]!.trigger('click')

    await choose('Mover')
    // FolderPicker es `Lazy*` (T157): su código llega en un chunk aparte, de forma asíncrona.
    await vi.waitFor(() => expect(wrapper.get('dialog h2').text()).toBe('Mover «foto.jpg» a…'))

    const confirm = useConfirm()
    await choose('Eliminar')
    expect(confirm.options.value?.title).toBe('¿Eliminar «foto.jpg»?')
    confirm.accept()
    await flush()
    expect(calls.some(c => c.method === 'DELETE' && c.url === `/api/files/${F1}`)).toBe(true)
    expect(useToast().toasts.value.at(-1)?.message).toBe('«foto.jpg» se envió a la papelera')
  })

  it('al renombrar, la tarjeta muestra el nombre nuevo sin esperar a que se recargue la lista', async () => {
    mockApi('PATCH', `/api/folders/${D1}`, { ...folder, name: 'Ensayo' })
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    // La recarga posterior queda pendiente: lo que se vea sale de la respuesta del servidor aplicada en local.
    mockApi('GET', '/api/folders/root/children', () => new Promise(() => {}))
    await wrapper.get('button[aria-label="Acciones de la carpeta Domingo"]').trigger('click')
    await wrapper.findAll('[role="menuitem"]').find(o => o.text() === 'Renombrar')!.trigger('click')
    await flush()
    await wrapper.get('dialog input').setValue('Ensayo')
    await wrapper.get('dialog form').trigger('submit')
    await flush()
    expect(wrapper.find('a[aria-label="Abrir carpeta Ensayo"]').exists()).toBe(true)
    expect(wrapper.find('a[aria-label="Abrir carpeta Domingo"]').exists()).toBe(false)
  })

  it('las acciones de carpeta también llegan al explorador', async () => {
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    await wrapper.get('button[aria-label="Acciones de la carpeta Domingo"]').trigger('click')
    await wrapper.findAll('[role="menuitem"]').find(o => o.text() === 'Renombrar')!.trigger('click')
    await flush()
    expect(wrapper.get('dialog h2').text()).toBe('Renombrar carpeta')
  })

  it('una subida terminada refresca la vista', async () => {
    const wrapper = await mountSuspended(FileExplorer, { props: { folderId: null } })
    await flush()
    mockApi('GET', '/api/folders/root/children', children({ files: [file(), file({ id: 'f9', name: 'nuevo.jpg' })] }))
    useUploadDialog().notifyUploaded()
    await flush()
    expect(wrapper.find('a[aria-label="Abrir nuevo.jpg"]').exists()).toBe(true)
  })
})

describe('páginas de archivos', () => {
  it('/archivos y /archivos/:id usan el explorador con su carpeta', async () => {
    const root = await mountSuspended(FilesIndexPage, { route: '/archivos' })
    await flush()
    expect(root.get('h1').text()).toBe('Archivos')

    mockApi('GET', `/api/folders/${D1}/children`, children({
      folder,
      breadcrumbs: [{ id: null, name: 'Archivos' }, { id: D1, name: 'Domingo' }],
      folders: [],
    }))
    const inFolder = await mountSuspended(FolderPage, { route: `/archivos/${D1}` })
    await flush()
    expect(inFolder.get('h1').text()).toBe('Domingo')
    expect(inFolder.get('nav[aria-label="Ruta de la carpeta"]').text()).toContain('Archivos')
    await buttons(inFolder, 'Subir')[0]!.trigger('click')
    expect(useUploadDialog().folderId.value).toBe(D1)
  })
})

describe('detalle de archivo', () => {
  it('muestra vista previa, metadatos y acciones', async () => {
    mockApi('GET', `/api/files/${F1}`, file({ folderId: D1, path: ['Domingo'], origin: 'guest', uploadedBy: null, guestName: 'Luis' }))
    const wrapper = await mountSuspended(FileDetailPage, { route: `/archivos/ver/${F1}` })
    await flush()
    expect(wrapper.get('h1').text()).toBe('foto.jpg')
    expect(wrapper.text()).toContain('Luis')
    expect(wrapper.text()).toContain('Invitado')
    expect(wrapper.text()).toContain('Domingo')
    expect(wrapper.get('a[download]').attributes('href')).toBe(`/api/files/${F1}/content?download=1`)
    expect(wrapper.get(`a[href="/archivos/${D1}"]`).text()).toContain('Domingo')
    // El hilo de comentarios (US8) se monta junto a los metadatos. Es un componente `Lazy`: su chunk
    // llega asíncrono y bajo carga (corrida con cobertura) puede tardar más que un `flush()`.
    await vi.waitFor(() => expect(wrapper.text()).toContain('Sé el primero en comentar'))
    // Primero el texto de la imagen (feature 002) y después los comentarios.
    // Ambos son componentes `Lazy`: cada chunk llega por su cuenta.
    const titles = () => wrapper.findAll('section[aria-labelledby]').map(section => wrapper.get(`#${section.attributes('aria-labelledby')}`).text())
    await vi.waitFor(() => expect(titles()).toEqual([expect.stringContaining('Texto de la imagen'), expect.stringContaining('Comentarios')]))

    await wrapper.get('button[aria-label="Más acciones de foto.jpg"]').trigger('click')
    await wrapper.findAll('[role="menuitem"]').find(o => o.text() === 'Renombrar')!.trigger('click')
    await flush()
    expect(wrapper.get('dialog h2').text()).toBe('Renombrar archivo')
  })

  it('una imagen muestra su texto en un espacio reservado; otras categorías no tienen panel (feature 002)', async () => {
    mockApi('GET', `/api/files/${F1}`, file())
    const image = await mountSuspended(FileDetailPage, { route: `/archivos/ver/${F1}` })
    await flush()
    const reserved = image.get('aside .min-h-48')
    await vi.waitFor(() => expect(reserved.text()).toContain('Oremos por Ana'))
    // Un estado terminal no dispara la lectura de respaldo.
    expect(calls.filter(c => c.url === `/api/files/${F1}/text`).map(c => c.method)).not.toContain('POST')

    clearNuxtData()
    mockApi('GET', `/api/files/${F1}`, file({ name: 'guion.pdf', extension: 'pdf', mimeType: 'application/pdf', category: 'presentation' }))
    const pdf = await mountSuspended(FileDetailPage, { route: `/archivos/ver/${F1}` })
    await flush()
    expect(pdf.find('aside .min-h-48').exists()).toBe(false)
    expect(pdf.text()).not.toContain('Texto de la imagen')
  })

  it('en la raíz muestra «Archivos (raíz)», al autor del equipo y abre Mover desde el menú', async () => {
    mockApi('GET', `/api/files/${F1}`, file({ path: [] }))
    const wrapper = await mountSuspended(FileDetailPage, { route: `/archivos/ver/${F1}` })
    await flush()
    expect(wrapper.text()).toContain('Archivos (raíz)')
    expect(wrapper.text()).toContain('Ana')
    expect(wrapper.text()).toContain('Equipo')
    expect(wrapper.get('a.btn-ghost').attributes('href')).toBe('/archivos')

    await wrapper.get('button[aria-label="Más acciones de foto.jpg"]').trigger('click')
    await wrapper.findAll('[role="menuitem"]').find(o => o.text() === 'Mover')!.trigger('click')
    await flush()
    expect(wrapper.get('dialog h2').text()).toBe('Mover «foto.jpg» a…')
  })

  it('un envío de invitado sin nombre figura como «Invitado»', async () => {
    mockApi('GET', `/api/files/${F1}`, file({ origin: 'guest', uploadedBy: null, guestName: null }))
    const wrapper = await mountSuspended(FileDetailPage, { route: `/archivos/ver/${F1}` })
    await flush()
    expect(wrapper.findAll('dd').map(d => d.text())).toContain('Invitado')
  })

  it('al eliminarlo vuelve a su carpeta', async () => {
    mockApi('GET', `/api/files/${F1}`, file())
    mockApi('DELETE', `/api/files/${F1}`, null)
    const wrapper = await mountSuspended(FileDetailPage, { route: `/archivos/ver/${F1}` })
    await flush()
    await wrapper.get('button[aria-label="Más acciones de foto.jpg"]').trigger('click')
    await wrapper.findAll('[role="menuitem"]').find(o => o.text() === 'Eliminar')!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush()
    expect(navigateToMock).toHaveBeenCalledWith('/archivos')
  })

  it('404 explica que ya no está y otros errores ofrecen reintentar', async () => {
    mockApi('GET', `/api/files/${F1}`, failWith(404))
    const gone = await mountSuspended(FileDetailPage, { route: `/archivos/ver/${F1}` })
    await flush()
    expect(gone.text()).toContain('Este archivo ya no está disponible')

    clearNuxtData()
    mockApi('GET', `/api/files/${F1}`, failWith(500))
    const broken = await mountSuspended(FileDetailPage, { route: `/archivos/ver/${F1}` })
    await flush()
    expect(broken.get('[role="alert"]').text()).toContain('No pudimos cargar el archivo.')
  })
})
