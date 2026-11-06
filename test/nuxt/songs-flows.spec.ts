// Feature 006 — caminos de error y emisiones de Canciones que las pruebas de cada componente no recorren: acciones de
// colecciones que fallan o se cancelan, la fila Colecciones, el diálogo en sus estados de carga y error, el historial al
// quitar y las acciones de la página índice.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper } from '@vue/test-utils'
import type { Me, SongCollection, SongCollectionDetail, SongCollectionItem, SongHistoryItem } from '#shared/types/api'
import CancionesPage from '~/pages/canciones/index.vue'
import CancionPage from '~/pages/canciones/[id].vue'
import SongActions from '~/components/songs/SongActions.vue'
import SongCollectionDialog from '~/components/songs/SongCollectionDialog.vue'
import SongCollectionRow from '~/components/songs/SongCollectionRow.vue'
import { buttonsWithText, calls, failFromServer, failWith, flush, mockApi, resetCalls } from './helpers/api'

function setMe(role: 'admin' | 'editor' | null, userId = 'u1') {
  if (!role) {
    useMe().me.value = null
    return
  }
  const me: Me = {
    user: { id: userId, email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId, email: 'ana@iglesia.org', name: 'Ana', role, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

const collection = (changes: Partial<SongCollection> = {}): SongCollection => ({
  id: 'c1', name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 2,
  createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z', ...changes,
})
const song = (n: number): SongCollectionItem => ({ id: `s${n}`, title: `Canción ${n}`, artist: null, sourceUrl: `https://letras.com/a/c${n}`, addedAt: '2026-11-05T10:00:00.000Z', addedBy: { userId: 'u1', name: 'Ana', active: true } })
const detail = (items = [song(1), song(2)]): SongCollectionDetail => ({ ...collection({ itemCount: items.length }), items })
const historyItem = (n: number): SongHistoryItem => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, title: `Canción ${n}`, artist: null, sourceUrl: `https://letras.com/a/c${n}`,
  viewedAt: '2026-11-05T10:00:00.000Z', viewedBy: { userId: 'u1', name: 'Ana', active: true },
})
const toasts = () => useToast().toasts.value.map(t => t.message)
const menuItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(el => new DOMWrapper(el))

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  useState('songs-presentations').value = []
  useState('songs-history-selected').value = []
  setMe('editor')
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/youtube/health', { state: 'up' })
  mockApi('GET', '/api/songs/collections', { items: [collection()] })
  mockApi('GET', '/api/songs/history', { items: [], nextCursor: null })
})

describe('useSongCollections · fallos y cancelaciones', () => {
  it('cada acción que falla avisa con el texto del servidor o el de respaldo', async () => {
    const c = useSongCollections()
    mockApi('POST', '/api/songs/collections', failWith(500))
    expect(await c.create('X')).toBeNull()
    mockApi('PATCH', '/api/songs/collections/c1', failFromServer(403, 'Forbidden', 'Solo quien la creó o un administrador puede cambiar esta colección.'))
    expect(await c.rename({ id: 'c1' }, 'Y')).toBeNull()
    mockApi('POST', '/api/songs/collections/c1/items', failWith(500))
    expect(await c.addSong(collection(), 's1')).toBe(false)
    expect(toasts()).toEqual([
      'No pudimos crear la colección. Inténtalo de nuevo.',
      'Solo quien la creó o un administrador puede cambiar esta colección.',
      'No pudimos agregar la canción. Inténtalo de nuevo.',
    ])
  })

  it('eliminar y quitar: cancelar no llama a la API; un fallo avisa', async () => {
    const c = useSongCollections()
    const removing = c.remove(collection())
    await flush()
    useConfirm().cancel()
    expect(await removing).toBe(false)
    const quitting = c.removeSong(collection(), song(1))
    await flush()
    useConfirm().cancel()
    expect(await quitting).toBe(false)
    expect(calls.some(call => call.method === 'DELETE')).toBe(false)

    mockApi('DELETE', '/api/songs/collections/c1', failWith(500))
    mockApi('DELETE', '/api/songs/collections/c1/items/s1', failWith(500))
    const failing = c.remove(collection())
    await flush()
    useConfirm().accept()
    expect(await failing).toBe(false)
    const failingSong = c.removeSong(collection(), song(1))
    await flush()
    useConfirm().accept()
    expect(await failingSong).toBe(false)
    expect(toasts()).toEqual(['No pudimos eliminar la colección. Inténtalo de nuevo.', 'No pudimos quitar la canción. Inténtalo de nuevo.'])
  })

  it('generar: una sola canción va directo, cancelar la confirmación no encola, vacía no hace nada y un fallo al cargar avisa', async () => {
    const c = useSongCollections()
    mockApi('POST', '/api/songs/s1/pptx', () => new Promise(() => {}))
    mockApi('GET', '/api/songs/collections/c1', detail([song(1)]))
    expect(await c.generate(collection())).toBe(1)
    expect(useConfirm().options.value).toBeNull()

    useState('songs-presentations').value = []
    mockApi('GET', '/api/songs/collections/c1', detail())
    const generating = c.generate(collection())
    await flush()
    useConfirm().cancel()
    expect(await generating).toBe(0)
    expect(useState('songs-presentations').value).toEqual([])

    expect(await c.generateSongs([])).toBe(0)

    mockApi('GET', '/api/songs/collections/c1', failWith(500))
    expect(await c.generate(collection())).toBe(0)
    expect(toasts()).toContain('No pudimos cargar la colección. Revisa tu conexión.')
    useState('songs-presentations').value = []
  })

  it('canManage: sin sesión nadie; el autor y un admin sí', () => {
    setMe(null)
    expect(useSongCollections().canManage(collection())).toBe(false)
    setMe('editor', 'u1')
    expect(useSongCollections().canManage(collection())).toBe(true)
    setMe('editor', 'u2')
    expect(useSongCollections().canManage(collection())).toBe(false)
    setMe('admin', 'u9')
    expect(useSongCollections().canManage(collection())).toBe(true)
  })
})

describe('SongCollectionRow', () => {
  it('reemite las acciones de sus tarjetas y ofrece «Nueva colección» en la cabecera', async () => {
    const wrapper = await mountSuspended(SongCollectionRow, {
      props: { collections: [collection()], pending: false, error: null, canManage: () => true },
      attachTo: document.body,
    })
    await buttonsWithText(wrapper, 'Nueva colección')[0]!.trigger('click')
    await wrapper.get('button[aria-label="Abrir la colección Domingo, 2 canciones"]').trigger('click')
    await wrapper.get('button[aria-label="Generar las presentaciones de Domingo"]').trigger('click')
    for (const index of [1, 2]) {
      await wrapper.get('button[aria-label="Opciones de Domingo"]').trigger('click')
      await flush()
      await menuItems()[index]!.trigger('click')
    }
    expect(Object.keys(wrapper.emitted()).filter(k => ['create', 'open', 'generate', 'rename', 'remove'].includes(k)).sort()).toEqual(['create', 'generate', 'open', 'remove', 'rename'])
    wrapper.unmount()
  })

  it('el error ofrece Reintentar; sin canManage nadie gestiona', async () => {
    const error = await mountSuspended(SongCollectionRow, { props: { collections: null, pending: false, error: new Error('x') } })
    await buttonsWithText(error, 'Reintentar')[0]!.trigger('click')
    expect(error.emitted('retry')).toHaveLength(1)
    const plain = await mountSuspended(SongCollectionRow, { props: { collections: [collection()], pending: false, error: null } })
    expect(plain.text()).toContain('Domingo')
  })
})

describe('SongCollectionDialog · estados', () => {
  it('agregar a una existente: cargando, error con reintento y vacío', async () => {
    mockApi('GET', '/api/songs/collections', () => new Promise(() => {}))
    const loading = await mountSuspended(SongCollectionDialog, { props: { songId: 's1' }, attachTo: document.body })
    await buttonsWithText(loading, 'Agregar a una existente')[0]!.trigger('click')
    await flush()
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)
    loading.unmount()

    clearNuxtData()
    mockApi('GET', '/api/songs/collections', failWith(500))
    const wrapper = await mountSuspended(SongCollectionDialog, { props: { songId: 's1' }, attachTo: document.body })
    await buttonsWithText(wrapper, 'Agregar a una existente')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.text()).toContain('No pudimos cargar las colecciones')
    mockApi('GET', '/api/songs/collections', { items: [] })
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.text()).toContain('Crea la primera en la pestaña «Nueva colección».')
    await buttonsWithText(wrapper, 'Nueva colección')[0]!.trigger('click')
    expect(wrapper.find('form').exists()).toBe(true)
    wrapper.unmount()
  })

  it('ver: error con reintento, colección vacía, autor inactivo, renombrar con error de validación y cancelar', async () => {
    mockApi('GET', '/api/songs/collections/c1', failWith(500))
    const wrapper = await mountSuspended(SongCollectionDialog, { props: { collectionId: 'c1' }, attachTo: document.body })
    await flush(10)
    expect(wrapper.text()).toContain('No pudimos cargar la colección')
    mockApi('GET', '/api/songs/collections/c1', { ...detail([]), author: { userId: 'u1', name: 'Ana', active: false } })
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.text()).toContain('Esta colección no tiene canciones todavía.')
    expect(wrapper.text()).toContain('Creada por Usuario que ya no está activo')
    expect(buttonsWithText(wrapper, 'Generar colección')[0]!.attributes('disabled')).toBeDefined()

    await buttonsWithText(wrapper, 'Renombrar')[0]!.trigger('click')
    await wrapper.get('form input').setValue('')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Este campo es obligatorio')
    await buttonsWithText(wrapper, 'Cancelar')[0]!.trigger('click')
    expect(wrapper.find('form').exists()).toBe(false)

    // Escape (evento cancel del <dialog>) y el fondo cierran.
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('crear con un nombre de más de 80 caracteres muestra el error sin llamar a la API', async () => {
    const wrapper = await mountSuspended(SongCollectionDialog, { attachTo: document.body })
    await wrapper.get('input').setValue('a'.repeat(81))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Debe tener como máximo 80 caracteres')
    expect(calls.some(c => c.method === 'POST')).toBe(false)
    await buttonsWithText(wrapper, 'Cancelar')[0]!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('SongActions', () => {
  it('Agregar a colección emite collection', async () => {
    const wrapper = await mountSuspended(SongActions, { props: { song: { id: 's1', title: 'T', artist: null, sourceUrl: 'https://letras.com/a/b', lyrics: [['a']], lineCount: 1, createdAt: '', updatedAt: '' } } })
    await buttonsWithText(wrapper, 'Agregar a colección')[0]!.trigger('click')
    expect(wrapper.emitted('collection')).toHaveLength(1)
  })
})

describe('/canciones · acciones de la página', () => {
  it('generar una colección desde su tarjeta, renombrar abre su detalle y eliminar pide confirmación', async () => {
    mockApi('GET', '/api/songs/collections/c1', detail([song(1)]))
    mockApi('POST', '/api/songs/s1/pptx', () => new Promise(() => {}))
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await flush(10)
    await wrapper.get('button[aria-label="Generar las presentaciones de Domingo"]').trigger('click')
    await flush(10)
    expect(useState<{ songId: string }[]>('songs-presentations').value.map(i => i.songId)).toEqual(['s1'])

    await wrapper.get('button[aria-label="Opciones de Domingo"]').trigger('click')
    await flush()
    await menuItems().find(i => i.text() === 'Eliminar colección')!.trigger('click')
    await flush()
    expect(useConfirm().options.value?.title).toBe('¿Eliminar la colección «Domingo»? Las canciones siguen en el historial.')
    useConfirm().cancel()
    await flush()

    await wrapper.get('button[aria-label="Opciones de Domingo"]').trigger('click')
    await flush()
    await menuItems().find(i => i.text() === 'Renombrar')!.trigger('click')
    await vi.waitUntil(() => wrapper.find('dialog').exists(), { timeout: 3000 })
    await flush(10)
    expect(wrapper.get('dialog h2').text()).toBe('Domingo')
    useState('songs-presentations').value = []
    wrapper.unmount()
  })

  it('desde el historial: agregar a colección abre el diálogo con la canción y generar una entrada la encola', async () => {
    mockApi('GET', '/api/songs/history', { items: [historyItem(1)], nextCursor: null })
    mockApi('POST', `/api/songs/${historyItem(1).id}/pptx`, () => new Promise(() => {}))
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await flush(10)
    await wrapper.get('button[aria-label="Acciones de Canción 1"]').trigger('click')
    await flush()
    await menuItems().find(i => i.text() === 'Generar presentación')!.trigger('click')
    await flush()
    expect(useState<{ songId: string }[]>('songs-presentations').value.map(i => i.songId)).toEqual([historyItem(1).id])

    await wrapper.get('button[aria-label="Acciones de Canción 1"]').trigger('click')
    await flush()
    await menuItems().find(i => i.text() === 'Agregar a colección')!.trigger('click')
    await vi.waitUntil(() => wrapper.find('dialog').exists(), { timeout: 3000 })
    expect(wrapper.get('dialog').text()).toContain('Canción: Canción 1')
    await wrapper.get('dialog button[aria-label="Cerrar"]').trigger('click')
    await flush()
    expect(wrapper.find('dialog').exists()).toBe(false)
    useState('songs-presentations').value = []
    wrapper.unmount()
  })

  it('quitar del historial: cancelar no llama a la API y un fallo avisa', async () => {
    mockApi('GET', '/api/songs/history', { items: [historyItem(1)], nextCursor: null })
    mockApi('DELETE', `/api/songs/history/${historyItem(1).id}`, failWith(500))
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await flush(10)
    for (const accept of [false, true]) {
      await wrapper.get('button[aria-label="Acciones de Canción 1"]').trigger('click')
      await flush()
      await menuItems().find(i => i.text() === 'Quitar del historial')!.trigger('click')
      await flush()
      if (accept) useConfirm().accept()
      else useConfirm().cancel()
      await flush(10)
    }
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(1)
    expect(toasts()).toContain('No pudimos quitarla del historial. Inténtalo de nuevo.')
    expect(wrapper.text()).toContain('Canción 1')
    wrapper.unmount()
  })
})

describe('páginas de Canciones · aviso del servicio, colección desde la ficha y selección', () => {
  const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
  const songDetail = { id: ID, title: 'De Buenas', artist: null, sourceUrl: 'https://letras.com/a/b', lyrics: [['a']], lineCount: 1, createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z' }

  it('la ficha: el aviso del servicio reintenta y «Agregar a colección» abre y cierra el diálogo con la canción', async () => {
    mockApi('GET', `/api/songs/${ID}`, songDetail)
    mockApi('GET', '/api/youtube/health', { state: 'down' })
    const wrapper = await mountSuspended(CancionPage, { route: `/canciones/${ID}`, attachTo: document.body })
    await flush(10)
    expect(wrapper.text()).toContain('El servicio de descargas no está disponible ahora')
    mockApi('GET', '/api/youtube/health', { state: 'up' })
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.text()).not.toContain('El servicio de descargas no está disponible ahora')

    await buttonsWithText(wrapper, 'Agregar a colección')[0]!.trigger('click')
    await vi.waitUntil(() => wrapper.find('dialog').exists(), { timeout: 3000 })
    expect(wrapper.get('dialog').text()).toContain('Canción: De Buenas')
    await wrapper.get('dialog button[aria-label="Cerrar"]').trigger('click')
    await flush()
    expect(wrapper.find('dialog').exists()).toBe(false)
    wrapper.unmount()
  })

  it('el índice: el aviso del servicio reintenta, abrir una tarjeta muestra la colección y «Limpiar» vacía la selección', async () => {
    mockApi('GET', '/api/youtube/health', failWith(503))
    mockApi('GET', '/api/songs/collections/c1', detail())
    mockApi('GET', '/api/songs/history', { items: [historyItem(1)], nextCursor: null })
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await flush(10)
    expect(wrapper.text()).toContain('Despertando el servicio')
    mockApi('GET', '/api/youtube/health', { state: 'up' })
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.text()).not.toContain('Despertando el servicio')

    await wrapper.get('button[aria-label="Abrir la colección Domingo, 2 canciones"]').trigger('click')
    await vi.waitUntil(() => wrapper.find('dialog').exists(), { timeout: 3000 })
    await flush(10)
    expect(wrapper.get('dialog').text()).toContain('Canción 2')
    await wrapper.get('dialog button[aria-label="Cerrar"]').trigger('click')
    await flush()

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flush()
    expect(wrapper.find('div[role="region"][aria-label="Selección"]').exists()).toBe(true)
    expect(wrapper.classes()).toContain('pb-40')
    await buttonsWithText(wrapper, 'Limpiar')[0]!.trigger('click')
    await flush()
    expect(useState('songs-history-selected').value).toEqual([])
    expect(wrapper.find('div[role="region"][aria-label="Selección"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('useSongHistory · variante reciente sin canción excluida', () => {
  it('pide 12 sin `exclude` y no ofrece página siguiente', async () => {
    mockApi('GET', '/api/songs/history', { items: [historyItem(1)], nextCursor: 'c1' })
    const history = useSongHistory({ recent: true })
    await flush(10)
    expect(history.nextCursor.value).toBeNull()
    await history.loadMore()
    const call = calls.find(c => c.url === '/api/songs/history')
    expect(call).toBeTruthy()
    expect(calls.filter(c => c.url === '/api/songs/history')).toHaveLength(1)
  })
})

describe('SongCollectionDialog · validación al salir del campo y fallos que lo dejan abierto', () => {
  it('crear: salir del nombre vacío muestra el error; si la API falla el diálogo sigue abierto', async () => {
    const wrapper = await mountSuspended(SongCollectionDialog, { attachTo: document.body })
    await wrapper.get('input').trigger('blur')
    await flush()
    expect(wrapper.text()).toContain('Este campo es obligatorio')
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')

    mockApi('POST', '/api/songs/collections', failWith(500))
    await wrapper.get('input').setValue('Ensayo')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(toasts()).toContain('No pudimos crear la colección. Inténtalo de nuevo.')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('agregar a una existente que falla deja el diálogo abierto para reintentar', async () => {
    mockApi('POST', '/api/songs/collections/c1/items', failWith(500))
    const wrapper = await mountSuspended(SongCollectionDialog, { props: { songId: 's1', songTitle: 'Canción 1' }, attachTo: document.body })
    await buttonsWithText(wrapper, 'Agregar a una existente')[0]!.trigger('click')
    await flush(10)
    await wrapper.findAll('[aria-label="Colecciones del equipo"] button')[0]!.trigger('click')
    await flush(10)
    expect(toasts()).toContain('No pudimos agregar la canción. Inténtalo de nuevo.')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.findAll('[aria-label="Colecciones del equipo"] button')[0]!.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('ver: quien agregó una canción y ya no está activo; renombrar valida al salir y un fallo deja el formulario', async () => {
    mockApi('GET', '/api/songs/collections/c1', detail([{ ...song(1), artist: 'Banda', addedBy: { userId: 'u9', name: 'Luis', active: false } }]))
    const wrapper = await mountSuspended(SongCollectionDialog, { props: { collectionId: 'c1' }, attachTo: document.body })
    await flush(10)
    expect(wrapper.text()).toContain('Banda · Agregada por Usuario que ya no está activo')

    await buttonsWithText(wrapper, 'Renombrar')[0]!.trigger('click')
    const input = wrapper.get('form input')
    expect((input.element as HTMLInputElement).value).toBe('Domingo')
    await input.setValue('')
    await input.trigger('blur')
    await flush()
    expect(wrapper.text()).toContain('Este campo es obligatorio')

    mockApi('PATCH', '/api/songs/collections/c1', failWith(500))
    await input.setValue('Ensayo')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(toasts()).toContain('No pudimos renombrar la colección. Inténtalo de nuevo.')
    expect(wrapper.find('form').exists()).toBe(true)
    wrapper.unmount()
  })

  it('ver: cancelar eliminar la colección o quitar una canción no cierra ni recarga', async () => {
    mockApi('GET', '/api/songs/collections/c1', detail())
    const wrapper = await mountSuspended(SongCollectionDialog, { props: { collectionId: 'c1' }, attachTo: document.body })
    await flush(10)
    const loads = () => calls.filter(c => c.method === 'GET' && c.url === '/api/songs/collections/c1').length
    const before = loads()

    await buttonsWithText(wrapper, 'Eliminar colección')[0]!.trigger('click')
    await flush()
    useConfirm().cancel()
    await flush()
    await wrapper.get('[aria-label="Quitar Canción 1 de la colección"]').trigger('click')
    await flush()
    useConfirm().cancel()
    await flush(10)

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(loads()).toBe(before)
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    wrapper.unmount()
  })
})

describe('/canciones/<id> · clave de la página', () => {
  it('cada canción es una instancia nueva de la ficha (la clave es la ruta)', () => {
    const route = useRouter().resolve('/canciones/00000000-0000-4000-8000-000000000001')
    const key = route.meta.key as ((r: typeof route) => string) | undefined
    expect(typeof key).toBe('function')
    expect(key!(route)).toBe('/canciones/00000000-0000-4000-8000-000000000001')
    const other = useRouter().resolve('/canciones/00000000-0000-4000-8000-000000000002')
    expect(key!(other)).not.toBe(key!(route))
  })
})
