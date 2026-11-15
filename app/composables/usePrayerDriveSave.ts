// Guardar imágenes de peticiones en el drive (enmienda «Página de generación», 2026-11-15; forma de `useYoutubeDriveImport`).
// Sin backend nuevo y sin que el binario pase por una función: el navegador lee la imagen guardada (`previewUrl` → 302 a la
// URL firmada; el CORS del bucket admite GET desde el sitio) y la sube con el flujo de subidas de siempre (`/api/uploads` →
// PUT prefirmado → `complete`) a la raíz del drive. Si algo falla después de pedir el ticket, se descarta la subida (sin
// registros a medias). De una en una: la cola vive en `useState('prayer-drive-saves')` y la mueve el propio estado
// (`pump`); los `AbortController` van en un mapa del módulo. Se puede cancelar en cola o en curso.
import type { FileItem, PrayerGeneratedImage, UploadTicket } from '#shared/types/api'
import { MAX_FILE_SIZE } from '#shared/constants/files'
import { sanitizeFileName } from '#shared/validation/files'

export type PrayerDriveStage = 'queued' | 'downloading' | 'uploading' | 'done' | 'error'

export interface PrayerDriveSave {
  imageId: string
  /** Lo que la persona ve en la lista («Imagen 3»). */
  label: string
  /** Lo necesario para leer y nombrar la imagen. */
  image: Pick<PrayerGeneratedImage, 'id' | 'previewUrl' | 'createdAt'>
  stage: PrayerDriveStage
  /** 0–100 de la subida. */
  progress: number
  /** El nombre guardado si terminó; el motivo si falló. */
  message: string | null
}

/** Un error con el texto que se le muestra a la persona. */
class SaveError extends Error {}
/** La persona canceló: no es un fallo. */
class SaveCancelled extends SaveError {}

const REQUEST_MS = 30_000
const EXTENSIONS: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const RUNNING: readonly PrayerDriveStage[] = ['downloading', 'uploading']

const aborters = new Map<string, AbortController>()

/** Se rechaza con el motivo de `signal` en cuanto se aborta, aunque lo esperado no lo haga. */
function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** `peticiones-AAAA-MM-DD-<6 del id>.<ext>`, con la fecha en UTC: el mismo nombre que la descarga del servidor. */
export function prayerImageFileName(image: Pick<PrayerGeneratedImage, 'id' | 'createdAt'>, mediaType: string): string {
  const extension = EXTENSIONS[mediaType.toLowerCase()] ?? 'png'
  return sanitizeFileName(`peticiones-${new Date(image.createdAt).toISOString().slice(0, 10)}-${image.id.slice(0, 6)}.${extension}`)
}

export function usePrayerDriveSave() {
  const saves = useState<Record<string, PrayerDriveSave>>('prayer-drive-saves', () => ({}))
  /** Guardadas desde que la cola arrancó: un solo aviso al vaciarse. */
  const finished = useState<string[]>('prayer-drive-saves-finished', () => [])
  const api = useApi()
  const toast = useToast()
  const m = messages.prayers.generation.drive

  function patch(imageId: string, changes: Partial<PrayerDriveSave>) {
    const current = saves.value[imageId]
    if (current) saves.value = { ...saves.value, [imageId]: { ...current, ...changes } }
  }

  function remove(imageId: string) {
    const { [imageId]: _removed, ...rest } = saves.value
    saves.value = rest
  }

  const request = <T>(url: string, signal: AbortSignal, options: { method?: 'POST', body?: Record<string, unknown> } = {}) =>
    withSignal(api<T>(url, { ...options, signal, timeout: REQUEST_MS }), signal)

  /**
   * Lee la imagen guardada (302 a la URL firmada). `no-store`: el `<img>` del pase ya cargó esa misma redirección y su imagen
   * sin CORS (la redirección se cachea 10 min); reusarlas haría fallar esta lectura por CORS.
   */
  async function read(save: PrayerDriveSave, signal: AbortSignal): Promise<Blob> {
    patch(save.imageId, { stage: 'downloading', progress: 0 })
    const response = await withSignal(fetch(save.image.previewUrl, { signal, credentials: 'same-origin', cache: 'no-store' }), signal).catch(() => {
      if (signal.aborted) throw signal.reason
      return null
    })
    if (!response?.ok) throw new SaveError(m.downloadFailed)
    const blob = await withSignal(response.blob(), signal).catch(() => {
      if (signal.aborted) throw signal.reason
      throw new SaveError(m.downloadFailed)
    })
    if (blob.size > MAX_FILE_SIZE) throw new SaveError(m.tooLarge)
    return blob
  }

  /** Sube el archivo a la raíz del drive y lo publica; descarta la subida si algo falla. */
  async function upload(save: PrayerDriveSave, file: File, controller: AbortController): Promise<FileItem> {
    const { signal } = controller
    patch(save.imageId, { stage: 'uploading', progress: 0 })
    const ticket = await request<UploadTicket>('/api/uploads', signal, {
      method: 'POST',
      body: { folderId: null, name: file.name, size: file.size, mimeType: file.type },
    })
    try {
      await withSignal(putWithProgress(ticket.uploadUrl, file, ticket.headers, (ratio) => {
        patch(save.imageId, { progress: Math.min(99, Math.round(ratio * 100)) })
      }, (xhr) => {
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }), signal)
      // Ya subida: publicarla no se cancela a medias.
      aborters.delete(save.imageId)
      return await api<FileItem>(`/api/uploads/${ticket.fileId}/complete`, { method: 'POST', timeout: REQUEST_MS })
    }
    catch (error) {
      api(`/api/uploads/${ticket.fileId}`, { method: 'DELETE' }).catch(() => {})
      throw signal.aborted ? signal.reason : error
    }
  }

  async function run(save: PrayerDriveSave) {
    const controller = new AbortController()
    aborters.set(save.imageId, controller)
    try {
      const blob = await read(save, controller.signal)
      const type = blob.type || 'image/png'
      const file = new File([blob], prayerImageFileName(save.image, type), { type })
      const saved = await upload(save, file, controller)
      patch(save.imageId, { stage: 'done', progress: 100, message: saved.name })
      finished.value = [...finished.value, saved.name]
    }
    catch (error) {
      if (error instanceof SaveCancelled) {
        remove(save.imageId)
        toast.info(m.cancelled)
        return
      }
      const message = error instanceof SaveError
        ? error.message
        : serverMessage(error, m.failed, { 401: messages.common.sessionChanged, 403: messages.common.sessionChanged })
      patch(save.imageId, { stage: 'error', message })
      toast.error(message)
    }
    finally {
      aborters.delete(save.imageId)
    }
  }

  /** Un aviso cuando la cola se vacía: «Ver en Archivos». */
  function announce() {
    const names = finished.value
    if (names.length === 0) return
    finished.value = []
    const action = { label: m.view, to: '/archivos' }
    toast.success(names.length === 1 ? m.saved(names[0]!) : m.savedMany(names.length), { action })
  }

  /** De una en una: cada imagen se carga entera en el navegador. */
  function pump() {
    const all = Object.values(saves.value)
    if (all.some(save => RUNNING.includes(save.stage))) return
    const next = all.find(save => save.stage === 'queued')
    if (!next) {
      announce()
      return
    }
    patch(next.imageId, { stage: 'downloading', progress: 0 })
    void run(next).finally(pump)
  }

  /** Encola las imágenes (las que ya están en cola o en curso se saltan). Devuelve cuántas entraron. */
  function save(images: readonly { image: PrayerDriveSave['image'], label: string }[]): number {
    let queued = 0
    let next = saves.value
    for (const { image, label } of images) {
      const current = next[image.id]
      if (current && (current.stage === 'queued' || RUNNING.includes(current.stage))) continue
      next = { ...next, [image.id]: { imageId: image.id, label, image: { id: image.id, previewUrl: image.previewUrl, createdAt: image.createdAt }, stage: 'queued', progress: 0, message: null } }
      queued++
    }
    saves.value = next
    pump()
    return queued
  }

  /** En cola: sale de la cola. En curso: se aborta y la cola sigue. */
  function cancel(imageId: string) {
    const current = saves.value[imageId]
    if (!current) return
    if (current.stage === 'queued') {
      remove(imageId)
      toast.info(m.cancelled)
      pump()
    }
    else if (RUNNING.includes(current.stage)) {
      aborters.get(imageId)?.abort(new SaveCancelled())
    }
  }

  function retry(imageId: string) {
    const current = saves.value[imageId]
    if (current?.stage !== 'error') return
    patch(imageId, { stage: 'queued', progress: 0, message: null })
    pump()
  }

  /** Quita de la lista una terminada o fallida. */
  function dismiss(imageId: string) {
    const current = saves.value[imageId]
    if (current && (current.stage === 'done' || current.stage === 'error')) remove(imageId)
  }

  return {
    saves,
    list: computed(() => Object.values(saves.value)),
    hasSaves: computed(() => Object.keys(saves.value).length > 0),
    busy: computed(() => Object.values(saves.value).some(save => save.stage === 'queued' || RUNNING.includes(save.stage))),
    save,
    cancel,
    retry,
    dismiss,
  }
}
