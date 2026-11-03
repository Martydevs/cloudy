// T022/T067 — Reproductor (feature 005, research D5): no crea nada hasta pulsar, pasa por preparar → listo con su barra,
// atiende el teclado, ofrece Reintentar y Preparar de nuevo, y la pantalla completa va sobre el contenedor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { YoutubeJob } from '#shared/types/api'
import YoutubePlayer from '~/components/youtube/YoutubePlayer.vue'
import { calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const { ticks, fullscreen } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    ticks: [] as (() => unknown)[],
    fullscreen: { isFullscreen: ref(false), toggle: vi.fn(async () => {}), exit: vi.fn(async () => {}), target: null as unknown },
  }
})
// El sondeo se dispara a mano: el reloj real de 2,5 s no hace falta para probar las transiciones.
mockNuxtImport('useIntervalFn', () => (fn: () => unknown) => {
  ticks.push(fn)
  return { pause: vi.fn(), resume: vi.fn(), isActive: { value: false } }
})
mockNuxtImport('useFullscreen', () => (target: unknown) => {
  fullscreen.target = target
  return { isFullscreen: fullscreen.isFullscreen, toggle: fullscreen.toggle, exit: fullscreen.exit, enter: vi.fn(), isSupported: { value: true } }
})

const JOB = 'c'.repeat(32)
const job = (changes: Partial<YoutubeJob> = {}): YoutubeJob => ({
  jobId: JOB, status: 'running', format: 'mp4_720', progress: 40, items: [], downloadUrl: null, filename: null, sizeBytes: null, expiresAt: null, ...changes,
})
const ready = job({ status: 'done', progress: 100, downloadUrl: 'https://svc.test/v1/jobs/c/file?exp=1&sig=a' })

let play: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetCalls()
  ticks.length = 0
  fullscreen.toggle.mockClear()
  useState('youtube-preview-jobs').value = {}
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {})
})

afterEach(() => {
  play.mockRestore()
})

async function mount(props: Record<string, unknown> = {}) {
  return mountSuspended(YoutubePlayer, {
    props: { videoId: 'okShortVid1', poster: 'https://i.ytimg.com/vi/okShortVid1/hq.jpg', title: 'Alabanza', ...props },
    attachTo: document.body,
  })
}

async function pollOnce() {
  for (const tick of [...ticks]) await tick()
  await flush()
}

describe('YoutubePlayer', () => {
  it('en idle muestra el póster y «Preparar y reproducir» sin crear ningún trabajo', async () => {
    const wrapper = await mount()
    await flush()
    expect(wrapper.find('img').attributes('src')).toContain('i.ytimg.com')
    expect(wrapper.find('img').attributes('width')).toBe('480')
    expect(wrapper.find('[aria-label="Preparar y reproducir"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Se prepara una copia en 720p')
    expect(calls).toHaveLength(0)
    expect(wrapper.emitted('state')?.at(-1)).toEqual(['idle', null])
    wrapper.unmount()
  })

  it('idle → preparing (avance y Cancelar) → ready con <video> y su barra; arranca solo', async () => {
    mockApi('POST', '/api/youtube/jobs', job({ status: 'queued', progress: 0 }))
    mockApi('GET', `/api/youtube/jobs/${JOB}`, job())
    const wrapper = await mount()
    await wrapper.get('[aria-label="Preparar y reproducir"]').trigger('click')
    await flush()
    expect(calls[0]).toMatchObject({ method: 'POST', body: { videoIds: ['okShortVid1'], format: 'mp4_720' } })
    expect(wrapper.text()).toContain('Preparando el video… 0 %')
    expect(wrapper.find('progress').exists()).toBe(true)
    expect(wrapper.findAll('button').some(b => b.text() === 'Cancelar')).toBe(true)

    await pollOnce()
    expect(wrapper.text()).toContain('Preparando el video… 40 %')

    mockApi('GET', `/api/youtube/jobs/${JOB}`, ready)
    await pollOnce()
    const video = wrapper.get('video')
    expect(video.attributes('src')).toBe(ready.downloadUrl)
    expect(video.attributes('controls')).toBeUndefined()
    for (const label of ['Reproducir', 'Posición', 'Silenciar', 'Volumen', 'Pantalla completa']) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists(), label).toBe(true)
    }
    expect(play).toHaveBeenCalled()
    expect(wrapper.emitted('state')?.at(-1)).toEqual(['ready', JOB])
    expect(useYoutubeDownloads().getPreviewJob('okShortVid1')).toBe(JOB)
    wrapper.unmount()
  })

  it('el teclado con el foco en el reproductor: Espacio/K reproduce, ↑/↓ volumen, F pantalla completa', async () => {
    useYoutubeDownloads().setPreviewJob('okShortVid1', JOB)
    mockApi('GET', `/api/youtube/jobs/${JOB}`, ready)
    const wrapper = await mount()
    await flush()
    const region = wrapper.get('[role="region"]')
    const video = wrapper.get('video').element as HTMLVideoElement
    // Una copia ya preparada se muestra lista, pero sin arrancar sola.
    expect(play).not.toHaveBeenCalled()

    const press = (key: string) => region.element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    press(' ')
    expect(play).toHaveBeenCalledTimes(1)
    press('k')
    expect(play).toHaveBeenCalledTimes(2)
    press('ArrowDown')
    await flush()
    expect(video.volume).toBeCloseTo(0.9)
    press('ArrowUp')
    await flush()
    expect(video.volume).toBeCloseTo(1)
    press('ArrowRight')
    press('ArrowLeft')
    press('f')
    await flush()
    expect(fullscreen.toggle).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('el botón Pantalla completa actúa sobre el contenedor (la barra sigue visible) y se expone al padre', async () => {
    useYoutubeDownloads().setPreviewJob('okShortVid1', JOB)
    mockApi('GET', `/api/youtube/jobs/${JOB}`, ready)
    const wrapper = await mount()
    await flush()
    expect((fullscreen.target as { value: unknown }).value).toBe(wrapper.get('[role="region"]').element)
    await wrapper.get('[aria-label="Pantalla completa"]').trigger('click')
    expect(fullscreen.toggle).toHaveBeenCalledTimes(1)
    await (wrapper.vm as unknown as { fullscreen: () => Promise<void> }).fullscreen()
    expect(fullscreen.toggle).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('error al preparar → «Reintentar»', async () => {
    mockApi('POST', '/api/youtube/jobs', failWith(503))
    const wrapper = await mount()
    await wrapper.get('[aria-label="Preparar y reproducir"]').trigger('click')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('Despertando el servicio')
    expect(wrapper.findAll('button').some(b => b.text().includes('Reintentar'))).toBe(true)
    wrapper.unmount()
  })

  it('un trabajo que falla al prepararse pasa a error', async () => {
    mockApi('POST', '/api/youtube/jobs', job({ status: 'queued' }))
    mockApi('GET', `/api/youtube/jobs/${JOB}`, job({ status: 'failed' }))
    const wrapper = await mount()
    await wrapper.get('[aria-label="Preparar y reproducir"]').trigger('click')
    await flush()
    await pollOnce()
    expect(wrapper.text()).toContain('No pudimos preparar el video')
    wrapper.unmount()
  })

  it('con un trabajo inicial expirado (ventana externa) → «Preparar de nuevo»', async () => {
    mockApi('GET', `/api/youtube/jobs/${JOB}`, failWith(404, { code: 'expired' }))
    mockApi('POST', '/api/youtube/jobs', job({ status: 'queued' }))
    const wrapper = await mount({ initialJobId: JOB })
    await flush()
    expect(wrapper.text()).toContain('La copia expiró')
    const again = wrapper.findAll('button').find(b => b.text().includes('Preparar de nuevo'))!
    await again.trigger('click')
    await flush()
    expect(calls.some(c => c.method === 'POST')).toBe(true)
    wrapper.unmount()
  })

  it('una copia vieja de la ficha que ya no existe vuelve al póster sin error', async () => {
    useYoutubeDownloads().setPreviewJob('okShortVid1', JOB)
    mockApi('GET', `/api/youtube/jobs/${JOB}`, failWith(404, { code: 'expired' }))
    const wrapper = await mount()
    await flush()
    expect(wrapper.find('[aria-label="Preparar y reproducir"]').exists()).toBe(true)
    expect(useYoutubeDownloads().getPreviewJob('okShortVid1')).toBeNull()
    wrapper.unmount()
  })

  it('Cancelar durante la preparación borra el trabajo y vuelve a idle', async () => {
    mockApi('POST', '/api/youtube/jobs', job({ status: 'queued' }))
    mockApi('DELETE', `/api/youtube/jobs/${JOB}`, null)
    const wrapper = await mount()
    await wrapper.get('[aria-label="Preparar y reproducir"]').trigger('click')
    await flush()
    await wrapper.findAll('button').find(b => b.text() === 'Cancelar')!.trigger('click')
    await flush()
    expect(calls.some(c => c.method === 'DELETE')).toBe(true)
    expect(wrapper.find('[aria-label="Preparar y reproducir"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('la barra: silenciar, volumen y posición con sus nombres accesibles', async () => {
    useYoutubeDownloads().setPreviewJob('okShortVid1', JOB)
    mockApi('GET', `/api/youtube/jobs/${JOB}`, ready)
    const wrapper = await mount()
    await flush()
    const video = wrapper.get('video').element as HTMLVideoElement
    await wrapper.get('[aria-label="Silenciar"]').trigger('click')
    await flush()
    expect(video.muted).toBe(true)
    expect(wrapper.get('[aria-label="Activar sonido"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[aria-label="Volumen"]').setValue('0.5')
    await flush()
    expect(video.volume).toBeCloseTo(0.5)
    expect(wrapper.get('[aria-label="Posición"]').attributes('aria-valuetext')).toContain('de')
    await wrapper.get('[aria-label="Reproducir"]').trigger('click')
    expect(play).toHaveBeenCalled()
    await wrapper.get('video').trigger('click')
    // Una tecla con el foco en un botón de la barra no la intercepta el reproductor.
    wrapper.get('[aria-label="Volumen"]').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(video.volume).toBeCloseTo(0.5)
    wrapper.unmount()
  })

  it('una copia en preparación (de la ficha) sigue sondeándose; con un trabajo inicial que falla por otra razón → error', async () => {
    useYoutubeDownloads().setPreviewJob('okShortVid1', JOB)
    mockApi('GET', `/api/youtube/jobs/${JOB}`, job())
    const preparing = await mount()
    await flush()
    expect(preparing.text()).toContain('Preparando el video… 40 %')
    preparing.unmount()

    mockApi('GET', `/api/youtube/jobs/${JOB}`, failWith(500))
    const failed = await mount({ initialJobId: JOB })
    await flush()
    expect(failed.text()).toContain('No pudimos preparar el video')
    failed.unmount()
  })

  it('al renovar el enlace conserva la posición; sin trabajo no hay nada que renovar ni cancelar', async () => {
    useYoutubeDownloads().setPreviewJob('okShortVid1', JOB)
    mockApi('GET', `/api/youtube/jobs/${JOB}`, ready)
    const wrapper = await mount()
    await flush()
    const video = wrapper.get('video').element as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
    video.currentTime = 42
    video.dispatchEvent(new Event('timeupdate'))
    await flush()
    mockApi('GET', `/api/youtube/jobs/${JOB}`, { ...ready, downloadUrl: 'https://svc.test/renovado' })
    await wrapper.get('video').trigger('error')
    await flush()
    const renewed = wrapper.get('video').element as HTMLVideoElement
    renewed.currentTime = 0
    await wrapper.get('video').trigger('loadedmetadata')
    expect(renewed.currentTime).toBe(42)
    // Otro loadedmetadata ya no mueve la posición.
    renewed.currentTime = 3
    await wrapper.get('video').trigger('loadedmetadata')
    expect(renewed.currentTime).toBe(3)
    wrapper.unmount()

    const idle = await mount({ videoId: 'lowResVid01' })
    await flush()
    await (idle.vm as unknown as { fullscreen: () => Promise<void> }).fullscreen()
    expect(fullscreen.toggle).not.toHaveBeenCalled()
    idle.unmount()
  })

  it('si el <video> falla con el mismo enlace vigente, no hay nada más que renovar: error', async () => {
    useYoutubeDownloads().setPreviewJob('okShortVid1', JOB)
    mockApi('GET', `/api/youtube/jobs/${JOB}`, ready)
    const wrapper = await mount()
    await flush()
    await wrapper.get('video').trigger('error')
    await flush()
    expect(wrapper.text()).toContain('No pudimos preparar el video')
    wrapper.unmount()
  })

  it('si el <video> falla, pide un enlace nuevo; si el servicio olvidó la copia, pasa a expired', async () => {
    useYoutubeDownloads().setPreviewJob('okShortVid1', JOB)
    mockApi('GET', `/api/youtube/jobs/${JOB}`, ready)
    const wrapper = await mount()
    await flush()
    mockApi('GET', `/api/youtube/jobs/${JOB}`, { ...ready, downloadUrl: 'https://svc.test/nuevo' })
    await wrapper.get('video').trigger('error')
    await flush()
    expect(wrapper.get('video').attributes('src')).toBe('https://svc.test/nuevo')
    mockApi('GET', `/api/youtube/jobs/${JOB}`, failWith(404, { code: 'expired' }))
    await wrapper.get('video').trigger('error')
    await flush()
    expect(wrapper.text()).toContain('La copia expiró')
    wrapper.unmount()
  })
})
