// T026 — Páginas de Canciones (feature 006, contracts/ui.md): el índice con su campo y la ficha con metadatos → acciones →
// letra en ese orden, y sus estados (cargando, no encontrada, error con reintento y contenido).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { Me, SongDetail } from '#shared/types/api'
import CancionesPage from '~/pages/canciones/index.vue'
import CancionPage from '~/pages/canciones/[id].vue'
import { buttonsWithText, calls, failFromServer, failWith, flush, mockApi, resetCalls } from './helpers/api'

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

function setMe(role: 'admin' | 'editor', userId = 'u1') {
  const me: Me = {
    user: { id: userId, email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId, email: 'ana@iglesia.org', name: 'Ana', role, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

export const songDetail = (changes: Partial<SongDetail> = {}): SongDetail => ({
  id: ID,
  title: 'De Buenas',
  artist: 'Musiko',
  sourceUrl: 'https://letras.com/musiko/de-buenas',
  lyrics: [['uno', 'dos'], ['tres']],
  lineCount: 3,
  createdAt: '2026-11-05T10:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  ...changes,
})

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  setMe('editor')
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/youtube/health', { state: 'up' })
  mockApi('GET', `/api/songs/${ID}`, songDetail())
  mockApi('GET', '/api/songs/collections', { items: [] })
  mockApi('GET', '/api/songs/history', { items: [], nextCursor: null })
  useState('songs-history-selected').value = []
})

describe('/canciones', () => {
  it('encabezado, descripción y campo del enlace', async () => {
    const wrapper = await mountSuspended(CancionesPage)
    expect(wrapper.get('h1').text()).toBe('Canciones')
    expect(wrapper.text()).toContain('Pega el enlace de una canción de Letras.com para ver su letra y descargar la presentación.')
    expect(wrapper.find('input[type="url"]').exists()).toBe(true)
  })

  it('un enlace sin letra muestra el mensaje del servidor junto al campo y conserva el texto', async () => {
    mockApi('POST', '/api/songs/fetch', failFromServer(404, 'Not Found', 'No encontramos una letra en ese enlace.', { code: 'no_lyrics' }))
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await wrapper.get('input').setValue('https://www.letras.com/e2e/sin-letra/')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(calls.filter(c => c.url === '/api/songs/fetch')).toEqual([{ method: 'POST', url: '/api/songs/fetch', body: { url: 'https://letras.com/e2e/sin-letra' } }])
    expect(wrapper.get('[role="alert"]').text()).toBe('No encontramos una letra en ese enlace.')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('https://www.letras.com/e2e/sin-letra/')
    wrapper.unmount()
  })

  it('un 503 con código muestra el texto de ese código (sin crédito, sin configurar)', async () => {
    mockApi('POST', '/api/songs/fetch', failWith(503, { code: 'quota' }))
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await wrapper.get('input').setValue('https://letras.com/a/b')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(wrapper.get('[role="alert"]').text()).toBe('Se agotó el crédito del servicio de rastreo. Avisa a un administrador.')

    mockApi('POST', '/api/songs/fetch', failWith(504))
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(wrapper.get('[role="alert"]').text()).toBe('La búsqueda tardó demasiado. Inténtalo de nuevo.')
    wrapper.unmount()
  })

  it('un enlace nuevo avisa «Letra obtenida»', async () => {
    mockApi('POST', '/api/songs/fetch', { song: songDetail(), crawled: true })
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await wrapper.get('input').setValue('https://letras.com/musiko/de-buenas')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(useToast().toasts.value.map(t => t.message)).toContain('Letra obtenida')
    wrapper.unmount()
  })
})

describe('/canciones/<id>', () => {
  const mountSong = () => mountSuspended(CancionPage, { route: `/canciones/${ID}` })

  it('muestra metadatos → acciones → letra en ese orden DOM', async () => {
    const wrapper = await mountSong()
    await flush()
    const html = wrapper.html()
    const meta = html.indexOf('aria-label="Datos de la canción"')
    const actions = html.indexOf('aria-label="Acciones de la canción"')
    const lyrics = html.indexOf('>Letra</h2>')
    expect(meta).toBeGreaterThan(-1)
    expect(actions).toBeGreaterThan(meta)
    expect(lyrics).toBeGreaterThan(actions)
    expect(wrapper.get('h1').text()).toBe('De Buenas')
    expect(buttonsWithText(wrapper, 'Volver a obtener la letra')).toHaveLength(1)
  })

  it('cargando: esqueleto', async () => {
    mockApi('GET', `/api/songs/${ID}`, () => new Promise(() => {}))
    const wrapper = await mountSuspended(CancionPage, { route: `/canciones/${ID}` })
    await nextTick()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
  })

  it('no encontrada: «Esa canción ya no existe» con «Volver a Canciones»', async () => {
    mockApi('GET', `/api/songs/${ID}`, failWith(404))
    const wrapper = await mountSong()
    await flush()
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Esa canción ya no existe.')
    expect(alert.get('a').text()).toBe('Volver a Canciones')
  })

  it('error con reintento y luego el contenido', async () => {
    mockApi('GET', `/api/songs/${ID}`, failWith(500))
    const wrapper = await mountSong()
    await flush()
    expect(wrapper.text()).toContain('No pudimos cargar la canción')
    mockApi('GET', `/api/songs/${ID}`, songDetail())
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush()
    expect(wrapper.get('h1').text()).toBe('De Buenas')
  })

  it('Volver a obtener la letra pide confirmación y muestra la letra nueva', async () => {
    mockApi('POST', `/api/songs/${ID}/refresh`, songDetail({ lyrics: [['nueva']], lineCount: 1 }))
    const wrapper = await mountSong()
    await flush()
    await buttonsWithText(wrapper, 'Volver a obtener la letra')[0]!.trigger('click')
    await flush()
    const confirm = useConfirm()
    expect(confirm.options.value?.message).toBe('¿Volver a obtener la letra? Reemplaza la guardada si el nuevo rastreo tiene éxito.')
    confirm.accept()
    await flush(10)
    expect(calls.some(c => c.method === 'POST' && c.url === `/api/songs/${ID}/refresh`)).toBe(true)
    expect(wrapper.text()).toContain('nueva')
    expect(useToast().toasts.value.map(t => t.message)).toContain('Letra actualizada')
  })

  it('si se cancela la confirmación no rastrea', async () => {
    const wrapper = await mountSong()
    await flush()
    await buttonsWithText(wrapper, 'Volver a obtener la letra')[0]!.trigger('click')
    await flush()
    useConfirm().cancel()
    await flush()
    expect(calls.some(c => c.url === `/api/songs/${ID}/refresh`)).toBe(false)
  })

  it('un fallo al volver a obtenerla avisa y deja la letra', async () => {
    mockApi('POST', `/api/songs/${ID}/refresh`, failWith(502, { code: 'crawl_failed' }))
    const wrapper = await mountSong()
    await flush()
    await buttonsWithText(wrapper, 'Volver a obtener la letra')[0]!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush(10)
    expect(useToast().toasts.value.map(t => t.message)).toContain('No pudimos leer la página de la canción. Intenta de nuevo en un momento.')
    expect(wrapper.text()).toContain('tres')
  })

  it('Generar presentación encola la canción; un doble clic hace una sola petición', async () => {
    useState('songs-presentations').value = []
    let resolve: () => void = () => {}
    mockApi('POST', `/api/songs/${ID}/pptx`, () => new Promise<Buffer>((r) => {
      resolve = () => r(Buffer.from([1]))
    }))
    const wrapper = await mountSong()
    await flush()
    const generate = buttonsWithText(wrapper, 'Generar presentación')[0]!
    await generate.trigger('click')
    await generate.trigger('click')
    await flush()
    expect(calls.filter(c => c.url === `/api/songs/${ID}/pptx`)).toHaveLength(1)
    expect(buttonsWithText(wrapper, 'Generar presentación')[0]!.attributes('disabled')).toBeDefined()
    resolve()
    useState('songs-presentations').value = []
  })

  it('el aviso del servicio aparece si no responde', async () => {
    mockApi('GET', '/api/youtube/health', failWith(503, { state: 'notConfigured' }))
    const wrapper = await mountSong()
    await flush()
    expect(wrapper.text()).toContain('El servicio de descargas no está configurado')
  })
})

describe('/canciones · fila Colecciones', () => {
  const collection = { id: 'c1', name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 2, createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z' }

  it('cargando, error con Reintentar, vacío con «Nueva colección» y contenido', async () => {
    mockApi('GET', '/api/songs/collections', () => new Promise(() => {}))
    const loading = await mountSuspended(CancionesPage)
    await nextTick()
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)

    clearNuxtData()
    mockApi('GET', '/api/songs/collections', failWith(500))
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await flush()
    expect(wrapper.text()).toContain('No pudimos cargar las colecciones')

    mockApi('GET', '/api/songs/collections', { items: [] })
    await wrapper.findAll('[role="alert"]').find(a => a.text().includes('colecciones'))!.find('button').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Aún no hay colecciones')
    expect(wrapper.text()).toContain('Crea la primera aquí o desde una canción.')
    expect(buttonsWithText(wrapper, 'Nueva colección')).toHaveLength(1)

    mockApi('GET', '/api/songs/collections', { items: [collection] })
    await refreshNuxtData('song-collections')
    await flush()
    expect(wrapper.find('[aria-label="Colecciones del equipo"]').text()).toContain('Domingo')
    // Con colecciones, «Nueva colección» queda en la cabecera de la fila.
    expect(buttonsWithText(wrapper, 'Nueva colección')).toHaveLength(1)
    wrapper.unmount()
  })

  it('«Nueva colección» abre el diálogo en modo crear vacía y la colección aparece en la fila', async () => {
    const created = { ...collection, id: 'c9', name: 'Ensayo', itemCount: 0 }
    mockApi('POST', '/api/songs/collections', created)
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await flush()
    await buttonsWithText(wrapper, 'Nueva colección')[0]!.trigger('click')
    // El diálogo es diferido (`Lazy*`): se espera a que llegue su chunk.
    await vi.waitUntil(() => wrapper.find('dialog').exists(), { timeout: 3000 })
    const dialog = wrapper.get('dialog')
    expect(dialog.get('h2').text()).toBe('Nueva colección')
    await dialog.get('input').setValue('Ensayo')
    mockApi('GET', '/api/songs/collections', { items: [created] })
    await dialog.get('form').trigger('submit')
    await flush(15)
    expect(calls.find(c => c.method === 'POST' && c.url === '/api/songs/collections')?.body).toEqual({ name: 'Ensayo' })
    expect(wrapper.find('[aria-label="Colecciones del equipo"]').text()).toContain('Ensayo')
    expect(wrapper.find('dialog').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('/canciones · Historial', () => {
  const item = (n: number) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`, title: `Canción ${n}`, artist: 'Banda', sourceUrl: `https://letras.com/a/c${n}`,
    viewedAt: new Date(Date.now() - 3_600_000).toISOString(), viewedBy: { userId: 'u2', name: 'Luis', active: true },
  })

  it('la selección vive en useState y sobrevive a un reintento; la barra genera con confirmación', async () => {
    mockApi('GET', '/api/songs/history', { items: [item(1), item(2)], nextCursor: null })
    mockApi('POST', `/api/songs/${item(1).id}/pptx`, () => new Promise(() => {}))
    const wrapper = await mountSuspended(CancionesPage, { attachTo: document.body })
    await flush(10)
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    await boxes[0]!.setValue(true)
    await boxes[1]!.setValue(true)
    expect(useState('songs-history-selected').value).toEqual([item(1).id, item(2).id])

    // Un error y su reintento no pierden la selección.
    mockApi('GET', '/api/songs/history', failWith(500))
    await refreshNuxtData('songs-history')
    await flush()
    mockApi('GET', '/api/songs/history', { items: [item(1), item(2)], nextCursor: null })
    await refreshNuxtData('songs-history')
    await flush()
    expect(useState('songs-history-selected').value).toEqual([item(1).id, item(2).id])

    const bar = wrapper.get('[role="region"][aria-label="Selección"]')
    expect(bar.text()).toContain('2 seleccionadas')
    expect(bar.text()).toContain('Recibirás 2 archivos, uno por canción.')
    await buttonsWithText(bar, 'Generar selección')[0]!.trigger('click')
    await flush()
    expect(useConfirm().options.value?.message).toBe('Recibirás 2 archivos, uno por canción.')
    useConfirm().accept()
    await flush()
    expect(useState<{ songId: string }[]>('songs-presentations').value.map(i => i.songId)).toEqual([item(1).id, item(2).id])
    expect(useState('songs-history-selected').value).toEqual([])
    useState('songs-presentations').value = []
    wrapper.unmount()
  })

  it('la ficha muestra el historial reciente sin la canción actual', async () => {
    mockApi('GET', '/api/songs/history', (event: { path: string }) => ({
      items: event.path.includes(`exclude=${ID}`) ? [item(3)] : [],
      nextCursor: null,
    }))
    const wrapper = await mountSuspended(CancionPage, { route: `/canciones/${ID}` })
    await flush(10)
    const recent = wrapper.get('[aria-label="Canciones consultadas recientemente"]')
    expect(recent.text()).toContain('Canción 3')
    expect(recent.find('input[type="checkbox"]').exists()).toBe(false)
    expect(calls.some(c => c.url === '/api/songs/history')).toBe(true)
  })
})
