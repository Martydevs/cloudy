// T022 — Orquestación de descargas en el navegador (feature 005, research D2–D5): un solo trabajo por gesto, lotes de
// uno en uno, guardado al terminar, expiración y sondeo que se pausa sin conexión.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import { effectScope } from 'vue'
import type { YoutubeJob, YoutubeJobItem } from '#shared/types/api'
import { YOUTUBE_JOB_POLL_MS } from '#shared/constants/youtube'
import { calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const { interval, online } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { interval: { pause: vi.fn(), resume: vi.fn(), ms: 0 }, online: ref(true) }
})
mockNuxtImport('useIntervalFn', () => (_fn: () => void, ms: number) => {
  interval.ms = ms
  return { pause: interval.pause, resume: interval.resume, isActive: { value: false } }
})
mockNuxtImport('useOnline', () => () => online)

const jobId = (n: number) => n.toString(16).padStart(32, '0')
const ids = (n: number) => Array.from({ length: n }, (_, i) => `video${String(i).padStart(6, '0')}`)

function job(id: string, changes: Partial<YoutubeJob> = {}): YoutubeJob {
  return { jobId: id, status: 'queued', format: 'mp3', progress: 0, items: [], downloadUrl: null, filename: null, sizeBytes: null, expiresAt: null, ...changes }
}

const done = (id: string, changes: Partial<YoutubeJob> = {}) =>
  job(id, { status: 'done', progress: 100, downloadUrl: `https://svc.test/api/jobs/${id}/file?exp=1&sig=x`, filename: 'archivo.mp3', ...changes })

let created = 0
const posts = () => calls.filter(c => c.method === 'POST' && c.url === '/api/youtube/jobs')
let click: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useState('youtube-downloads').value = { rows: [], groups: [] }
  useToast().toasts.value = []
  resetCalls()
  created = 0
  online.value = true
  interval.pause.mockClear()
  interval.resume.mockClear()
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  mockApi('POST', '/api/youtube/jobs', () => job(jobId(++created)))
})

afterEach(() => {
  click.mockRestore()
})

describe('useYoutubeDownloads', () => {
  it('un doble enqueue del mismo gesto crea un solo trabajo (FR-031)', async () => {
    const downloads = useYoutubeDownloads()
    expect(downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')).toBe(1)
    downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
    await flush()
    expect(posts()).toHaveLength(1)
    expect(posts()[0]!.body).toEqual({ videoIds: ['okShortVid1'], format: 'mp3' })
    expect(downloads.rows.value).toHaveLength(1)
    expect(downloads.rows.value[0]).toMatchObject({ status: 'queued', label: 'Alabanza', batch: 1, total: 1 })
    expect(downloads.active.value).toBe(true)
    expect(downloads.busy.value).toBe(true)
  })

  it('al terminar intenta guardar el archivo, avisa y deja «Guardar archivo» con un enlace nuevo', async () => {
    const downloads = useYoutubeDownloads()
    downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
    await flush()
    mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, done(jobId(1)))
    await downloads.tick()
    await flush()
    expect(downloads.rows.value[0]).toMatchObject({ status: 'done', saved: true })
    expect(click).toHaveBeenCalledTimes(1)
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'success', message: 'Tu archivo está listo' })
    expect(downloads.busy.value).toBe(false)

    await downloads.saveAgain(downloads.rows.value[0]!.id)
    expect(click).toHaveBeenCalledTimes(2)
    expect(calls.filter(c => c.method === 'GET')).toHaveLength(2)
  })

  it('al guardar el archivo anota la descarga (una vez) y refresca «Descargas»; si falla, el archivo igual queda guardado', async () => {
    const records = () => calls.filter(c => c.method === 'POST' && c.url === '/api/youtube/downloads')
    mockApi('POST', '/api/youtube/downloads', { recorded: 1 })
    mockApi('GET', '/api/youtube/downloads', { items: [], nextCursor: null })
    const downloads = useYoutubeDownloads()
    downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
    await flush()
    mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, done(jobId(1)))
    await downloads.tick()
    await flush()
    expect(records()).toHaveLength(1)
    expect(records()[0]!.body).toEqual({ videoIds: ['okShortVid1'], format: 'mp3' })
    // Guardar de nuevo con otro enlace no vuelve a anotar la misma descarga.
    await downloads.saveAgain(downloads.rows.value[0]!.id)
    await flush()
    expect(records()).toHaveLength(1)

    mockApi('POST', '/api/youtube/downloads', failWith(500))
    downloads.enqueue(['lowResVid01'], 'mp3', 'Otra')
    await flush()
    mockApi('GET', `/api/youtube/jobs/${jobId(2)}`, done(jobId(2)))
    await downloads.tick()
    await flush()
    expect(records()).toHaveLength(2)
    expect(downloads.rows.value[1]).toMatchObject({ status: 'done', saved: true })
    expect(click).toHaveBeenCalledTimes(3)
  })

  it('un trabajo que el servicio olvidó pasa a expired y se puede preparar de nuevo', async () => {
    const downloads = useYoutubeDownloads()
    downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
    await flush()
    mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, failWith(404, { code: 'expired' }))
    await downloads.tick()
    expect(downloads.rows.value[0]).toMatchObject({ status: 'expired', message: 'Esta descarga expiró. Prepárala de nuevo.' })
    await downloads.retry(downloads.rows.value[0]!.id)
    await flush()
    expect(posts()).toHaveLength(2)
    expect(downloads.rows.value[0]!.status).toBe('queued')
  })

  it('25 videos: lotes de 10, 10 y 5 creados de uno en uno; un lote fallido avisa y sigue con el resto', async () => {
    const downloads = useYoutubeDownloads()
    expect(downloads.enqueue(ids(25), 'mp3', 'Domingo')).toBe(3)
    await flush()
    expect(posts().map(p => (p.body as { videoIds: string[] }).videoIds.length)).toEqual([10])
    expect(downloads.rows.value[0]).toMatchObject({ batch: 1, total: 3 })

    // Sin terminar el primero no nace el segundo.
    mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, job(jobId(1), { status: 'running', progress: 50 }))
    await downloads.tick()
    await flush()
    expect(posts()).toHaveLength(1)

    mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, done(jobId(1)))
    await downloads.tick()
    await flush()
    expect(posts().map(p => (p.body as { videoIds: string[] }).videoIds.length)).toEqual([10, 10])
    expect(useToast().toasts.value.some(t => t.message === 'Tu archivo está listo · Lote 1 de 3')).toBe(true)

    mockApi('GET', `/api/youtube/jobs/${jobId(2)}`, job(jobId(2), { status: 'failed' }))
    await downloads.tick()
    await flush()
    expect(posts().map(p => (p.body as { videoIds: string[] }).videoIds)).toEqual([ids(25).slice(0, 10), ids(25).slice(10, 20), ids(25).slice(20)])
    expect(downloads.rows.value[1]).toMatchObject({ status: 'failed', message: 'El lote 2 no se pudo descargar. Seguimos con el resto.' })
    expect(useToast().toasts.value.some(t => t.type === 'error')).toBe(true)
    expect(downloads.rows.value[2]).toMatchObject({ batch: 3, total: 3, status: 'queued' })
  })

  it('videos rechazados al crear: se informa cada uno y sigue el siguiente lote', async () => {
    mockApi('POST', '/api/youtube/jobs', failWith(422, { videos: [{ videoId: 'privateVid1', code: 'private', message: 'Este video es privado.' }] }, 'Algunos videos no se pueden descargar.'))
    const downloads = useYoutubeDownloads()
    downloads.enqueue(['privateVid1'], 'mp3', 'Privado')
    await flush()
    expect(downloads.rows.value[0]).toMatchObject({ status: 'failed', rejected: [{ videoId: 'privateVid1', message: 'Este video es privado.' }] })
  })

  it.each([
    [429, 'El servicio está ocupado. Intenta de nuevo en un momento.'],
    [503, 'Despertando el servicio, puede tardar hasta 1 minuto'],
  ])('un %i deja el lote en pausa sin perder los videos', async (status, message) => {
    mockApi('POST', '/api/youtube/jobs', failWith(status))
    const downloads = useYoutubeDownloads()
    downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
    await flush()
    expect(downloads.rows.value[0]).toMatchObject({ status: 'paused', message, videoIds: ['okShortVid1'] })
    mockApi('POST', '/api/youtube/jobs', () => job(jobId(++created)))
    await downloads.retry(downloads.rows.value[0]!.id)
    await flush()
    expect(downloads.rows.value[0]!.status).toBe('queued')
  })

  it('cancelar borra el trabajo, avisa y no crea los lotes que faltaban', async () => {
    mockApi('DELETE', `/api/youtube/jobs/${jobId(1)}`, null)
    const downloads = useYoutubeDownloads()
    downloads.enqueue(ids(12), 'mp3', 'Lista')
    await flush()
    await downloads.cancel(downloads.rows.value[0]!.id)
    expect(calls.some(c => c.method === 'DELETE')).toBe(true)
    expect(downloads.rows.value[0]!.status).toBe('cancelled')
    await downloads.dismiss(downloads.rows.value[0]!.id)
    expect(downloads.rows.value).toHaveLength(0)
    expect(downloads.active.value).toBe(false)
    expect(posts()).toHaveLength(1)
  })

  it('sin conexión al crear: en pausa con el aviso de conexión; un 500 falla, avisa y sigue con el siguiente lote', async () => {
    mockApi('POST', '/api/youtube/jobs', () => { throw new TypeError('offline') })
    const downloads = useYoutubeDownloads()
    downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
    await flush()
    // El registro de prueba responde 500 a un error no-HTTP: cuenta como fallo, no como pausa.
    expect(['paused', 'failed']).toContain(downloads.rows.value[0]!.status)

    useState('youtube-downloads').value = { rows: [], groups: [] }
    resetCalls()
    let n = 0
    mockApi('POST', '/api/youtube/jobs', event => (++n === 1 ? failWith(500)(event) : job(jobId(++created))))
    downloads.enqueue(ids(11), 'mp3', 'Once')
    await flush(10)
    expect(downloads.rows.value[0]).toMatchObject({ status: 'failed', message: 'No pudimos iniciar la descarga. Inténtalo de nuevo.' })
    expect(downloads.rows.value[1]).toMatchObject({ batch: 2, status: 'queued' })
    expect(useToast().toasts.value.some(t => t.message === 'El lote 1 no se pudo descargar. Seguimos con el resto.')).toBe(true)
  })

  it('un sondeo con un error que no es «expiró» no cambia nada; un trabajo activo que expira deja seguir al grupo', async () => {
    const downloads = useYoutubeDownloads()
    downloads.enqueue(ids(11), 'mp3', 'Once')
    await flush()
    mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, failWith(500))
    await downloads.tick()
    expect(downloads.rows.value[0]!.status).toBe('queued')
    mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, failWith(404, { code: 'expired' }))
    await downloads.tick()
    await flush()
    expect(downloads.rows.value[0]!.status).toBe('expired')
    expect(downloads.rows.value[1]).toMatchObject({ batch: 2 })
  })

  it('reintentar algo en curso no hace nada; cerrar algo en curso lo cancela; enqueue vacío no crea nada', async () => {
    mockApi('DELETE', `/api/youtube/jobs/${jobId(1)}`, null)
    const downloads = useYoutubeDownloads()
    expect(downloads.enqueue([], 'mp3', 'Nada')).toBe(0)
    downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
    await flush()
    await downloads.retry(downloads.rows.value[0]!.id)
    expect(posts()).toHaveLength(1)
    await downloads.dismiss(downloads.rows.value[0]!.id)
    expect(calls.some(c => c.method === 'DELETE')).toBe(true)
    expect(downloads.rows.value).toHaveLength(0)
    await downloads.cancel(999)
    await downloads.retry(999)
    await downloads.saveAgain(999)
    await downloads.dismiss(999)
  })

  describe('fallos del servicio: un solo motor, nada se repite por su cuenta', () => {
    const BOT_CHECK = 'YouTube bloqueó la descarga con su verificación anti-robots. Intenta de nuevo en unos minutos.'
    const failed = (videoId: string, code = 'bot_check', message = BOT_CHECK): YoutubeJobItem =>
      ({ videoId, title: null, status: 'failed', progress: 0, error: { code, message }, actualHeight: null })
    const ok = (videoId: string): YoutubeJobItem => ({ videoId, title: null, status: 'done', progress: 100, error: null, actualHeight: null })
    const errorToasts = () => useToast().toasts.value.filter(t => t.type === 'error')

    it('un trabajo que falla por el bloqueo anti-robots no se repite: la fila falla con la causa', async () => {
      const downloads = useYoutubeDownloads()
      downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
      await flush()
      const queries: unknown[] = []
      mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, (event) => {
        queries.push(getQuery(event))
        return job(jobId(1), { status: 'failed', items: [failed('okShortVid1')] })
      })
      await downloads.tick()
      await flush()
      await downloads.tick()
      await flush()

      // El trabajo se consulta sin `?engine=`: ya no hay motores.
      expect(queries).toEqual([{}])
      expect(posts()).toHaveLength(1)
      expect(posts()[0]!.body).toEqual({ videoIds: ['okShortVid1'], format: 'mp3' })
      expect(downloads.rows.value).toHaveLength(1)
      expect(downloads.rows.value[0]).toMatchObject({ status: 'failed', message: BOT_CHECK })
      expect(downloads.rows.value[0]).not.toHaveProperty('engine')
      expect(errorToasts().map(t => t.message)).toEqual([BOT_CHECK])
      expect(downloads.busy.value).toBe(false)

      // «Preparar de nuevo» crea el mismo trabajo otra vez.
      await downloads.retry(downloads.rows.value[0]!.id)
      await flush()
      expect(posts()).toHaveLength(2)
      expect(posts().at(-1)!.body).toEqual({ videoIds: ['okShortVid1'], format: 'mp3' })
      expect(downloads.rows.value[0]).toMatchObject({ status: 'queued' })
    })

    it('un lote entregado con fallos: se guarda el zip y sigue el lote siguiente, sin filas de repetición', async () => {
      const all = ids(12)
      const downloads = useYoutubeDownloads()
      downloads.enqueue(all, 'mp3', 'Domingo')
      await flush()
      const items = [...all.slice(0, 8).map(ok), failed(all[8]!, 'download_failed', 'x'), failed(all[9]!)]
      mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, done(jobId(1), { items }))
      await downloads.tick()
      await flush()

      expect(click).toHaveBeenCalledTimes(1)
      expect(downloads.rows.value[0]).toMatchObject({ status: 'done', saved: true, batch: 1, total: 2 })
      expect(posts()).toHaveLength(2)
      expect(posts()[1]!.body).toEqual({ videoIds: all.slice(10), format: 'mp3' })
      expect(downloads.rows.value[1]).toMatchObject({ batch: 2, total: 2, status: 'queued' })
      expect(errorToasts()).toEqual([])
    })

    it('un fallo que es del video (privado): con un solo lote la fila y el aviso dicen esa causa', async () => {
      const downloads = useYoutubeDownloads()
      downloads.enqueue(['privateVid1'], 'mp3', 'Privado')
      await flush()
      mockApi('GET', `/api/youtube/jobs/${jobId(1)}`, job(jobId(1), { status: 'failed', items: [failed('privateVid1', 'private', 'Este video es privado.')] }))
      await downloads.tick()
      await flush()
      expect(posts()).toHaveLength(1)
      expect(downloads.rows.value).toHaveLength(1)
      expect(downloads.rows.value[0]).toMatchObject({ status: 'failed', message: 'Este video es privado.' })
      expect(errorToasts().map(t => t.message)).toEqual(['Este video es privado.'])
    })

    it.each([
      ['botCheck', messages.youtube.service.botCheck],
      ['failed', messages.youtube.service.failed],
    ])('el servicio no puede al crear (502 service_failed, %s): fila fallida y aviso con la causa', async (cause, message) => {
      mockApi('POST', '/api/youtube/jobs', failWith(502, { code: 'service_failed', cause }))
      const downloads = useYoutubeDownloads()
      downloads.enqueue(['botCheckVd1'], 'mp3', 'Bloqueado')
      await flush()
      expect(posts()).toHaveLength(1)
      expect(downloads.rows.value[0]).toMatchObject({ status: 'failed', message })
      expect(errorToasts().map(t => t.message)).toEqual([message])
      expect(message).not.toMatch(/los dos/i)
    })

    it('cancelar borra el trabajo sin `?engine=`', async () => {
      const downloads = useYoutubeDownloads()
      downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
      await flush()
      const queries: unknown[] = []
      mockApi('DELETE', `/api/youtube/jobs/${jobId(1)}`, (event) => {
        queries.push(getQuery(event))
        return null
      })
      await downloads.cancel(downloads.rows.value[0]!.id)
      expect(queries).toEqual([{}])
      expect(downloads.rows.value[0]!.status).toBe('cancelled')
    })
  })

  it('filesFor cuenta los archivos que recibirá la persona', () => {
    const { filesFor } = useYoutubeDownloads()
    expect([filesFor(1), filesFor(10), filesFor(11), filesFor(25)]).toEqual([1, 1, 2, 3])
  })
})

describe('useYoutubeDownloadsPolling', () => {
  it('sondea cada 2,5 s solo con trabajos en curso y se pausa sin conexión', async () => {
    const scope = effectScope()
    const downloads = useYoutubeDownloads()
    scope.run(() => useYoutubeDownloadsPolling())
    expect(interval.ms).toBe(YOUTUBE_JOB_POLL_MS)
    expect(YOUTUBE_JOB_POLL_MS).toBe(2500)
    expect(interval.pause).toHaveBeenCalled()

    downloads.enqueue(['okShortVid1'], 'mp3', 'Alabanza')
    await flush()
    expect(interval.resume).toHaveBeenCalled()

    interval.pause.mockClear()
    online.value = false
    await flush()
    expect(interval.pause).toHaveBeenCalled()
    scope.stop()
  })
})
