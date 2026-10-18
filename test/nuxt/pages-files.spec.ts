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
    expect(wrapper.find('dialog h2').text()).toBe('Nueva carpeta')
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
    expect(wrapper.get('dialog h2').text()).toBe('Mover «foto.jpg» a…')

    const confirm = useConfirm()
    await choose('Eliminar')
    expect(confirm.options.value?.title).toBe('¿Eliminar «foto.jpg»?')
    confirm.accept()
    await flush()
    expect(calls.some(c => c.method === 'DELETE' && c.url === `/api/files/${F1}`)).toBe(true)
    expect(useToast().toasts.value.at(-1)?.message).toBe('«foto.jpg» se envió a la papelera')
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
    // El hilo de comentarios (US8) se monta junto a los metadatos.
    expect(wrapper.get('section[aria-labelledby] h2').text()).toContain('Comentarios')
    expect(wrapper.text()).toContain('Sé el primero en comentar')

    await wrapper.get('button[aria-label="Más acciones de foto.jpg"]').trigger('click')
    await wrapper.findAll('[role="menuitem"]').find(o => o.text() === 'Renombrar')!.trigger('click')
    await flush()
    expect(wrapper.get('dialog h2').text()).toBe('Renombrar archivo')
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
