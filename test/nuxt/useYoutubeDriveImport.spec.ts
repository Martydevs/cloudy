// Guardar un video en el drive (feature 005): trabajo en el servicio → el navegador baja el archivo → sube al bucket con
// el flujo de subidas y registra el origen YouTube. Cubre éxito (MP3 y 720p), sondeo, errores del servicio, tope de
// tamaño, fallos de descarga y de subida (sin reservas a medias), el doble clic, la cancelación (en cola y en cada etapa)
// y que una descarga o subida sin avance se aborte en vez de bloquear la cola.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { YoutubeJob } from '#shared/types/api'
import { calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

// Topes y sondeo chicos para no mover cientos de MB ni esperar 2,5 s por vuelta.
vi.mock('#shared/constants/files', async importOriginal => ({ ...await importOriginal<object>(), MAX_FILE_SIZE: 10 }))
vi.mock('#shared/constants/youtube', async importOriginal => ({ ...await importOriginal<object>(), YOUTUBE_JOB_POLL_MS: 1, YOUTUBE_IMPORT_STALL_MS: 250 }))

const { put } = vi.hoisted(() => ({ put: vi.fn() }))
mockNuxtImport('putWithProgress', () => put)

const JOB = 'a'.repeat(32)
const URL_FILE = `https://svc.test/v1/jobs/${JOB}/file?exp=1&sig=x`
const VIDEO = { videoId: 'okShortVid1', title: 'Alabanza' }

const job = (changes: Partial<YoutubeJob> = {}): YoutubeJob => ({
  jobId: JOB, status: 'queued', format: 'mp3', progress: 0, items: [], downloadUrl: null, filename: null, sizeBytes: null, expiresAt: null, ...changes,
})
const ready = (changes: Partial<YoutubeJob> = {}) => job({ status: 'done', progress: 100, downloadUrl: URL_FILE, filename: 'a.mp3', sizeBytes: 6, ...changes })

/** Respuesta de `fetch` con el cuerpo en `chunks` (o sin lector, o cortándose a la mitad). */
function fileResponse({ chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])], length = '6' as string | null, ok = true, reader = true, breaks = false } = {}) {
  const queue = [...chunks]
  return {
    ok,
    headers: { get: (name: string) => (name === 'content-length' ? length : null) },
    blob: async () => new Blob(chunks),
    body: reader
      ? {
          getReader: () => ({
            read: async () => {
              if (breaks && queue.length < chunks.length) throw new Error('reset')
              const value = queue.shift()
              return value ? { done: false, value } : { done: true, value: undefined }
            },
            cancel: vi.fn(async () => {}),
          }),
        }
      : null,
  }
}

const realFetch = globalThis.fetch
let download: ReturnType<typeof vi.fn>
function stubDownload(response: unknown) {
  download = vi.fn(async () => response)
  // Solo el enlace del servicio se simula; el resto (los endpoints de prueba) sigue por el `fetch` real.
  vi.stubGlobal('fetch', (input: unknown, init?: unknown) => (String(input).startsWith('https://svc.test')
    ? (download as (...args: unknown[]) => unknown)(input)
    : realFetch(input as RequestInfo, init as RequestInit)))
}

const posts = (url: string) => calls.filter(c => c.method === 'POST' && c.url === url)
const uploaded = { id: 'f1', name: 'Alabanza.mp3' }

function happyPath() {
  mockApi('POST', '/api/youtube/jobs', ready())
  mockApi('DELETE', `/api/youtube/jobs/${JOB}`, null)
  mockApi('POST', '/api/uploads', { fileId: 'f1', uploadUrl: 'https://s3.test/put', headers: { 'content-type': 'audio/mpeg' } })
  mockApi('DELETE', '/api/uploads/f1', null)
  mockApi('POST', '/api/uploads/f1/complete', uploaded)
  stubDownload(fileResponse())
}

async function run(format: 'mp3' | 'mp4_720' = 'mp3', video = VIDEO) {
  const driveImport = useYoutubeDriveImport()
  await driveImport.start(video, format)
  await flush()
  return driveImport
}

beforeEach(() => {
  resetCalls()
  useState('youtube-drive-imports').value = {}
  useToast().toasts.value = []
  put.mockReset()
  put.mockImplementation(async (_url: string, _body: Blob, _headers: unknown, onProgress: (ratio: number) => void) => onProgress(0.5))
  happyPath()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useYoutubeDriveImport', () => {
  it('MP3: crea el trabajo, baja el archivo, lo sube a la raíz y registra el origen YouTube', async () => {
    const { of } = await run('mp3')
    expect(posts('/api/youtube/jobs')[0]!.body).toEqual({ videoIds: ['okShortVid1'], format: 'mp3' })
    expect(download).toHaveBeenCalledWith(URL_FILE)
    expect(posts('/api/uploads')[0]!.body).toEqual({ folderId: null, name: 'Alabanza.mp3', size: 6, mimeType: 'audio/mpeg' })
    const [url, body, headers] = put.mock.calls[0]!
    expect([url, headers]).toEqual(['https://s3.test/put', { 'content-type': 'audio/mpeg' }])
    expect((body as File).size).toBe(6)
    expect(posts('/api/uploads/f1/complete')[0]!.body).toEqual({ source: { videoId: 'okShortVid1', format: 'mp3' } })
    // El archivo del servicio ya no hace falta.
    expect(calls.some(c => c.method === 'DELETE' && c.url === `/api/youtube/jobs/${JOB}`)).toBe(true)
    expect(of('okShortVid1')).toMatchObject({ stage: 'done', progress: 100, message: 'Alabanza.mp3' })
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'success', message: '«Alabanza.mp3» ya está en el drive', action: { to: '/archivos' } })
  })

  it('Video 720p: sube un .mp4 con un nombre sin caracteres prohibidos', async () => {
    mockApi('POST', '/api/uploads/f1/complete', { id: 'f1', name: 'Coro - en vivo.mp4' })
    await run('mp4_720', { videoId: 'okShortVid1', title: 'Coro / en vivo' })
    expect(posts('/api/youtube/jobs')[0]!.body).toMatchObject({ format: 'mp4_720' })
    expect(posts('/api/uploads')[0]!.body).toMatchObject({ name: 'Coro - en vivo.mp4', mimeType: 'video/mp4' })
  })

  it('sondea el trabajo hasta que termina, aun si un sondeo falla de paso', async () => {
    let polls = 0
    mockApi('POST', '/api/youtube/jobs', job())
    mockApi('GET', `/api/youtube/jobs/${JOB}`, () => {
      polls++
      if (polls === 1) return job({ status: 'running', progress: 40 })
      if (polls === 2) throw Object.assign(new Error('bad gateway'), { statusCode: 502 })
      return ready()
    })
    const { of } = await run()
    expect(polls).toBe(3)
    expect(of('okShortVid1')?.stage).toBe('done')
  })

  it.each([
    ['el servicio dormido (503)', failWith(503), 'Despertando el servicio, puede tardar hasta 1 minuto'],
    ['el servicio ocupado (429)', failWith(429), 'El servicio está ocupado. Intenta de nuevo en un momento.'],
    ['otro error al crear el trabajo', failWith(500), 'No pudimos preparar el archivo.'],
  ])('%s al crear el trabajo: avisa y no sube nada', async (_name, impl, message) => {
    mockApi('POST', '/api/youtube/jobs', impl)
    const { of } = await run()
    expect(of('okShortVid1')).toMatchObject({ stage: 'error' })
    expect(of('okShortVid1')!.message).toContain(message)
    expect(useToast().toasts.value.at(-1)!.type).toBe('error')
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('un trabajo fallido, uno que el servicio olvidó o uno que tarda demasiado terminan con su aviso', async () => {
    mockApi('POST', '/api/youtube/jobs', job({ status: 'failed' }))
    expect((await run()).of('okShortVid1')!.message).toContain('No pudimos preparar el archivo.')

    mockApi('POST', '/api/youtube/jobs', job())
    mockApi('GET', `/api/youtube/jobs/${JOB}`, failWith(404, { code: 'expired' }))
    expect((await run()).of('okShortVid1')!.message).toContain('No pudimos preparar el archivo.')

    let skew = 0
    vi.spyOn(Date, 'now').mockImplementation(() => performance.timeOrigin + performance.now() + skew)
    mockApi('GET', `/api/youtube/jobs/${JOB}`, () => {
      skew = 11 * 60_000
      return job({ status: 'running' })
    })
    expect((await run()).of('okShortVid1')!.message).toContain('tardó demasiado')
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('un archivo de más del tope se rechaza antes de bajarlo (por el trabajo) o al conocer su tamaño real', async () => {
    mockApi('POST', '/api/youtube/jobs', ready({ sizeBytes: 11 }))
    const first = await run()
    expect(first.of('okShortVid1')!.message).toBe('El archivo pesa 11 B y el drive admite hasta 100 MB. Prueba con Audio MP3.')
    expect(download).not.toHaveBeenCalled()

    mockApi('POST', '/api/youtube/jobs', ready({ sizeBytes: null }))
    stubDownload(fileResponse({ length: '12' }))
    expect((await run()).of('okShortVid1')!.message).toContain('12 B')
    expect(posts('/api/uploads')).toHaveLength(0)

    // Sin tamaño anunciado: se corta al pasar el tope mientras llega.
    stubDownload(fileResponse({ length: null, chunks: [new Uint8Array(6), new Uint8Array(6)] }))
    expect((await run()).of('okShortVid1')!.message).toContain('12 B')
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('fallos al bajar el archivo (red, respuesta con error, corte a la mitad, sin enlace) avisan sin subir nada', async () => {
    stubDownload(null)
    expect((await run()).of('okShortVid1')!.message).toContain('No pudimos bajar el archivo del servicio.')

    stubDownload(fileResponse({ ok: false }))
    expect((await run()).of('okShortVid1')!.message).toContain('No pudimos bajar el archivo del servicio.')

    stubDownload(fileResponse({ breaks: true }))
    expect((await run()).of('okShortVid1')!.message).toContain('No pudimos bajar el archivo del servicio.')

    mockApi('POST', '/api/youtube/jobs', ready({ downloadUrl: null }))
    expect((await run()).of('okShortVid1')!.message).toContain('No pudimos preparar el archivo.')
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('si el navegador no expone el flujo, usa el archivo completo', async () => {
    stubDownload(fileResponse({ reader: false }))
    const { of } = await run()
    expect(of('okShortVid1')?.stage).toBe('done')
    expect((put.mock.calls[0]![1] as File).size).toBe(6)
  })

  it('si la subida falla libera la reserva del drive (sin registros a medias) y avisa', async () => {
    put.mockRejectedValue(new Error('network'))
    const { of } = await run()
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/uploads/f1')).toBe(true)
    expect(posts('/api/uploads/f1/complete')).toHaveLength(0)
    expect(of('okShortVid1')).toMatchObject({ stage: 'error' })
    expect(of('okShortVid1')!.message).toContain('No pudimos guardar el video en el drive.')
  })

  it('si la sesión cambió (403) lo dice; si el servidor rechaza la publicación, también libera la reserva', async () => {
    mockApi('POST', '/api/uploads', failWith(403))
    expect((await run()).of('okShortVid1')!.message).toBe(messages.common.sessionChanged)

    mockApi('POST', '/api/uploads', { fileId: 'f1', uploadUrl: 'https://s3.test/put', headers: {} })
    mockApi('POST', '/api/uploads/f1/complete', failWith(422))
    await run()
    expect(calls.filter(c => c.method === 'DELETE' && c.url === '/api/uploads/f1')).toHaveLength(1)
  })

  it('un segundo clic mientras corre no crea otro trabajo; tras un error se puede volver a intentar', async () => {
    mockApi('POST', '/api/youtube/jobs', () => new Promise(() => {}))
    const driveImport = useYoutubeDriveImport()
    void driveImport.start(VIDEO, 'mp3')
    await flush()
    expect(driveImport.of('okShortVid1')?.stage).toBe('preparing')
    expect(driveImport.isActive('preparing')).toBe(true)
    await driveImport.start(VIDEO, 'mp3')
    expect(posts('/api/youtube/jobs')).toHaveLength(1)

    useState('youtube-drive-imports').value = {}
    mockApi('POST', '/api/youtube/jobs', failWith(500))
    await run()
    mockApi('POST', '/api/youtube/jobs', ready())
    expect((await run()).of('okShortVid1')?.stage).toBe('done')
  })

  it('startMany deja todos «en cola» y los sube de uno en uno, en orden; un fallo no detiene al resto', async () => {
    const second = { videoId: 'okShortVid2', title: 'Coro' }
    const third = { videoId: 'okShortVid3', title: 'Himno' }
    let creating = 0
    let maxCreating = 0
    let jobs = 0
    mockApi('POST', '/api/youtube/jobs', async () => {
      jobs++
      creating++
      maxCreating = Math.max(maxCreating, creating)
      await new Promise(resolve => setTimeout(resolve, 5))
      creating--
      if (jobs === 2) throw Object.assign(new Error('boom'), { statusCode: 500 })
      return ready()
    })
    const driveImport = useYoutubeDriveImport()
    expect(driveImport.startMany([VIDEO, second, third], 'mp3')).toBe(3)
    // El primero arranca; los demás esperan su turno.
    expect(driveImport.list.value.map(i => i.stage)).toEqual(['preparing', 'queued', 'queued'])
    await vi.waitFor(() => expect(driveImport.list.value.every(i => !driveImport.isActive(i.stage))).toBe(true), { timeout: 5000 })
    expect(maxCreating).toBe(1)
    expect(driveImport.list.value.map(i => i.stage)).toEqual(['done', 'error', 'done'])
    expect(posts('/api/youtube/jobs').map(c => (c.body as { videoIds: string[] }).videoIds[0])).toEqual(['okShortVid1', 'okShortVid2', 'okShortVid3'])
  })

  it('startMany salta los videos que ya se están guardando y no encola dos veces', async () => {
    mockApi('POST', '/api/youtube/jobs', () => new Promise(() => {}))
    const driveImport = useYoutubeDriveImport()
    void driveImport.start(VIDEO, 'mp3')
    await flush()
    expect(driveImport.startMany([VIDEO, { videoId: 'okShortVid2', title: 'Coro' }], 'mp3')).toBe(1)
    expect(driveImport.list.value.map(i => i.videoId)).toEqual(['okShortVid1', 'okShortVid2'])
    expect(driveImport.hasImports.value).toBe(true)
  })

  it('dismiss quita una importación terminada o fallida, pero no una en curso; retry repite la fallida con su formato', async () => {
    mockApi('POST', '/api/youtube/jobs', failWith(500))
    const driveImport = await run('mp4_720')
    expect(driveImport.of('okShortVid1')?.stage).toBe('error')

    mockApi('POST', '/api/youtube/jobs', ready())
    await driveImport.retry('okShortVid1')
    expect(posts('/api/youtube/jobs').at(-1)!.body).toMatchObject({ format: 'mp4_720' })
    expect(driveImport.of('okShortVid1')?.stage).toBe('done')
    // Reintentar algo que no falló no hace nada.
    await driveImport.retry('okShortVid1')
    expect(posts('/api/youtube/jobs')).toHaveLength(2)

    driveImport.dismiss('okShortVid1')
    expect(driveImport.of('okShortVid1')).toBeNull()
    expect(driveImport.hasImports.value).toBe(false)

    mockApi('POST', '/api/youtube/jobs', () => new Promise(() => {}))
    void driveImport.start(VIDEO, 'mp3')
    await flush()
    driveImport.dismiss('okShortVid1')
    expect(driveImport.of('okShortVid1')).not.toBeNull()
  })

  it('of devuelve null si el video no tiene importación', () => {
    expect(useYoutubeDriveImport().of('nadaNadaNad')).toBeNull()
  })
})

describe('useYoutubeDriveImport · cancelar y no quedarse colgado', () => {
  const SECOND = { videoId: 'okShortVid2', title: 'Coro' }
  const toasts = () => useToast().toasts.value
  const jobReleased = () => calls.some(c => c.method === 'DELETE' && c.url === `/api/youtube/jobs/${JOB}`)
  const ticketReleased = () => calls.some(c => c.method === 'DELETE' && c.url === '/api/uploads/f1')

  /** Una descarga que entrega un trozo y después deja de responder. */
  function stallingDownload() {
    const cancel = vi.fn(async () => {})
    let first = true
    stubDownload({
      ok: true,
      headers: { get: () => '6' },
      blob: async () => new Blob([]),
      body: {
        getReader: () => ({
          cancel,
          read: () => {
            if (!first) return new Promise(() => {})
            first = false
            return Promise.resolve({ done: false, value: new Uint8Array([1, 2, 3]) })
          },
        }),
      },
    })
    return cancel
  }

  /** Una subida que no avanza ni termina; devuelve el `abort` del XHR que registra. */
  function stallingUpload() {
    const abort = vi.fn()
    put.mockImplementation((_url: string, _body: Blob, _headers: unknown, _progress: unknown, register: (xhr: { abort: () => void }) => void) => {
      register({ abort })
      return new Promise(() => {})
    })
    return abort
  }

  it('cancelar una importación en cola la saca sin tocar la que corre, y su `start` termina', async () => {
    mockApi('POST', '/api/youtube/jobs', () => new Promise(() => {}))
    const driveImport = useYoutubeDriveImport()
    void driveImport.start(VIDEO, 'mp3')
    const waiting = driveImport.start(SECOND, 'mp3')
    await flush()
    expect(driveImport.of('okShortVid2')?.stage).toBe('queued')
    driveImport.cancel('okShortVid2')
    await waiting
    expect(driveImport.of('okShortVid2')).toBeNull()
    expect(driveImport.of('okShortVid1')?.stage).toBe('preparing')
    expect(toasts().at(-1)).toMatchObject({ type: 'info', message: 'Guardado cancelado' })
  })

  it('cancelar mientras se prepara no avisa de error y la cola sigue con la siguiente', async () => {
    let created = 0
    mockApi('POST', '/api/youtube/jobs', () => (++created === 1 ? new Promise(() => {}) : ready()))
    const driveImport = useYoutubeDriveImport()
    driveImport.startMany([VIDEO, SECOND], 'mp3')
    await flush()
    driveImport.cancel('okShortVid1')
    await vi.waitFor(() => expect(driveImport.of('okShortVid2')?.stage).toBe('done'), { timeout: 5000 })
    expect(driveImport.of('okShortVid1')).toBeNull()
    expect(toasts().some(toast => toast.type === 'error')).toBe(false)
  })

  it('cancelar mientras baja corta el flujo, libera el trabajo del servicio y no sube nada', async () => {
    const cancelStream = stallingDownload()
    const driveImport = useYoutubeDriveImport()
    void driveImport.start(VIDEO, 'mp3')
    await vi.waitFor(() => expect(download).toHaveBeenCalled())
    await flush()
    driveImport.cancel('okShortVid1')
    await vi.waitFor(() => expect(driveImport.of('okShortVid1')).toBeNull())
    expect(cancelStream).toHaveBeenCalled()
    await vi.waitFor(() => expect(jobReleased()).toBe(true))
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('cancelar mientras sube aborta el envío, libera la reserva del drive y no publica', async () => {
    const abort = stallingUpload()
    const driveImport = useYoutubeDriveImport()
    void driveImport.start(VIDEO, 'mp3')
    await vi.waitFor(() => expect(put).toHaveBeenCalled())
    driveImport.cancel('okShortVid1')
    await vi.waitFor(() => expect(driveImport.of('okShortVid1')).toBeNull())
    expect(abort).toHaveBeenCalled()
    await vi.waitFor(() => expect(ticketReleased()).toBe(true))
    expect(posts('/api/uploads/f1/complete')).toHaveLength(0)
  })

  it('cancelar algo que no existe o ya terminó no hace nada', async () => {
    const driveImport = await run()
    driveImport.cancel('nadaNadaNad')
    driveImport.cancel('okShortVid1')
    expect(driveImport.of('okShortVid1')?.stage).toBe('done')
    expect(toasts().some(toast => toast.message === 'Guardado cancelado')).toBe(false)
  })

  it('si la descarga no empieza a responder se aborta con su aviso y se libera el trabajo del servicio', async () => {
    stubDownload(new Promise(() => {}))
    const { of } = await run()
    expect(of('okShortVid1')).toMatchObject({ stage: 'error' })
    expect(of('okShortVid1')!.message).toContain('La conexión se quedó sin respuesta.')
    expect(jobReleased()).toBe(true)
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('si el flujo se detiene a la mitad se aborta y corta el lector', async () => {
    const cancelStream = stallingDownload()
    const { of } = await run()
    expect(of('okShortVid1')!.message).toContain('La conexión se quedó sin respuesta.')
    expect(cancelStream).toHaveBeenCalled()
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('si la subida no avanza se aborta, libera la reserva y avisa', async () => {
    const abort = stallingUpload()
    const { of } = await run()
    expect(of('okShortVid1')!.message).toContain('La conexión se quedó sin respuesta.')
    expect(abort).toHaveBeenCalled()
    expect(ticketReleased()).toBe(true)
    expect(posts('/api/uploads/f1/complete')).toHaveLength(0)
  })

  it('una descarga colgada no bloquea la cola: la siguiente se guarda', async () => {
    download.mockImplementationOnce(() => new Promise(() => {}))
    const driveImport = useYoutubeDriveImport()
    driveImport.startMany([VIDEO, SECOND], 'mp3')
    await vi.waitFor(() => expect(driveImport.list.value.map(item => item.stage)).toEqual(['error', 'done']), { timeout: 5000 })
    expect(driveImport.of('okShortVid1')!.message).toContain('La conexión se quedó sin respuesta.')
  })
})
