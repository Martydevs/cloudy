// Guardar un video de YouTube en el drive del equipo (feature 005). El archivo no pasa por el servidor de Cloudy:
// 1) se crea un trabajo en el servicio de descargas y se sondea; 2) el navegador baja el archivo del enlace firmado;
// 3) lo sube al bucket con el flujo de subidas de siempre (`/api/uploads` → PUT prefirmado → `complete`), que registra
// la actividad `file.upload` con el origen YouTube. Va a la raíz del drive. El estado vive en `useState` (sobrevive a la
// navegación, no a la recarga) y lo muestran `YoutubeVideoMeta` y la bandeja.
// Una importación nunca se queda colgada: cada petición tiene su tope, la descarga y la subida se abortan si pasan
// `YOUTUBE_IMPORT_STALL_MS` sin avanzar, y la persona puede cancelarla (en cola o en curso) para liberar la cola.
import { FetchError } from 'ofetch'
import type { FileItem, UploadTicket, YoutubeJob } from '#shared/types/api'
import { MAX_FILE_SIZE } from '#shared/constants/files'
import { YOUTUBE_FORMATS, YOUTUBE_IMPORT_REQUEST_MS, YOUTUBE_IMPORT_STALL_MS, YOUTUBE_JOB_POLL_MS } from '#shared/constants/youtube'
import type { YoutubeDriveFormat } from '#shared/constants/youtube'
import { sanitizeFileName } from '#shared/validation/files'

export type DriveImportStage = 'queued' | 'preparing' | 'downloading' | 'uploading' | 'done' | 'error'

export interface DriveImport {
  videoId: string
  title: string
  format: YoutubeDriveFormat
  stage: DriveImportStage
  /** 0–100 de la etapa en curso. */
  progress: number
  /** Texto en español: el motivo si falló o el nombre del archivo si terminó. */
  message: string | null
}

/** Un error con el texto que se le muestra a la persona. */
class ImportError extends Error {}
/** La persona canceló: no es un fallo, no se avisa como tal. */
class ImportCancelled extends ImportError {}

/** Espera máxima por la conversión del servicio (el archivo vive 30 min allí). */
const MAX_WAIT_MS = 10 * 60_000
const MIME = { mp4: 'video/mp4', mp3: 'audio/mpeg' } as const

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const isActive = (stage: DriveImportStage) => stage !== 'done' && stage !== 'error'

/** Quien espera a que termine la importación de un video (`start` devuelve esa espera). */
const waiters = new Map<string, () => void>()
/** Cómo abortar la importación en curso de cada video (no se puede guardar en `useState`: no es serializable). */
const aborters = new Map<string, AbortController>()
const RUNNING: readonly DriveImportStage[] = ['preparing', 'downloading', 'uploading']

/** Se rechaza con el motivo de `signal` en cuanto se aborta, aunque lo esperado (un `fetch`, una petición) no lo haga. */
function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** Aborta `controller` si pasan `YOUTUBE_IMPORT_STALL_MS` sin que se llame a `kick` (señal de avance). */
function watchdog(controller: AbortController, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const kick = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(new ImportError(message)), YOUTUBE_IMPORT_STALL_MS)
  }
  return { kick, stop: () => clearTimeout(timer) }
}

export function useYoutubeDriveImport() {
  const imports = useState<Record<string, DriveImport>>('youtube-drive-imports', () => ({}))
  const api = useApi()
  const toast = useToast()
  const m = messages.youtube.drive

  function patch(videoId: string, changes: Partial<DriveImport>) {
    const current = imports.value[videoId]
    if (current) imports.value = { ...imports.value, [videoId]: { ...current, ...changes } }
  }

  function remove(videoId: string) {
    const { [videoId]: _removed, ...rest } = imports.value
    imports.value = rest
  }

  /** Petición a la API con tope de tiempo que se corta al cancelar o al abortarse la importación. */
  const requester = (signal: AbortSignal) => <T>(url: string, options: { method?: 'POST', body?: Record<string, unknown> } = {}) =>
    withSignal(api<T>(url, { ...options, signal, timeout: YOUTUBE_IMPORT_REQUEST_MS }), signal)

  /** Crea el trabajo y espera a que el servicio termine el archivo; deja su id en `track` para liberarlo si algo falla. */
  async function prepare(videoId: string, format: YoutubeDriveFormat, signal: AbortSignal, track: { jobId: string | null }): Promise<YoutubeJob> {
    const request = requester(signal)
    let job: YoutubeJob
    try {
      job = await request<YoutubeJob>('/api/youtube/jobs', { method: 'POST', body: { videoIds: [videoId], format } })
    }
    catch (error) {
      if (signal.aborted) throw signal.reason
      const status = error instanceof FetchError ? error.response?.status : 0
      throw new ImportError(status === 503 ? messages.youtube.service.waking : serverMessage(error, m.jobFailed, { 429: messages.youtube.service.busy }))
    }
    track.jobId = job.jobId
    const deadline = Date.now() + MAX_WAIT_MS
    while (job.status !== 'done') {
      if (job.status === 'failed' || job.status === 'expired') throw new ImportError(m.jobFailed)
      if (Date.now() > deadline) throw new ImportError(m.timeout)
      patch(videoId, { progress: job.progress })
      await withSignal(sleep(YOUTUBE_JOB_POLL_MS), signal)
      try {
        job = await request<YoutubeJob>(`/api/youtube/jobs/${job.jobId}`)
      }
      catch (error) {
        if (signal.aborted) throw signal.reason
        // El servicio olvidó el trabajo: no hay nada que esperar. Otro fallo (red, 502, tope de tiempo) se reintenta en el siguiente sondeo.
        if (error instanceof FetchError && error.response?.status === 404) throw new ImportError(m.jobFailed)
      }
    }
    return job
  }

  const tooLarge = (bytes: number) => new ImportError(m.tooLarge(formatBytes(bytes)))

  /** Baja el archivo del enlace firmado (el servicio admite el origen de Cloudy) con su avance. */
  async function download(videoId: string, job: YoutubeJob, controller: AbortController): Promise<Blob> {
    if (!job.downloadUrl) throw new ImportError(m.jobFailed)
    if (job.sizeBytes && job.sizeBytes > MAX_FILE_SIZE) throw tooLarge(job.sizeBytes)
    const { signal } = controller
    patch(videoId, { stage: 'downloading', progress: 0 })
    const stall = watchdog(controller, m.stalled)
    stall.kick()
    try {
      const response = await withSignal(fetch(job.downloadUrl, { signal }), signal).catch(() => {
        if (signal.aborted) throw signal.reason
        return null
      })
      if (!response?.ok) throw new ImportError(m.downloadFailed)
      const total = Number(response.headers.get('content-length')) || job.sizeBytes || 0
      if (total > MAX_FILE_SIZE) throw tooLarge(total)
      const reader = response.body?.getReader()
      if (!reader) return await withSignal(response.blob(), signal)
      const chunks: Uint8Array<ArrayBuffer>[] = []
      let received = 0
      try {
        for (;;) {
          const { done, value } = await withSignal(reader.read(), signal)
          if (done) break
          stall.kick()
          chunks.push(value as Uint8Array<ArrayBuffer>)
          received += value.byteLength
          if (received > MAX_FILE_SIZE) throw tooLarge(received)
          if (total) patch(videoId, { progress: Math.min(99, Math.round((received / total) * 100)) })
        }
      }
      catch (error) {
        reader.cancel().catch(() => {})
        throw error
      }
      return new Blob(chunks)
    }
    catch (error) {
      if (signal.aborted) throw signal.reason
      throw error instanceof ImportError ? error : new ImportError(m.downloadFailed)
    }
    finally {
      stall.stop()
    }
  }

  /** Sube el archivo a la raíz del drive y lo publica; sin registros a medias si algo falla. */
  async function upload(videoId: string, format: YoutubeDriveFormat, file: File, controller: AbortController): Promise<FileItem> {
    const { signal } = controller
    patch(videoId, { stage: 'uploading', progress: 0 })
    const ticket = await requester(signal)<UploadTicket>('/api/uploads', {
      method: 'POST',
      body: { folderId: null, name: file.name, size: file.size, mimeType: file.type },
    })
    const stall = watchdog(controller, m.stalled)
    stall.kick()
    try {
      await withSignal(putWithProgress(ticket.uploadUrl, file, ticket.headers, (ratio) => {
        stall.kick()
        patch(videoId, { progress: Math.min(99, Math.round(ratio * 100)) })
      }, (xhr) => {
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }), signal)
      stall.stop()
      // Ya subido: publicarlo no se cancela a medias (el servidor lo termina aunque la persona se arrepienta tarde).
      aborters.delete(videoId)
      return await api<FileItem>(`/api/uploads/${ticket.fileId}/complete`, {
        method: 'POST',
        body: { source: { videoId, format } },
        timeout: YOUTUBE_IMPORT_REQUEST_MS,
      })
    }
    catch (error) {
      api(`/api/uploads/${ticket.fileId}`, { method: 'DELETE' }).catch(() => {})
      throw signal.aborted ? signal.reason : error
    }
    finally {
      stall.stop()
    }
  }

  /** Registra la importación de `video` con la etapa dada; `false` si ya hay una en curso (un segundo clic no hace nada). */
  function register(video: { videoId: string, title: string }, format: YoutubeDriveFormat, stage: DriveImportStage): boolean {
    const { videoId, title } = video
    const current = imports.value[videoId]
    if (current && isActive(current.stage)) return false
    imports.value = { ...imports.value, [videoId]: { videoId, title, format, stage, progress: 0, message: null } }
    return true
  }

  /** Corre una importación ya registrada hasta que termina, falla o se cancela. */
  async function run(video: { videoId: string, title: string }, format: YoutubeDriveFormat) {
    const { videoId, title } = video
    const controller = new AbortController()
    aborters.set(videoId, controller)
    const track: { jobId: string | null } = { jobId: null }
    /** El archivo ya está en el navegador (o la importación terminó): el del servicio no hace falta ni debe ocupar su instancia. */
    const releaseJob = () => {
      if (!track.jobId) return
      api(`/api/youtube/jobs/${track.jobId}`, { method: 'DELETE' }).catch(() => {})
      track.jobId = null
    }
    try {
      const job = await prepare(videoId, format, controller.signal, track)
      const blob = await download(videoId, job, controller)
      releaseJob()
      const extension = YOUTUBE_FORMATS.find(f => f.value === format)!.extension
      const file = new File([blob], sanitizeFileName(`${title}.${extension}`), { type: MIME[extension] })
      const saved = await upload(videoId, format, file, controller)
      patch(videoId, { stage: 'done', progress: 100, message: saved.name })
      toast.success(m.done(saved.name), { action: { label: m.view, to: '/archivos' } })
    }
    catch (error) {
      if (error instanceof ImportCancelled) {
        remove(videoId)
        toast.info(m.cancelled)
      }
      else {
        const message = error instanceof ImportError
          ? error.message
          : serverMessage(error, m.failed, { 401: messages.common.sessionChanged, 403: messages.common.sessionChanged })
        patch(videoId, { stage: 'error', message })
        toast.error(message)
      }
    }
    finally {
      releaseJob()
      aborters.delete(videoId)
    }
  }

  /** La cola vive en el propio estado: arranca la siguiente importación «en cola» si ninguna está corriendo (de una en una: cada archivo se carga entero en el navegador). */
  function pump() {
    const all = Object.values(imports.value)
    if (all.some(item => RUNNING.includes(item.stage))) return
    const next = all.find(item => item.stage === 'queued')
    if (!next) return
    patch(next.videoId, { stage: 'preparing', progress: 0 })
    void run(next, next.format).finally(() => {
      waiters.get(next.videoId)?.()
      waiters.delete(next.videoId)
      pump()
    })
  }

  /** Guarda `video` en el drive como audio (`mp3`) o video (`mp4_720`). Un segundo clic mientras corre no hace nada. */
  async function start(video: { videoId: string, title: string }, format: YoutubeDriveFormat) {
    if (!register(video, format, 'queued')) return
    const finished = new Promise<void>(resolve => waiters.set(video.videoId, resolve))
    pump()
    await finished
  }

  /** Guarda varios videos: todos quedan «en cola» y se suben de uno en uno. Devuelve cuántos se encolaron. */
  function startMany(videos: readonly { videoId: string, title: string }[], format: YoutubeDriveFormat): number {
    let queued = 0
    for (const video of videos) {
      if (!register(video, format, 'queued')) continue
      queued++
    }
    pump()
    return queued
  }

  /** Cancela una importación: en cola sale de la cola; en curso se aborta y la cola sigue con la siguiente. */
  function cancel(videoId: string) {
    const current = imports.value[videoId]
    if (!current || !isActive(current.stage)) return
    if (current.stage === 'queued') {
      remove(videoId)
      waiters.get(videoId)?.()
      waiters.delete(videoId)
      toast.info(m.cancelled)
      return
    }
    aborters.get(videoId)?.abort(new ImportCancelled())
  }

  /** Quita de la bandeja una importación terminada o fallida. */
  function dismiss(videoId: string) {
    const current = imports.value[videoId]
    if (!current || isActive(current.stage)) return
    remove(videoId)
  }

  /** Vuelve a intentar una importación fallida con el mismo formato. */
  function retry(videoId: string) {
    const current = imports.value[videoId]
    if (current?.stage === 'error') return start({ videoId, title: current.title }, current.format)
  }

  return {
    imports,
    start,
    startMany,
    cancel,
    dismiss,
    retry,
    /** Importaciones en orden de inicio, para la bandeja. */
    list: computed(() => Object.values(imports.value)),
    hasImports: computed(() => Object.keys(imports.value).length > 0),
    /** La importación de un video, si hay una. */
    of: (videoId: string): DriveImport | null => imports.value[videoId] ?? null,
    isActive,
  }
}
