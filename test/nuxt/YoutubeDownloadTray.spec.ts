// T022/T035 — Bandeja de descargas (feature 005, research D3–D4): una fila por trabajo con lote, avance, estado por
// video («Entregado en 480p»), acciones por estado, anuncios moderados y alto publicado para la barra de selección.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { YoutubeJob, YoutubeJobItem } from '#shared/types/api'
import type { DownloadRow } from '~/composables/useYoutubeDownloads'
import YoutubeDownloadTray from '~/components/youtube/YoutubeDownloadTray.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

mockNuxtImport('useIntervalFn', () => () => ({ pause: vi.fn(), resume: vi.fn(), isActive: { value: false } }))

const JOB = 'a'.repeat(32)
const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]

const item = (changes: Partial<YoutubeJobItem> = {}): YoutubeJobItem => ({
  videoId: 'okShortVid1', title: 'Alabanza', status: 'done', progress: 100, error: null, actualHeight: null, ...changes,
})
const job = (changes: Partial<YoutubeJob> = {}): YoutubeJob => ({
  jobId: JOB, status: 'running', format: 'mp3', progress: 30, items: [item({ status: 'running', progress: 30 })],
  downloadUrl: null, filename: null, sizeBytes: null, expiresAt: null, ...changes,
})
let id = 100
const row = (changes: Partial<DownloadRow> = {}): DownloadRow => ({
  id: ++id, groupId: 1, label: 'Alabanza', format: 'mp3', videoIds: ['okShortVid1'], batch: 1, total: 1, status: 'running',
  job: job(), message: null, rejected: [], saved: false, ...changes,
})

function setRows(rows: DownloadRow[]) {
  useState('youtube-downloads').value = { rows, groups: [{ id: 1, key: 'k', label: 'Alabanza', format: 'mp3', batches: [['okShortVid1']], next: 1 }] }
}

beforeEach(() => {
  resetCalls()
  useToast().toasts.value = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

describe('YoutubeDownloadTray', () => {
  it('en curso: nombre, formato, lote, avance y Cancelar; publica su alto', async () => {
    setRows([row({ batch: 2, total: 3 })])
    const wrapper = await mountSuspended(YoutubeDownloadTray, { attachTo: document.body })
    await flush()
    expect(wrapper.text()).toContain('Alabanza')
    expect(wrapper.text()).toContain('Audio MP3 · Lote 2 de 3 · Descargando')
    expect(wrapper.get('progress').attributes('value')).toBe('30')
    expect(wrapper.text()).toContain('1 en curso')
    expect(button(wrapper, 'Cancelar')).toBeDefined()
    expect(wrapper.find('[aria-label="Cerrar Alabanza"]').exists()).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--youtube-tray-h')).toMatch(/px$/)
    // Anuncio del estado para lectores de pantalla.
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Descargando')

    mockApi('DELETE', `/api/youtube/jobs/${JOB}`, null)
    await button(wrapper, 'Cancelar')!.trigger('click')
    await flush()
    expect(calls.some(c => c.method === 'DELETE')).toBe(true)
    expect(wrapper.text()).toContain('Cancelada')
    wrapper.unmount()
    expect(document.documentElement.style.getPropertyValue('--youtube-tray-h')).toBe('')
  })

  it('terminado: Guardar archivo pide un enlace nuevo; 1080p entregado en 480p lo dice', async () => {
    const done = job({ status: 'done', format: 'mp4_1080', progress: 100, downloadUrl: 'https://svc/file', filename: 'a.mp4', items: [item({ actualHeight: 480 })] })
    setRows([row({ status: 'done', format: 'mp4_1080', job: done, saved: true })])
    mockApi('GET', `/api/youtube/jobs/${JOB}`, done)
    const wrapper = await mountSuspended(YoutubeDownloadTray)
    await flush()
    expect(wrapper.text()).toContain('Entregado en 480p')
    expect(wrapper.text()).toContain('Video 1080p · Listo')
    await button(wrapper, 'Guardar archivo')!.trigger('click')
    await flush()
    expect(calls.filter(c => c.method === 'GET')).toHaveLength(1)
    // Guardar de nuevo con un trabajo que el servicio ya olvidó → expiró.
    mockApi('GET', `/api/youtube/jobs/${JOB}`, failWith(404, { code: 'expired' }))
    await button(wrapper, 'Guardar archivo')!.trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Esta descarga expiró')
    expect(button(wrapper, 'Preparar de nuevo')).toBeDefined()
  })

  it('un fallo al pedir el enlace de nuevo avisa con un error', async () => {
    const done = job({ status: 'done', downloadUrl: 'https://svc/file' })
    setRows([row({ status: 'done', job: done })])
    mockApi('GET', `/api/youtube/jobs/${JOB}`, failWith(500))
    const wrapper = await mountSuspended(YoutubeDownloadTray)
    await button(wrapper, 'Guardar archivo')!.trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)?.type).toBe('error')
  })

  it('lote con varios videos: estado por video y el motivo del que falló', async () => {
    const items = [item(), item({ videoId: 'unavailVid1', title: null, status: 'failed', progress: 0, error: { code: 'unavailable', message: 'Este video ya no está disponible en YouTube. Revisa el enlace.' } }), item({ videoId: 'x00000000001', title: 'En cola', status: 'queued', progress: 0 })]
    setRows([row({ status: 'zipping', job: job({ status: 'zipping', items }) })])
    const wrapper = await mountSuspended(YoutubeDownloadTray)
    await flush()
    expect(wrapper.text()).toContain('Empaquetando')
    expect(wrapper.text()).toContain('unavailVid1')
    expect(wrapper.text()).toContain('Este video ya no está disponible en YouTube')
    expect(wrapper.text()).toContain('Falló')
    expect(wrapper.text()).toContain('En cola')
  })

  it('una descarga de un video que falló dice la causa una sola vez (no en la fila y otra vez en el video)', async () => {
    const cause = 'YouTube bloqueó la descarga con su verificación anti-robots. Intenta de nuevo en unos minutos.'
    const items = [item({ status: 'failed', progress: 0, error: { code: 'bot_check', message: cause } })]
    setRows([row({ status: 'failed', message: cause, job: job({ status: 'failed', items }) })])
    const wrapper = await mountSuspended(YoutubeDownloadTray)
    await flush()
    expect(wrapper.text()).toContain('No se pudo descargar')
    expect(wrapper.text().split(cause)).toHaveLength(2)
    expect(button(wrapper, 'Preparar de nuevo')).toBeDefined()
  })

  it('si los videos de un lote fallaron por causas distintas, la fila lo dice en general y cada video muestra la suya', async () => {
    const general = 'Ningún video se pudo descargar. Revisa el motivo de cada uno.'
    const blocked = 'YouTube bloqueó la descarga con su verificación anti-robots. Intenta de nuevo en unos minutos.'
    const hidden = 'Este video es privado.'
    const items = [
      item({ status: 'failed', progress: 0, error: { code: 'bot_check', message: blocked } }),
      item({ videoId: 'privateVid1', title: 'Privado', status: 'failed', progress: 0, error: { code: 'private', message: hidden } }),
    ]
    setRows([row({ videoIds: ['okShortVid1', 'privateVid1'], status: 'failed', message: general, job: job({ status: 'failed', items }) })])
    const wrapper = await mountSuspended(YoutubeDownloadTray)
    await flush()
    // Cada texto aparece una sola vez: el general en la fila y cada causa junto a su video.
    for (const text of [general, blocked, hidden]) expect(wrapper.text().split(text), text).toHaveLength(2)
    // El motivo es hijo directo de la fila del video (el ícono de «falló» también es rojo, pero va dentro de su línea).
    expect(wrapper.findAll('li li > .text-error').map(el => el.text())).toEqual([blocked, hidden])
  })

  it('en pausa: el motivo y Reintentar; rechazado: cada video con su motivo y sin Preparar de nuevo', async () => {
    mockApi('POST', '/api/youtube/jobs', job({ status: 'queued' }))
    setRows([
      row({ status: 'paused', job: null, message: 'El servicio está ocupado. Intenta de nuevo en un momento.' }),
      row({ label: 'Privado', status: 'failed', job: null, message: 'Algunos videos no se pueden descargar.', rejected: [{ videoId: 'privateVid1', message: 'Este video es privado.' }] }),
    ])
    const wrapper = await mountSuspended(YoutubeDownloadTray)
    await flush()
    expect(wrapper.text()).toContain('En pausa')
    expect(wrapper.text()).toContain('privateVid1: Este video es privado.')
    expect(button(wrapper, 'Preparar de nuevo')).toBeUndefined()
    await button(wrapper, 'Reintentar')!.trigger('click')
    await flush()
    expect(calls.some(c => c.method === 'POST')).toBe(true)
    // Cerrar una fila terminada la quita.
    await wrapper.get('[aria-label="Cerrar Privado"]').trigger('click')
    await flush()
    expect(wrapper.text()).not.toContain('Privado')
  })

  it('ocultar y mostrar la lista de trabajos', async () => {
    setRows([row({ status: 'creating', job: null })])
    const wrapper = await mountSuspended(YoutubeDownloadTray)
    await flush()
    expect(wrapper.text()).toContain('Preparando…')
    expect(wrapper.get('progress').attributes('value')).toBe('0')
    await wrapper.get('[aria-label="Ocultar descargas"]').trigger('click')
    expect(wrapper.get('ul').attributes('style')).toContain('display: none')
    await wrapper.get('[aria-label="Mostrar descargas"]').trigger('click')
    expect(wrapper.get('ul').attributes('style') ?? '').not.toContain('display: none')
  })

  describe('Guardar en el drive', () => {
    const entry = (videoId: string, changes: Record<string, unknown> = {}) => ({ videoId, title: `Video ${videoId}`, format: 'mp3', stage: 'queued', progress: 0, message: null, ...changes })
    const setImports = (...entries: ReturnType<typeof entry>[]) => {
      useState('youtube-drive-imports').value = Object.fromEntries(entries.map(e => [e.videoId, e]))
    }
    afterEach(() => {
      useState('youtube-drive-imports').value = {}
    })

    it('sección con una fila por video: en cola, subiendo con su avance, y suma «en curso»', async () => {
      setRows([])
      setImports(entry('aaaaaaaaaaa', { stage: 'uploading', progress: 40 }), entry('bbbbbbbbbbb'))
      const wrapper = await mountSuspended(YoutubeDownloadTray)
      await flush()
      const section = wrapper.get('ul[aria-label="Guardar en el drive"]')
      expect(section.findAll('li')).toHaveLength(2)
      expect(section.text()).toContain('Audio MP3 · Subiendo al drive…')
      expect(section.text()).toContain('Audio MP3 · En cola')
      // Solo la que corre muestra barra de avance.
      expect(section.findAll('progress')).toHaveLength(1)
      expect(section.get('progress').attributes('value')).toBe('40')
      expect(wrapper.text()).toContain('2 en curso')
      expect(wrapper.get('[aria-live="polite"]').text()).toContain('En cola')
      expect(section.find('[aria-label^="Cerrar"]').exists()).toBe(false)
    })

    it('Cancelar sale en las importaciones en curso o en cola (no en las terminadas) y saca la pendiente', async () => {
      setRows([])
      setImports(
        entry('aaaaaaaaaaa', { stage: 'uploading', progress: 10 }),
        entry('bbbbbbbbbbb'),
        entry('ccccccccccc', { stage: 'done', progress: 100, message: 'Coro.mp3' }),
      )
      const wrapper = await mountSuspended(YoutubeDownloadTray)
      await flush()
      expect(wrapper.find('[aria-label="Cancelar Video aaaaaaaaaaa"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Cancelar Video ccccccccccc"]').exists()).toBe(false)
      await wrapper.get('[aria-label="Cancelar Video bbbbbbbbbbb"]').trigger('click')
      await flush()
      expect(useState<Record<string, unknown>>('youtube-drive-imports').value).not.toHaveProperty('bbbbbbbbbbb')
      expect(wrapper.text()).not.toContain('Video bbbbbbbbbbb')
      expect(useToast().toasts.value.at(-1)).toMatchObject({ message: 'Guardado cancelado' })
    })

    it('terminada: enlace «Ver en el drive» y cerrar; fallida: motivo, Reintentar y cerrar', async () => {
      setRows([])
      setImports(
        entry('aaaaaaaaaaa', { stage: 'done', progress: 100, message: 'Alabanza.mp3' }),
        entry('bbbbbbbbbbb', { stage: 'error', message: 'No pudimos preparar el archivo. Inténtalo de nuevo.' }),
      )
      mockApi('POST', '/api/youtube/jobs', () => new Promise(() => {}))
      const wrapper = await mountSuspended(YoutubeDownloadTray)
      await flush()
      expect(wrapper.text()).toContain('«Alabanza.mp3» ya está en el drive')
      expect(wrapper.get('a[href="/archivos"]').text()).toContain('Ver en el drive')
      expect(wrapper.text()).toContain('No pudimos preparar el archivo')
      expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos preparar el archivo')
      expect(wrapper.get('[aria-live="polite"]').text()).toContain('No se pudo guardar')

      await button(wrapper, 'Reintentar')!.trigger('click')
      await flush()
      expect(calls.some(c => c.method === 'POST' && c.url === '/api/youtube/jobs')).toBe(true)
      expect(useState<Record<string, { stage: string }>>('youtube-drive-imports').value.bbbbbbbbbbb!.stage).toBe('preparing')

      await wrapper.get('[aria-label="Cerrar Video aaaaaaaaaaa"]').trigger('click')
      await flush()
      expect(wrapper.text()).not.toContain('Alabanza.mp3')
    })
  })

  it('anuncia el avance cada 25 % y no en cada sondeo', async () => {
    const current = row({ job: job({ progress: 10 }) })
    setRows([current])
    const wrapper = await mountSuspended(YoutubeDownloadTray)
    await flush()
    const live = () => wrapper.get('[aria-live="polite"]').text()
    const state = useState<{ rows: DownloadRow[] }>('youtube-downloads')
    state.value.rows[0]!.job!.progress = 20
    await flush()
    expect(live()).not.toContain('20 %')
    state.value.rows[0]!.job!.progress = 55
    await flush()
    expect(live()).toContain('55 %')
    state.value.rows[0]!.status = 'done'
    await flush()
    expect(live()).toContain('Listo')
  })
})
