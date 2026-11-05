// T044/T056 — Página /youtube (feature 005): fila Listas (cuatro estados, tarjeta, descarga por lotes) e Historial
// (cuatro estados, selección múltiple, barra de selección, quitar con confirmación, página siguiente).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { Me, YoutubeDownloadItem, YoutubeHistoryItem, YoutubeHistoryPage, YoutubePlaylist } from '#shared/types/api'
import YoutubePage from '~/pages/youtube/index.vue'
import YoutubePlaylistCard from '~/components/youtube/YoutubePlaylistCard.vue'
import YoutubeSelectionBar from '~/components/youtube/YoutubeSelectionBar.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

function setMe(role: 'admin' | 'editor', userId = 'u1') {
  const me: Me = {
    user: { id: userId, email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId, email: 'ana@iglesia.org', name: 'Ana', role, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
}

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]
/** El menú de opciones de una lista es flotante (va en `body`, fuera del componente). */
const floatingItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(el => new DOMWrapper(el))
const ids = (n: number) => Array.from({ length: n }, (_, i) => `video${String(i).padStart(6, '0')}`)

const playlist = (changes: Partial<YoutubePlaylist> = {}): YoutubePlaylist => ({
  id: 'p1',
  name: 'Domingo',
  author: { userId: 'u1', name: 'Ana', active: true },
  itemCount: 2,
  covers: ['https://i.ytimg.com/a.jpg'],
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...changes,
})

const historyItem = (n: number, changes: Partial<YoutubeHistoryItem> = {}): YoutubeHistoryItem => ({
  videoId: ids(n + 1)[n]!,
  title: `Video ${n}`,
  channel: 'Canal',
  durationSeconds: 125,
  thumbnailUrl: null,
  viewedAt: new Date(Date.now() - 3_600_000).toISOString(),
  viewedBy: { userId: 'u2', name: 'Luis', active: true },
  ...changes,
})

const page = (items: YoutubeHistoryItem[], nextCursor: string | null = null): YoutubeHistoryPage => ({ items, nextCursor })

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  useState('youtube-history-selected').value = []
  useState('youtube-downloads').value = { rows: [], groups: [] }
  setMe('editor')
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/youtube/health', { state: 'up' })
  mockApi('GET', '/api/youtube/playlists', { items: [playlist()] })
  mockApi('GET', '/api/youtube/history', page([historyItem(0), historyItem(1)]))
  mockApi('POST', '/api/youtube/jobs', { jobId: 'f'.repeat(32), status: 'queued', format: 'mp3', progress: 0, items: [], downloadUrl: null, filename: null, sizeBytes: null, expiresAt: null })
})

describe('/youtube · fila Listas', () => {
  it('cargando, error con Reintentar, vacío y contenido', async () => {
    mockApi('GET', '/api/youtube/playlists', () => new Promise(() => {}))
    const loading = await mountSuspended(YoutubePage)
    await nextTick()
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)

    clearNuxtData()
    mockApi('GET', '/api/youtube/playlists', failWith(500))
    const wrapper = await mountSuspended(YoutubePage, { attachTo: document.body })
    await flush()
    expect(wrapper.text()).toContain('No pudimos cargar las listas')

    mockApi('GET', '/api/youtube/playlists', { items: [] })
    await wrapper.findAll('[role="alert"]').find(a => a.text().includes('listas'))!.find('button').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Aún no hay listas')
    expect(wrapper.text()).toContain('Abre un video y pulsa Crear lista')

    mockApi('GET', '/api/youtube/playlists', { items: [playlist()] })
    await refreshNuxtData('youtube-playlists')
    await flush()
    expect(wrapper.text()).toContain('Domingo')
  })

  it('Descargar lista pide los videos y encola por lotes, avisando cuántos archivos recibirá', async () => {
    mockApi('GET', '/api/youtube/playlists/p1', { ...playlist({ itemCount: 12 }), items: ids(12).map(videoId => ({ videoId, title: videoId, channel: null, durationSeconds: 1, thumbnailUrl: null, addedAt: '2026-11-01T10:00:00.000Z', addedBy: { userId: 'u1', name: 'Ana', active: true } })) })
    const wrapper = await mountSuspended(YoutubePage)
    await flush()
    await wrapper.get('[aria-label="Opciones de Domingo"]').trigger('click')
    await floatingItems().find(o => o.text().includes('Descargar audio MP3'))!.trigger('click')
    await flush()
    const posts = calls.filter(c => c.method === 'POST' && c.url === '/api/youtube/jobs')
    expect(posts).toHaveLength(1)
    expect((posts[0]!.body as { videoIds: string[], format: string }).videoIds).toHaveLength(10)
    expect(useToast().toasts.value.some(t => t.message === 'Recibirás 2 archivos')).toBe(true)
  })
})

describe('YoutubePlaylistCard', () => {
  it('4 miniaturas, nombre, «N videos» y autor; el botón de opciones es alcanzable sin hover', async () => {
    const wrapper = await mountSuspended(YoutubePlaylistCard, { props: { playlist: playlist() } })
    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(wrapper.findAll('img')[0]!.attributes('loading')).toBe('lazy')
    expect(wrapper.text()).toContain('Domingo')
    expect(wrapper.text()).toContain('2 videos')
    expect(wrapper.text()).toContain('Creada por Ana')
    const options = wrapper.get('[aria-label="Opciones de Domingo"]')
    expect(options.element.tagName).toBe('BUTTON')
    // Visible siempre en móvil; en escritorio también con el foco dentro (no solo con hover).
    expect(options.element.closest('div.absolute')!.className).toContain('lg:group-focus-within:opacity-100')
    await wrapper.get('[aria-label^="Abrir la lista Domingo"]').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('el menú agrupa las descargas y «Guardar en el drive», y emite el formato elegido', async () => {
    const wrapper = await mountSuspended(YoutubePlaylistCard, { props: { playlist: playlist() } })
    await wrapper.get('[aria-label="Opciones de Domingo"]').trigger('click')
    expect(floatingItems().map(o => o.text())).toEqual([
      'Descargar video 720p',
      'Descargar video 1080p',
      'Descargar audio MP3',
      'Guardar en el drive: video 720p',
      'Guardar en el drive: audio MP3',
    ])
    await floatingItems().find(o => o.text().includes('Descargar video 1080p'))!.trigger('click')
    expect(wrapper.emitted('download')).toEqual([[expect.objectContaining({ id: 'p1' }), 'mp4_1080']])
    await wrapper.get('[aria-label="Opciones de Domingo"]').trigger('click')
    await floatingItems().find(o => o.text().includes('Guardar en el drive: audio MP3'))!.trigger('click')
    expect(wrapper.emitted('drive')).toEqual([[expect.objectContaining({ id: 'p1' }), 'mp3']])
  })

  it('autor inactivo y lista vacía', async () => {
    const wrapper = await mountSuspended(YoutubePlaylistCard, { props: { playlist: playlist({ author: { userId: 'u3', name: 'Eva', active: false }, itemCount: 1, covers: [] }) } })
    expect(wrapper.text()).toContain('Usuario que ya no está activo')
    expect(wrapper.text()).toContain('1 video')
    const empty = await mountSuspended(YoutubePlaylistCard, { props: { playlist: playlist({ itemCount: 0 }) } })
    expect(empty.get('[aria-label="Opciones de Domingo"]').attributes('disabled')).toBeDefined()
  })
})

describe('/youtube · Historial', () => {
  it('cargando, error con Reintentar, vacío y contenido', async () => {
    mockApi('GET', '/api/youtube/history', () => new Promise(() => {}))
    const loading = await mountSuspended(YoutubePage)
    await nextTick()
    expect(loading.findAll('[aria-busy="true"]').length).toBeGreaterThan(0)

    clearNuxtData()
    mockApi('GET', '/api/youtube/history', failWith(500))
    const wrapper = await mountSuspended(YoutubePage)
    await flush()
    expect(wrapper.text()).toContain('No pudimos cargar el historial')

    mockApi('GET', '/api/youtube/history', page([]))
    await wrapper.findAll('[role="alert"]').find(a => a.text().includes('historial'))!.find('button').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Todavía no hay videos')
    expect(wrapper.text()).toContain('Pega el primer enlace arriba')
  })

  it('cada tarjeta tiene casilla con nombre, menú, duración y quién la abrió', async () => {
    const wrapper = await mountSuspended(YoutubePage)
    await flush()
    expect(wrapper.find('[aria-label="Seleccionar Video 0"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Acciones de Video 0"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('2:05')
    expect(wrapper.text()).toMatch(/Luis · hace/)
    expect(wrapper.find('a[href="/youtube/video000000"]').exists()).toBe(true)
  })

  it('marcar muestra la barra; Descargar selección encola y la selección sobrevive; Limpiar la oculta', async () => {
    const wrapper = await mountSuspended(YoutubePage)
    await flush()
    expect(wrapper.find('[aria-label="Selección"]').exists()).toBe(false)
    await wrapper.get('[aria-label="Seleccionar Video 0"]').setValue(true)
    await wrapper.get('[aria-label="Seleccionar Video 1"]').setValue(true)
    await flush()
    const bar = wrapper.get('[aria-label="Selección"]')
    expect(bar.text()).toContain('2 seleccionados')
    await button(bar, 'Descargar selección')!.trigger('click')
    await bar.findAll('[role="menuitemradio"]').find(o => o.text().includes('Audio MP3'))!.trigger('click')
    await flush()
    const post = calls.find(c => c.method === 'POST' && c.url === '/api/youtube/jobs')
    expect(post?.body).toEqual({ videoIds: ['video000000', 'video000001'], format: 'mp3' })
    expect(useState<string[]>('youtube-history-selected').value).toHaveLength(2)
    await button(wrapper.get('[aria-label="Selección"]'), 'Limpiar')!.trigger('click')
    await flush()
    expect(wrapper.find('[aria-label="Selección"]').exists()).toBe(false)
  })

  it('quitar del historial pide confirmación y la tarjeta desaparece', async () => {
    mockApi('DELETE', '/api/youtube/history/video000000', null)
    const wrapper = await mountSuspended(YoutubePage)
    await flush()
    await wrapper.get('[aria-label="Acciones de Video 0"]').trigger('click')
    await button(wrapper, 'Quitar del historial')!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush()
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/youtube/history/video000000')).toBe(true)
    expect(wrapper.find('[aria-label="Seleccionar Video 0"]').exists()).toBe(false)
    expect(useToast().toasts.value.at(-1)?.message).toBe('Se quitó «Video 0» del historial')
  })

  it('Cargar más pide la página siguiente; un fallo muestra Reintentar en línea', async () => {
    mockApi('GET', '/api/youtube/history', event =>
      event.path.includes('cursor=') ? failWith(500)(event) : page([historyItem(0)], 'c1'))
    const wrapper = await mountSuspended(YoutubePage)
    await flush()
    const more = button(wrapper, 'Cargar más')
    if (more) await more.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('No pudimos cargar más videos')
    mockApi('GET', '/api/youtube/history', event =>
      event.path.includes('cursor=') ? page([historyItem(5)]) : page([historyItem(0)], 'c1'))
    const retry = wrapper.findAll('[role="alert"]').find(a => a.text().includes('más videos'))!.find('button')
    await retry.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Video 5')
  })
})

describe('/youtube · acciones de la tarjeta, enlace y aviso del servicio', () => {
  it('Descargar audio o video encola ese video; Agregar a lista abre el diálogo; Abrir navega', async () => {
    const wrapper = await mountSuspended(YoutubePage, { attachTo: document.body })
    await flush()
    const choose = async (label: string) => {
      await wrapper.get('[aria-label="Acciones de Video 0"]').trigger('click')
      await button(wrapper, label)!.trigger('click')
      await flush()
    }
    await choose('Descargar audio MP3')
    await choose('Descargar video 720p')
    expect(calls.filter(c => c.method === 'POST' && c.url === '/api/youtube/jobs').map(c => (c.body as { format: string }).format)).toEqual(['mp3', 'mp4_720'])
    await choose('Agregar a lista')
    // El diálogo se carga diferido (`Lazy*`).
    await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(true), { timeout: 5000 })
    expect(wrapper.text()).toContain('Guardar en una lista')
    await wrapper.get('dialog [aria-label="Cerrar"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(false))
    await choose('Abrir')
    await vi.waitFor(() => expect(useRouter().currentRoute.value.path).toBe('/youtube/video000000'), { timeout: 5000 })
    wrapper.unmount()
  })

  it('pegar un enlace navega a la ficha; el servicio dormido muestra el aviso con Reintentar', async () => {
    mockApi('GET', '/api/youtube/health', { state: 'waking' })
    const wrapper = await mountSuspended(YoutubePage)
    await flush()
    expect(wrapper.text()).toContain('Despertando el servicio')
    await wrapper.get('input[type="url"]').setValue('https://youtu.be/okShortVid1')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(useRouter().currentRoute.value.path).toBe('/youtube/okShortVid1'), { timeout: 5000 })
  })

  it('tocar una lista abre su detalle; si pedir sus videos falla, avisa', async () => {
    mockApi('GET', '/api/youtube/playlists/p1', failWith(500))
    const wrapper = await mountSuspended(YoutubePage, { attachTo: document.body })
    await flush()
    await wrapper.get('[aria-label="Opciones de Domingo"]').trigger('click')
    await floatingItems().find(o => o.text().includes('Descargar audio MP3'))!.trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)?.type).toBe('error')
    await wrapper.get('[aria-label^="Abrir la lista Domingo"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(true), { timeout: 5000 })
    wrapper.unmount()
  })
})

describe('/youtube · interruptor Historial / Descargas', () => {
  const download = (n: number, changes: Partial<YoutubeDownloadItem> = {}): YoutubeDownloadItem => ({
    videoId: ids(n + 1)[n]!,
    title: `Descarga ${n}`,
    channel: 'Canal',
    durationSeconds: 125,
    thumbnailUrl: null,
    format: 'mp3',
    downloadedAt: new Date(Date.now() - 3_600_000).toISOString(),
    downloadedBy: { userId: 'u2', name: 'Luis', active: true },
    ...changes,
  })
  const heading = (wrapper: Queryable) => wrapper.findAll('h2').map(h => h.text())

  beforeEach(() => {
    useState('youtube-section').value = 'history'
    mockApi('GET', '/api/youtube/downloads', { items: [download(0), download(1, { format: 'mp4_720', downloadedBy: null })], nextCursor: null })
  })

  it('Historial por defecto; «Descargas» cambia el título y muestra la rejilla sin pedirla antes', async () => {
    const wrapper = await mountSuspended(YoutubePage)
    await flush()
    expect(heading(wrapper)).toContain('Historial')
    expect(wrapper.get('[aria-label="Cambiar de sección"]').findAll('button').map(b => [b.text(), b.attributes('aria-pressed')])).toEqual([['Historial', 'true'], ['Descargas', 'false']])
    expect(calls.some(c => c.url === '/api/youtube/downloads')).toBe(false)

    await button(wrapper, 'Descargas')!.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Descarga 0'), { timeout: 5000 })
    expect(heading(wrapper)).toContain('Descargas')
    expect(heading(wrapper)).not.toContain('Historial')
    expect(wrapper.get('[aria-label="Cambiar de sección"]').findAll('button').map(b => b.attributes('aria-pressed'))).toEqual(['false', 'true'])
    const grid = wrapper.get('ul[aria-label="Videos descargados"]')
    expect(grid.findAll('li')).toHaveLength(2)
    expect(grid.text()).toContain('Audio MP3')
    expect(grid.text()).toContain('Video 720p')
    expect(grid.text()).toContain('Luis')
    expect(grid.text()).toContain(messages.youtube.inactiveUser)
    expect(grid.get('a').attributes('href')).toBe('/youtube/video000000')
    expect(grid.classes()).toContain('grid')
    // El historial queda oculto, no desmontado: conserva sus páginas y la selección.
    expect(wrapper.get('ul[aria-label="Videos consultados"]').element.parentElement!.style.display).toBe('none')

    await button(wrapper, 'Historial')!.trigger('click')
    await flush()
    expect(heading(wrapper)).toContain('Historial')
    expect(wrapper.get('ul[aria-label="Videos consultados"]').element.parentElement!.style.display).not.toBe('none')
  })

  it('la barra de selección solo aparece en Historial', async () => {
    useState('youtube-history-selected').value = ['video000000']
    const wrapper = await mountSuspended(YoutubePage)
    await flush()
    expect(wrapper.findComponent(YoutubeSelectionBar).exists()).toBe(true)
    await button(wrapper, 'Descargas')!.trigger('click')
    await flush()
    expect(wrapper.findComponent(YoutubeSelectionBar).exists()).toBe(false)
    await button(wrapper, 'Historial')!.trigger('click')
    await flush()
    expect(wrapper.findComponent(YoutubeSelectionBar).exists()).toBe(true)
  })

  it('Descargas: vacío, error con Reintentar y «Cargar más» con la página siguiente', async () => {
    useState('youtube-section').value = 'downloads'
    mockApi('GET', '/api/youtube/downloads', { items: [], nextCursor: null })
    const empty = await mountSuspended(YoutubePage)
    await vi.waitFor(() => expect(empty.text()).toContain('Todavía no hay descargas'), { timeout: 5000 })

    clearNuxtData()
    mockApi('GET', '/api/youtube/downloads', failWith(500))
    const failed = await mountSuspended(YoutubePage)
    await vi.waitFor(() => expect(failed.text()).toContain('No pudimos cargar las descargas'), { timeout: 5000 })

    mockApi('GET', '/api/youtube/downloads', { items: [download(0)], nextCursor: 'abc' })
    await failed.findAll('[role="alert"]').find(a => a.text().includes('descargas'))!.find('button').trigger('click')
    await vi.waitFor(() => expect(failed.text()).toContain('Descarga 0'), { timeout: 5000 })
    mockApi('GET', '/api/youtube/downloads', { items: [download(0), download(5)], nextCursor: null })
    await button(failed, 'Cargar más')!.trigger('click')
    await vi.waitFor(() => expect(failed.text()).toContain('Descarga 5'), { timeout: 5000 })
    expect(failed.findAll('ul[aria-label="Videos descargados"] li')).toHaveLength(2)
    expect(calls.filter(c => c.url === '/api/youtube/downloads').at(-1)).toBeDefined()
  })
})

describe('YoutubeSelectionBar', () => {
  it('con más de 10 avisa cuántos archivos recibirá', async () => {
    const one = await mountSuspended(YoutubeSelectionBar, { props: { count: 3 } })
    expect(one.text()).toContain('3 seleccionados')
    expect(one.text()).not.toContain('Recibirás')
    const many = await mountSuspended(YoutubeSelectionBar, { props: { count: 12 } })
    expect(many.text()).toContain('Recibirás 2 archivos')
    const clear = vi.fn()
    const bar = await mountSuspended(YoutubeSelectionBar, { props: { count: 1, onClear: clear } })
    await button(bar, 'Limpiar')!.trigger('click')
    expect(clear).toHaveBeenCalled()
    await bar.get('button[aria-haspopup="menu"]').trigger('click')
    await bar.findAll('[role="menuitemradio"]').find(o => o.text().includes('Video 1080p'))!.trigger('click')
    expect(bar.emitted('download')).toEqual([['mp4_1080']])
  })

  it('desde md siempre deja libre la esquina de la bandeja: el mismo sitio con o sin ella, sin saltos al abrirla o cerrarla', async () => {
    const downloads = useState<{ rows: unknown[], groups: unknown[] }>('youtube-downloads')
    const before = downloads.value
    const docked = ['md:bottom-4', 'md:right-[26rem]', 'md:max-w-3xl']
    downloads.value = { rows: [], groups: [] }
    const bar = await mountSuspended(YoutubeSelectionBar, { props: { count: 1 } })
    expect(bar.classes()).toEqual(expect.arrayContaining(docked))
    expect(bar.classes()).not.toContain('md:right-4')

    downloads.value = { rows: [{ id: 1 }], groups: [] }
    await nextTick()
    expect(bar.classes()).toEqual(expect.arrayContaining(docked))
    downloads.value = { rows: [], groups: [] }
    await nextTick()
    expect(bar.classes()).toEqual(expect.arrayContaining(docked))
    downloads.value = before
  })
})

describe('useYoutubePlaylists', () => {
  it('sin sesión nadie puede renombrar; crear sin video manda solo el nombre', async () => {
    mockApi('POST', '/api/youtube/playlists', playlist({ name: 'Vacía', itemCount: 0 }))
    const playlists = useYoutubePlaylists()
    useMe().me.value = null
    expect(playlists.canManage(playlist())).toBe(false)
    setMe('editor', 'u1')
    expect(playlists.canManage(playlist())).toBe(true)
    expect(await playlists.create('Vacía')).toMatchObject({ name: 'Vacía' })
    expect(calls.find(c => c.method === 'POST')?.body).toEqual({ name: 'Vacía' })
    // Cancelar la confirmación no borra nada.
    const removing = playlists.remove(playlist())
    await flush()
    useConfirm().cancel()
    expect(await removing).toBe(false)
    const quitting = playlists.removeVideo(playlist(), { videoId: 'okShortVid1', title: 'Alabanza' })
    await flush()
    useConfirm().cancel()
    expect(await quitting).toBe(false)
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  })
})
