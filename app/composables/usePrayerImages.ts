// Cola de imágenes de peticiones (feature 007, research D8; forma de `useSongPresentations`): una imagen por petición HTTP y
// dos a la vez. La cola vive en `useState('prayer-images')` y la mueve el propio estado (`pump`); los `AbortController` van en
// un mapa del módulo. No descarga sola: la persona revisa la vista previa y pulsa **Descargar**. Los resultados viven en la
// página (no en una bandeja del layout) y se pierden al salir.
import type { PrayerRequest } from '#shared/types/api'
import type { PrayerErrorCode } from '#shared/constants/prayers'
import { PRAYER_ERROR_MESSAGES, PRAYER_IMAGE_CONCURRENCY, PRAYER_IMAGE_TIMEOUT_MS } from '#shared/constants/prayers'
import { FetchError } from 'ofetch'

export type PrayerImageStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface PrayerImageItem {
  key: string
  /** 1-based: posición en el reparto y en el nombre del archivo. */
  index: number
  fileIds: string[]
  status: PrayerImageStatus
  /** `objectURL` de la imagen lista. */
  url?: string
  filename?: string
  downloaded: boolean
  error?: string
  errorCode?: PrayerErrorCode | null
  retryable?: boolean
}

const ACTIVE: readonly PrayerImageStatus[] = ['queued', 'running']
/** Requieren a un administrador o retirar peticiones: **Reintentar** no ayudaría. */
const FINAL: readonly PrayerErrorCode[] = ['quota_exceeded', 'not_configured', 'request_unavailable']
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

class Canceled extends Error {}
class TimedOut extends Error {}

const controllers = new Map<string, AbortController>()
/** Ids retirados por un `409`: la página los quita de la selección. */
const unavailable = createEventHook<string[]>()

const isCode = (value: unknown): value is PrayerErrorCode => typeof value === 'string' && value in PRAYER_ERROR_MESSAGES

/** `AAAA-MM-DD` en la zona de quien genera. */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function usePrayerImages() {
  const api = useApi()
  const toast = useToast()
  const items = useState<PrayerImageItem[]>('prayer-images', () => [])
  const m = messages.prayers

  const find = (key: string) => items.value.find(item => item.key === key)

  function patch(key: string, changes: Partial<PrayerImageItem>) {
    items.value = items.value.map(item => (item.key === key ? { ...item, ...changes } : item))
  }

  function release(item: PrayerImageItem | undefined) {
    if (!item) return
    controllers.get(item.key)?.abort(new Canceled())
    controllers.delete(item.key)
    revokeDownload(item.url)
  }

  /** Por qué falló, en español, y si **Reintentar** tiene sentido. */
  async function describe(error: unknown): Promise<Pick<PrayerImageItem, 'error' | 'errorCode' | 'retryable'>> {
    await readBlobError(error)
    const response = error instanceof FetchError ? error.response : undefined
    const code = (error as { data?: { data?: { code?: unknown } } } | null)?.data?.data?.code
    if (isCode(code)) return { error: PRAYER_ERROR_MESSAGES[code], errorCode: code, retryable: !FINAL.includes(code) }
    if (!response) return { error: m.connectionLost, errorCode: null, retryable: true }
    if (response.status === 504) return { error: PRAYER_ERROR_MESSAGES.timeout, errorCode: 'timeout', retryable: true }
    if (response.status === 429) return { error: PRAYER_ERROR_MESSAGES.rate_limited, errorCode: 'rate_limited', retryable: true }
    return { error: serverMessage(error, m.failed), errorCode: null, retryable: response.status >= 500 }
  }

  async function run(item: PrayerImageItem) {
    const controller = new AbortController()
    controllers.set(item.key, controller)
    const timer = setTimeout(() => controller.abort(new TimedOut()), PRAYER_IMAGE_TIMEOUT_MS)
    // Un `reset` o `dismiss` pudo reemplazar este intento: entonces no se escribe nada.
    const current = () => controllers.get(item.key) === controller
    try {
      // `$api` no expone `.raw`: el tipo se lee en `onResponse` si el `Blob` no lo trae.
      let type: string | null = null
      const request = api<Blob>('/api/peticiones/imagenes', {
        method: 'POST',
        body: { fileIds: item.fileIds },
        responseType: 'blob',
        signal: controller.signal,
        onResponse: ({ response }) => {
          type = response.headers.get('content-type')
        },
      })
      // Cancelar o vencer el plazo libera la cola aunque el transporte no respete la señal.
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      })
      request.catch(() => {})
      const blob = await Promise.race([request, aborted])
      if (!(blob instanceof Blob)) throw new Error('sin imagen')
      if (!current()) return
      const mediaType = (blob.type || type || 'image/png').split(';')[0]!.trim()
      const url = URL.createObjectURL(blob)
      patch(item.key, {
        status: 'done',
        url,
        filename: `peticiones-${today()}-${item.index}.${EXTENSIONS[mediaType] ?? 'png'}`,
        downloaded: false,
        error: undefined,
        errorCode: null,
        retryable: false,
      })
      toast.success(m.generated(item.index))
    }
    catch (error) {
      if (!current()) return
      const reason = controller.signal.reason
      if (reason instanceof Canceled) {
        patch(item.key, { status: 'canceled', error: undefined, retryable: false })
        return
      }
      if (reason instanceof TimedOut) {
        patch(item.key, { status: 'failed', error: PRAYER_ERROR_MESSAGES.timeout, errorCode: 'timeout', retryable: true })
        return
      }
      const failure = await describe(error)
      patch(item.key, { status: 'failed', ...failure })
      if (failure.errorCode === 'request_unavailable') {
        const ids = (error as { data?: { data?: { ids?: unknown } } }).data?.data?.ids
        if (Array.isArray(ids)) void unavailable.trigger(ids.filter((id): id is string => typeof id === 'string'))
      }
    }
    finally {
      clearTimeout(timer)
      if (current()) controllers.delete(item.key)
    }
  }

  /** La cola vive en el estado: arranca «en cola» hasta tener 2 corriendo. */
  function pump() {
    let running = items.value.filter(item => item.status === 'running').length
    for (const next of items.value.filter(item => item.status === 'queued')) {
      if (running >= PRAYER_IMAGE_CONCURRENCY) return
      patch(next.key, { status: 'running' })
      running++
      void run({ ...next, status: 'running' }).finally(pump)
    }
  }

  /** Una imagen por grupo (1–4 peticiones), numeradas a continuación de las que ya están en la página. */
  function enqueue(groups: readonly (readonly Pick<PrayerRequest, 'id'>[])[]): number {
    let index = items.value.reduce((max, item) => Math.max(max, item.index), 0)
    const added = groups.filter(group => group.length > 0).map((group): PrayerImageItem => {
      index++
      return { key: `img-${index}`, index, fileIds: group.map(request => request.id), status: 'queued', downloaded: false }
    })
    items.value = [...items.value, ...added]
    pump()
    return added.length
  }

  /** En cola: sale de la cola. Generándose: se aborta y la cola sigue. */
  function cancel(key: string) {
    const item = find(key)
    if (item?.status === 'queued') items.value = items.value.filter(other => other.key !== key)
    else if (item?.status === 'running') controllers.get(key)?.abort(new Canceled())
  }

  function retry(key: string) {
    const item = find(key)
    if (item?.status !== 'failed' || !item.retryable) return
    patch(key, { status: 'queued', error: undefined, errorCode: null })
    pump()
  }

  /** **Generar de nuevo** una imagen lista (o cancelada): solo esa vuelve a la cola. */
  function regenerate(key: string) {
    const item = find(key)
    if (!item || (item.status !== 'done' && item.status !== 'canceled')) return
    revokeDownload(item.url)
    patch(key, { status: 'queued', url: undefined, filename: undefined, downloaded: false, error: undefined, errorCode: null })
    pump()
  }

  function download(key: string) {
    const item = find(key)
    if (item?.status !== 'done' || !item.url || !item.filename) return
    triggerDownload(item.url, item.filename)
    patch(key, { downloaded: true })
  }

  function dismiss(key: string) {
    release(find(key))
    items.value = items.value.filter(item => item.key !== key)
    pump()
  }

  /** Aborta todo, libera las imágenes y vacía la página. */
  function reset() {
    for (const item of items.value) release(item)
    items.value = []
  }

  return {
    items,
    enqueue,
    cancel,
    retry,
    regenerate,
    download,
    dismiss,
    dismissAll: reset,
    reset,
    hasItems: computed(() => items.value.length > 0),
    /** Hay algo generándose o una imagen lista sin descargar. */
    needsLeaveGuard: computed(() => items.value.some(item => ACTIVE.includes(item.status) || (item.status === 'done' && !item.downloaded))),
    onUnavailable: unavailable.on,
  }
}
