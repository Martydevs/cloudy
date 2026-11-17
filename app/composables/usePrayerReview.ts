// Revisión del texto de las peticiones antes de generar (`PrayerReviewDialog`). Al abrir pide, en una sola llamada, las
// transcripciones guardadas de toda la selección y después lee con el modelo las fotos que no tienen ninguna, **una a la
// vez y en el orden de las imágenes**. Cada tarjeta tiene su estado; guardar y verificar pasan por el servidor, que es la
// autoridad (el texto nunca viaja a la generación desde aquí). El estado vive en `useState('prayer-review')` por id de foto:
// reabrir el diálogo muestra al instante lo ya conocido y lo refresca. Un solo `AbortController` por apertura: cerrar el
// diálogo deja de leer. Si el servicio se queda sin crédito o sin configurar, la lectura se detiene para las que faltan y
// queda escribir a mano.
import type { PrayerRequest, PrayerTranscript } from '#shared/types/api'
import type { PrayerErrorCode } from '#shared/constants/prayers'
import { PRAYER_ERROR_MESSAGES, PRAYER_TRANSCRIPT_TIMEOUT_MS } from '#shared/constants/prayers'
import { FetchError } from 'ofetch'

/**
 * `waiting`: en fila para leerse · `reading`: el modelo la está leyendo · `draft`: con texto sin verificar · `verified` ·
 * `empty`: el modelo no encontró texto · `failed`: la lectura falló (no hay nada guardado).
 */
export type PrayerReviewStatus = 'waiting' | 'reading' | 'draft' | 'verified' | 'empty' | 'failed'

export interface PrayerReviewEntry {
  fileId: string
  status: PrayerReviewStatus
  /** El texto guardado en el servidor; vacío si todavía no hay. */
  text: string
  error?: string
  errorCode?: PrayerErrorCode | null
  /** **Reintentar** tiene sentido. */
  retryable?: boolean
  /** «Volver a leer»: la próxima lectura reemplaza el texto guardado; `resume` es el estado al que vuelve si falla. */
  force?: boolean
  resume?: PrayerReviewStatus
  saving?: boolean
}

/** Una tarjeta del diálogo: la petición con el estado de su texto. */
export interface PrayerReviewCard extends PrayerReviewEntry { request: PrayerRequest }

export type PrayerReviewPhase = 'idle' | 'loading' | 'error' | 'ready'

/** La lectura se detiene para todas las fotos que faltan: hace falta un administrador. */
const HALTING: readonly PrayerErrorCode[] = ['quota_exceeded', 'not_configured']
/** **Reintentar** no ayudaría. */
const FINAL: readonly PrayerErrorCode[] = [...HALTING, 'request_unavailable', 'unreadable_image']

class Closed extends Error {}
class TimedOut extends Error {}

/** La apertura en curso del diálogo; cerrarlo la aborta. Fuera del estado: un `AbortController` no se serializa. */
let session: AbortController | null = null
/** La apertura cuya fila de lecturas está corriendo (una sola a la vez). */
let pumping: AbortController | null = null
/** Ids retirados por un `409`: la página los quita de la selección. Tupla: con `string[]` VueUse leería cada id como un argumento. */
const unavailable = createEventHook<[ids: string[]]>()

const isCode = (value: unknown): value is PrayerErrorCode => typeof value === 'string' && value in PRAYER_ERROR_MESSAGES
const codeOf = (error: unknown) => (error as { data?: { data?: { code?: unknown } } } | null)?.data?.data?.code
const idsOf = (error: unknown): string[] => {
  const ids = (error as { data?: { data?: { ids?: unknown } } } | null)?.data?.data?.ids
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

function fromTranscript(transcript: PrayerTranscript): PrayerReviewEntry {
  const status = transcript.status === 'verified'
    ? 'verified'
    : transcript.text === '' && transcript.origin === 'model' ? 'empty' : 'draft'
  return { fileId: transcript.fileId, status, text: transcript.text }
}

export function usePrayerReview() {
  const api = useApi()
  const toast = useToast()
  const m = messages.prayers.review
  const entries = useState<Record<string, PrayerReviewEntry>>('prayer-review', () => ({}))
  /** Las peticiones del diálogo abierto, en el orden de las imágenes. */
  const requests = useState<PrayerRequest[]>('prayer-review-requests', () => [])
  const phase = useState<PrayerReviewPhase>('prayer-review-phase', () => 'idle')
  /** Por qué se detuvo la lectura de las que faltaban; `null` si sigue. */
  const halted = useState<PrayerErrorCode | null>('prayer-review-halted', () => null)
  /** Último aviso para la región viva del diálogo. */
  const announcement = useState('prayer-review-announcement', () => '')

  const nameOf = (id: string) => requests.value.find(request => request.id === id)?.senderName ?? ''

  function patch(id: string, changes: Partial<PrayerReviewEntry>) {
    const entry = entries.value[id]
    if (entry) entries.value = { ...entries.value, [id]: { ...entry, ...changes } }
  }

  function put(entry: PrayerReviewEntry) {
    entries.value = { ...entries.value, [entry.fileId]: entry }
  }

  /** Por qué falló una lectura, en español, y si **Reintentar** tiene sentido. */
  function describe(error: unknown): Pick<PrayerReviewEntry, 'error' | 'errorCode' | 'retryable'> {
    const code = codeOf(error)
    if (isCode(code)) {
      const text = (m.errors as Partial<Record<PrayerErrorCode, string>>)[code] ?? m.errors.failed
      return { error: text, errorCode: code, retryable: !FINAL.includes(code) }
    }
    const response = error instanceof FetchError ? error.response : undefined
    if (!response) return { error: m.errors.connection, errorCode: null, retryable: true }
    if (response.status === 504) return { error: m.errors.timeout, errorCode: 'timeout', retryable: true }
    if (response.status === 429) return { error: m.errors.rate_limited, errorCode: 'rate_limited', retryable: true }
    return { error: m.errors.failed, errorCode: null, retryable: response.status >= 500 }
  }

  /** Un `409 request_unavailable` (de leer, guardar o verificar): la página retira esas peticiones. */
  function reportUnavailable(error: unknown, fallback: string): boolean {
    if (codeOf(error) !== 'request_unavailable') return false
    const ids = idsOf(error)
    void unavailable.trigger(ids.length > 0 ? ids : [fallback])
    return true
  }

  /** Sin crédito o sin configurar: ninguna de las que faltan se puede leer. Queda escribir a mano. */
  function halt(code: PrayerErrorCode) {
    halted.value = code
    const next = { ...entries.value }
    for (const entry of Object.values(next)) {
      if (entry.status !== 'waiting') continue
      next[entry.fileId] = entry.force
        ? { ...entry, status: entry.resume ?? 'draft', force: false, resume: undefined }
        : { ...entry, status: 'failed', ...describe({ data: { data: { code } } }) }
    }
    entries.value = next
  }

  async function read(entry: PrayerReviewEntry, mine: AbortController) {
    const id = entry.fileId
    patch(id, { status: 'reading', error: undefined, errorCode: null })
    const controller = new AbortController()
    const forward = () => controller.abort(new Closed())
    mine.signal.addEventListener('abort', forward, { once: true })
    const timer = setTimeout(() => controller.abort(new TimedOut()), PRAYER_TRANSCRIPT_TIMEOUT_MS)
    try {
      const request = api<PrayerTranscript>(`/api/peticiones/transcripciones/${id}/lectura`, {
        method: 'POST',
        body: { force: !!entry.force },
        signal: controller.signal,
      })
      // Cerrar el diálogo o vencer el plazo libera la fila aunque el transporte no respete la señal.
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      })
      request.catch(() => {})
      const transcript = await Promise.race([request, aborted])
      // Mientras el modelo leía, la persona pudo ponerse a escribirla a mano: su texto manda.
      if (session !== mine || entries.value[id]?.status !== 'reading') return
      const next = fromTranscript(transcript)
      put(next)
      announcement.value = next.status === 'empty' ? m.readEmpty(nameOf(id)) : m.readDone(nameOf(id))
    }
    catch (error) {
      // Cerrado: el estado se rehace al volver a abrir.
      if (session !== mine || entries.value[id]?.status !== 'reading') return
      const failure = controller.signal.reason instanceof TimedOut
        ? { error: m.errors.timeout, errorCode: 'timeout' as const, retryable: true }
        : describe(error)
      if (entry.force) {
        // «Volver a leer» falló: el texto guardado sigue ahí, la tarjeta vuelve a como estaba.
        patch(id, { status: entry.resume ?? 'draft', force: false, resume: undefined })
        toast.error(failure.error ?? m.rereadFailed)
      }
      else {
        patch(id, { status: 'failed', ...failure })
        announcement.value = m.readFailed(nameOf(id))
      }
      reportUnavailable(error, id)
      if (failure.errorCode && HALTING.includes(failure.errorCode)) halt(failure.errorCode)
    }
    finally {
      clearTimeout(timer)
      mine.signal.removeEventListener('abort', forward)
    }
  }

  /** Lee las que esperan, una a la vez y en el orden de las imágenes, hasta que no queden, se cierre o se detenga. */
  async function pump() {
    const mine = session
    if (!mine || pumping === mine) return
    pumping = mine
    try {
      while (session === mine && !mine.signal.aborted && !halted.value) {
        const next = requests.value.map(request => entries.value[request.id]).find(entry => entry?.status === 'waiting')
        if (!next) break
        await read(next, mine)
      }
    }
    finally {
      if (pumping === mine) pumping = null
    }
  }

  async function load(mine: AbortController) {
    const ids = requests.value.map(request => request.id)
    try {
      const stored = await api<PrayerTranscript[]>('/api/peticiones/transcripciones', { query: { ids: ids.join(',') }, signal: mine.signal })
      if (session !== mine) return
      const known = new Map(stored.map(transcript => [transcript.fileId, transcript]))
      // El servidor manda: lo guardado reemplaza lo que hubiera en memoria y lo demás se pone en fila para leerse.
      entries.value = Object.fromEntries(requests.value.map((request) => {
        const transcript = known.get(request.id)
        return [request.id, transcript ? fromTranscript(transcript) : { fileId: request.id, status: 'waiting', text: '' } satisfies PrayerReviewEntry]
      }))
      phase.value = 'ready'
      void pump()
    }
    catch {
      if (session === mine) phase.value = 'error'
    }
  }

  /** Abre la revisión de esas peticiones (ya en el orden de las imágenes): carga lo guardado y empieza a leer lo que falta. */
  function open(list: readonly PrayerRequest[]) {
    session?.abort(new Closed())
    const mine = session = new AbortController()
    requests.value = [...list]
    halted.value = null
    announcement.value = ''
    // Si ya se conoce el texto de todas (se reabrió el diálogo), se muestran mientras se refrescan.
    phase.value = list.length > 0 && list.every(request => entries.value[request.id]) ? 'ready' : 'loading'
    return load(mine)
  }

  /** Reintenta la carga de lo guardado (tras un error) o la refresca (otra persona pudo cambiar un texto). */
  function reload() {
    if (!session) return
    if (phase.value === 'error') phase.value = 'loading'
    return load(session)
  }

  /** La selección cambió con el diálogo abierto (una petición salió): se quitan sus tarjetas. */
  function sync(list: readonly PrayerRequest[]) {
    requests.value = [...list]
  }

  /** Cierra la revisión: deja de leer. Lo ya leído o guardado sigue en el servidor. */
  function close() {
    session?.abort(new Closed())
    session = null
    phase.value = 'idle'
  }

  /** «Guardar y verificar»: el texto corregido queda guardado y la petición, verificada. */
  async function save(id: string, text: string): Promise<{ ok: true } | { ok: false, message: string }> {
    patch(id, { saving: true })
    try {
      const transcript = await api<PrayerTranscript>(`/api/peticiones/transcripciones/${id}`, { method: 'PATCH', body: { text, verified: true } })
      put(fromTranscript(transcript))
      announcement.value = m.saved(nameOf(id))
      toast.success(m.saved(nameOf(id)))
      return { ok: true }
    }
    catch (error) {
      patch(id, { saving: false })
      reportUnavailable(error, id)
      return { ok: false, message: serverMessage(error, m.saveFailed) }
    }
  }

  /** La casilla «Verificada»: marca o desmarca el texto guardado, sin cambiarlo. */
  async function setVerified(id: string, verified: boolean): Promise<boolean> {
    const entry = entries.value[id]
    if (!entry || entry.saving || (verified && entry.text.trim() === '')) return false
    patch(id, { saving: true })
    try {
      const transcript = await api<PrayerTranscript>(`/api/peticiones/transcripciones/${id}`, { method: 'PATCH', body: { text: entry.text, verified } })
      put(fromTranscript(transcript))
      const notice = verified ? m.verified(nameOf(id)) : m.unverified(nameOf(id))
      announcement.value = notice
      toast.success(notice)
      return true
    }
    catch (error) {
      patch(id, { saving: false })
      reportUnavailable(error, id)
      toast.error(serverMessage(error, m.verifyFailed))
      return false
    }
  }

  /** Vuelve a poner en fila una lectura fallida. */
  function retry(id: string) {
    const entry = entries.value[id]
    if (entry?.status !== 'failed' || !entry.retryable) return
    patch(id, { status: 'waiting', error: undefined, errorCode: null })
    void pump()
  }

  /**
   * La persona escribe el texto en vez del modelo (lectura fallida, en espera o en curso). No cancela nada: la tarjeta deja
   * la fila y lo que lea el modelo después ya no la pisa. La fila se crea al guardar.
   */
  function writeByHand(id: string) {
    const entry = entries.value[id]
    if (!entry || !['waiting', 'reading', 'failed'].includes(entry.status)) return
    patch(id, { status: 'draft', text: '', error: undefined, errorCode: null, retryable: false, force: false, resume: undefined })
  }

  /** «Volver a leer» (ya confirmado): la foto vuelve a la fila y lo que lea el modelo reemplaza el texto guardado. */
  function reread(id: string) {
    const entry = entries.value[id]
    if (!entry || !['draft', 'verified', 'empty'].includes(entry.status)) return
    halted.value = null
    patch(id, { status: 'waiting', force: true, resume: entry.status })
    void pump()
  }

  const cards = computed<PrayerReviewCard[]>(() => requests.value.flatMap((request) => {
    const entry = entries.value[request.id]
    return entry ? [{ ...entry, request }] : []
  }))
  const verifiedCount = computed(() => cards.value.filter(card => card.status === 'verified').length)

  return {
    cards,
    phase,
    halted,
    announcement,
    verifiedCount,
    /** Peticiones que faltan por verificar. */
    pendingCount: computed(() => cards.value.length - verifiedCount.value),
    /** Todo cargado y cada petición verificada: se puede generar. */
    allVerified: computed(() => phase.value === 'ready' && cards.value.length > 0 && verifiedCount.value === cards.value.length),
    open,
    reload,
    sync,
    close,
    save,
    setVerified,
    retry,
    writeByHand,
    reread,
    onUnavailable: unavailable.on,
  }
}
