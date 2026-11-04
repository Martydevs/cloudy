// T067 — Ficha y ventana externa (feature 005, US1/US4): la ficha muestra sus estados y abre la ventana externa; la
// ventana monta el reproductor incrustado de YouTube ya en marcha y se cierra con su botón.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { YoutubeVideoDetail } from '#shared/types/api'
import VideoPage from '~/pages/youtube/[id]/index.vue'
import WindowPage from '~/pages/youtube/[id]/ventana.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, failWith, flush, mockApi, resetCalls } from './helpers/api'

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]

const detail = (changes: Partial<YoutubeVideoDetail> = {}): YoutubeVideoDetail => ({
  videoId: 'okShortVid1', title: 'Alabanza', channel: 'Iglesia', durationSeconds: 185, thumbnailUrl: null,
  availableHeights: [720], downloadable: true, reason: null, ...changes,
})

let open: ReturnType<typeof vi.spyOn>
let close: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  // Con sesión de editor: sin ella el middleware lleva a /login.
  useMe().me.value = {
    user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().loaded.value = true
  mockApi('GET', '/api/me', () => useMe().me.value)
  useState('youtube-downloads').value = { rows: [], groups: [] }
  mockApi('GET', '/api/youtube/health', { state: 'up' })
  mockApi('GET', '/api/youtube/history', { items: [], nextCursor: null })
  mockApi('GET', '/api/youtube/videos/okShortVid1', detail())
  open = vi.spyOn(window, 'open').mockImplementation(() => null)
  close = vi.spyOn(window, 'close').mockImplementation(() => {})
})

afterEach(() => {
  open.mockRestore()
  close.mockRestore()
})

describe('/youtube/:id', () => {
  it('el reproductor aparece al instante, antes de que lleguen los datos del servicio', async () => {
    mockApi('GET', '/api/youtube/videos/okShortVid1', () => new Promise(() => {}))
    const wrapper = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(10)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Reproducir"]').exists()).toBe(true)
    await wrapper.get('button[aria-label="Reproducir"]').trigger('click')
    expect(wrapper.get('iframe').attributes('src')).toContain('/embed/okShortVid1?')
    expect(wrapper.find('h1').exists()).toBe(false)
  })

  it('muestra la ficha y su historial reciente vacío', async () => {
    const wrapper = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(10)
    expect(wrapper.get('h1').text()).toBe('Alabanza')
    expect(wrapper.text()).toContain('Historial reciente')
    expect(wrapper.text()).toContain('Todavía no hay otros videos')
  })

  it('un video privado sin datos muestra el motivo y la vuelta a YouTube', async () => {
    mockApi('GET', '/api/youtube/videos/okShortVid1', failWith(404, { code: 'private' }))
    const wrapper = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(10)
    expect(wrapper.get('[role="alert"]').text()).toContain('Este video es privado')
  })

  it('con el servicio dormido muestra el aviso con Reintentar', async () => {
    mockApi('GET', '/api/youtube/videos/okShortVid1', failWith(503, { state: 'waking' }))
    const wrapper = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(10)
    expect(wrapper.text()).toContain('Despertando el servicio')
    // El reproductor no depende del servicio: está ahí, con la miniatura de YouTube, aunque la ficha no cargue.
    expect(wrapper.find('button[aria-label="Reproducir"]').exists()).toBe(true)
    expect(wrapper.get('img').attributes('src')).toBe('https://i.ytimg.com/vi/okShortVid1/hqdefault.jpg')
    expect(button(wrapper, 'Reintentar')).toBeDefined()
  })

  it('cola llena → aviso de ocupado; otro error → ErrorState; Reintentar vuelve a pedir la ficha', async () => {
    mockApi('GET', '/api/youtube/videos/okShortVid1', failWith(429))
    const busy = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(10)
    expect(busy.text()).toContain('El servicio está ocupado')
    mockApi('GET', '/api/youtube/videos/okShortVid1', detail())
    await button(busy, 'Reintentar')!.trigger('click')
    await flush(10)
    expect(busy.get('h1').text()).toBe('Alabanza')
    // Con la ficha cargada el aviso del servicio ya no se muestra.
    expect(busy.text()).not.toContain('El servicio está ocupado')
    busy.unmount()

    clearNuxtData()
    mockApi('GET', '/api/youtube/videos/okShortVid1', failWith(500))
    const broken = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(10)
    expect(broken.text()).toContain('No pudimos cargar el video')
    expect(broken.find('button[aria-label="Reproducir"]').exists()).toBe(true)
    broken.unmount()

    clearNuxtData()
    mockApi('GET', '/api/youtube/videos/okShortVid1', failWith(404, { code: 'raro' }, 'No encontramos ese video. Revisa el enlace.'))
    const missing = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(10)
    expect(missing.get('[role="alert"]').text()).toMatch(/No encontramos ese video|No pudimos cargar el video/)
  })

  it('si la ficha cargó aunque el último ping siga en «despertando», no muestra el aviso (el servicio ya respondió)', async () => {
    mockApi('GET', '/api/youtube/health', failWith(502))
    const wrapper = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(10)
    expect(wrapper.get('h1').text()).toBe('Alabanza')
    expect(wrapper.text()).not.toContain('Despertando el servicio')
  })

  it('con el servicio caído (down) pero la ficha cargada, muestra el aviso; Crear lista abre el diálogo', async () => {
    mockApi('GET', '/api/youtube/health', { state: 'down' })
    mockApi('GET', '/api/youtube/playlists', { items: [] })
    const wrapper = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(10)
    expect(wrapper.text()).toContain('El servicio de descargas no está disponible ahora')
    await button(wrapper, 'Crear lista')!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(true), { timeout: 5000 })
  })

  it('muestra el reproductor con su miniatura y «Abrir en ventana nueva» abre la ventana externa', async () => {
    const wrapper = await mountSuspended(VideoPage, { route: '/youtube/okShortVid1' })
    await flush(15)
    expect(wrapper.find('[aria-label="Reproducir: Alabanza"]').exists()).toBe(true)
    expect(wrapper.find('iframe').exists()).toBe(false)
    await button(wrapper, 'Abrir en ventana nueva')!.trigger('click')
    expect(open).toHaveBeenCalledWith('/youtube/okShortVid1/ventana', 'cloudy-player', 'popup,width=1100,height=640')
  })
})

describe('/youtube/:id/ventana', () => {
  it('reproduce el video incrustado ya en marcha, con su título; Cerrar ventana cierra', async () => {
    const wrapper = await mountSuspended(WindowPage, { route: '/youtube/okShortVid1/ventana' })
    await flush(15)
    expect(wrapper.get('h1').text()).toBe('Alabanza')
    expect(wrapper.get('iframe').attributes('src')).toContain('https://www.youtube-nocookie.com/embed/okShortVid1?autoplay=1')
    await button(wrapper, 'Cerrar ventana')!.trigger('click')
    expect(close).toHaveBeenCalled()
  })
})
