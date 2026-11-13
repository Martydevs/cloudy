// Cola de imágenes de peticiones (feature 007, research D8; forma de `useSongPresentations`): una imagen por petición HTTP y
// dos a la vez. La cola vive en `useState('prayer-images')` y la mueve el propio estado (`pump`); los `AbortController` van en
// un mapa del módulo. Enmienda de historial: el servidor guarda cada imagen y responde su JSON, así que una imagen lista sale
// de la cola y entra arriba en el historial (`PRAYER_HISTORY_ADDED_KEY`); en la cola solo quedan las que están en curso,
// fallaron o se cancelaron.
import type { PrayerGeneratedImage, PrayerRequest } from '#shared/types/api'
import type { PrayerErrorCode } from '#shared/constants/prayers'
import { PRAYER_ERROR_MESSAGES, PRAYER_IMAGE_CONCURRENCY, PRAYER_IMAGE_TIMEOUT_MS } from '#shared/constants/prayers'
import { FetchError } from 'ofetch'

export type PrayerImageStatus = 'queued' | 'running' | 'failed' | 'canceled'

export interface PrayerImageItem {
  key: string
  /** 1-based: el número con el que la cola nombra la imagen («Imagen 2 lista»). */
  index: number
  fileIds: string[]
  status: PrayerImageStatus
  error?: string
  errorCode?: PrayerErrorCode | null
  retryable?: boolean
}

const ACTIVE: readonly PrayerImageStatus[] = ['queued', 'running']
/** Requieren a un administrador o retirar peticiones: **Reintentar** no ayudaría. */
const FINAL: readonly PrayerErrorCode[] = ['quota_exceeded', 'not_configured', 'request_unavailable']

class Canceled extends Error {}
class TimedOut extends Error {}

const controllers = new Map<string, AbortController>()
/** Ids retirados por un `409`: la página los quita de la selección. Tupla: con `string[]` VueUse leería cada id como un argumento. */
const unavailable = createEventHook<[ids: string[]]>()

const isCode = (value: unknown): value is PrayerErrorCode => typeof value === 'string' && value in PRAYER_ERROR_MESSAGES

export function usePrayerImages() {
  const api = useApi()
  const toast = useToast()
  const items = useState<PrayerImageItem[]>('prayer-images', () => [])
  const added = useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY, () => [])
  /** Último aviso para la región viva del historial (lista o fallida). */
  const announcement = useState('prayer-images-announcement', () => '')
  const m = messages.prayers

  const find = (key: string) => items.value.find(item => item.key === key)

  function patch(key: string, changes: Partial<PrayerImageItem>) {
    items.value = items.value.map(item => (item.key === key ? { ...item, ...changes } : item))
  }

  function release(item: PrayerImageItem | undefined) {
    if (!item) return
    controllers.get(item.key)?.abort(new Canceled())
    controllers.delete(item.key)
  }

  /** Por qué falló, en español, y si **Reintentar** tiene sentido. */
  function describe(error: unknown): Pick<PrayerImageItem, 'error' | 'errorCode' | 'retryable'> {
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
      const request = api<PrayerGeneratedImage>('/api/peticiones/imagenes', {
        method: 'POST',
        body: { fileIds: item.fileIds },
        signal: controller.signal,
      })
      // Cancelar o vencer el plazo libera la cola aunque el transporte no respete la señal.
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      })
      request.catch(() => {})
      const image = await Promise.race([request, aborted])
      if (!image?.id) throw new Error('sin imagen')
      if (!current()) return
      // Guardada: sale de la cola y entra arriba en el historial.
      items.value = items.value.filter(other => other.key !== item.key)
      added.value = [image, ...added.value.filter(other => other.id !== image.id)]
      announcement.value = m.generated(item.index)
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
        announcement.value = m.failedImage(item.index)
        return
      }
      const failure = describe(error)
      patch(item.key, { status: 'failed', ...failure })
      announcement.value = m.failedImage(item.index)
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

  /** Numeración continua en la sesión: no se repite aunque las anteriores ya hayan salido de la cola. */
  const counter = useState('prayer-images-counter', () => 0)

  /** Una imagen por grupo (1–4 peticiones). */
  function enqueue(groups: readonly (readonly Pick<PrayerRequest, 'id'>[])[]): number {
    const fresh = groups.filter(group => group.length > 0).map((group): PrayerImageItem => {
      counter.value++
      return { key: `img-${counter.value}`, index: counter.value, fileIds: group.map(request => request.id), status: 'queued' }
    })
    items.value = [...items.value, ...fresh]
    pump()
    return fresh.length
  }

  /** **Generar de nuevo** una imagen del historial: las mismas peticiones; el servidor relee su texto actual. */
  function regenerateFrom(fileIds: readonly string[]): number {
    return enqueue([fileIds.map(id => ({ id }))])
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

  /** Una imagen cancelada vuelve a la cola. */
  function regenerate(key: string) {
    const item = find(key)
    if (item?.status !== 'canceled') return
    patch(key, { status: 'queued', error: undefined, errorCode: null })
    pump()
  }

  function dismiss(key: string) {
    release(find(key))
    items.value = items.value.filter(item => item.key !== key)
    pump()
  }

  /** Aborta todo, vacía la cola y vuelve a numerar desde 1. Lo ya guardado sigue en el historial. */
  function reset() {
    for (const item of items.value) release(item)
    items.value = []
    counter.value = 0
  }

  return {
    items,
    announcement,
    enqueue,
    regenerateFrom,
    cancel,
    retry,
    regenerate,
    dismiss,
    reset,
    hasItems: computed(() => items.value.length > 0),
    /** Hay algo en cola o generándose: lo terminado ya está guardado. */
    needsLeaveGuard: computed(() => items.value.some(item => ACTIVE.includes(item.status))),
    onUnavailable: unavailable.on,
  }
}
