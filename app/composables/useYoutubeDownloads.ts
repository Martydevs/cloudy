// Descargas de YouTube del navegador (feature 005, research D2–D5). Los trabajos viven en el servicio: aquí se crean,
// se sondean cada 2,5 s y, al terminar, se intenta guardar el archivo. Una lista o selección de más de 10 videos se parte
// en lotes y se crea **un lote a la vez** (el siguiente nace cuando el anterior termina). El estado vive en `useState`
// (sobrevive a la navegación, no a la recarga) y lo muestra `YoutubeDownloadTray`, dueño del sondeo.
import { FetchError } from 'ofetch'
import type { YoutubeFormat, YoutubeJob } from '#shared/types/api'
import { chunkVideoIds, YOUTUBE_JOB_POLL_MS } from '#shared/constants/youtube'

export type DownloadStatus = 'creating' | 'queued' | 'running' | 'zipping' | 'done' | 'failed' | 'expired' | 'paused' | 'cancelled'

export interface DownloadRow {
  id: number
  groupId: number
  label: string
  format: YoutubeFormat
  videoIds: string[]
  /** 1-based. */
  batch: number
  total: number
  status: DownloadStatus
  job: YoutubeJob | null
  /** Por qué falló o está en pausa (ya en español). */
  message: string | null
  /** Videos que el servicio rechazó antes de crear el trabajo. */
  rejected: { videoId: string, message: string }[]
  saved: boolean
}

interface DownloadGroup {
  id: number
  key: string
  label: string
  format: YoutubeFormat
  batches: string[][]
  /** Índice del siguiente lote por crear. */
  next: number
}

interface DownloadsState {
  rows: DownloadRow[]
  groups: DownloadGroup[]
}

const ACTIVE: ReadonlySet<DownloadStatus> = new Set(['creating', 'queued', 'running', 'zipping'])
const POLLED: ReadonlySet<DownloadStatus> = new Set(['queued', 'running', 'zipping'])

export const isActiveDownload = (status: DownloadStatus) => ACTIVE.has(status)

let nextId = 0
let ticking = false

function statusOf(error: unknown): number {
  return error instanceof FetchError ? error.response?.status ?? 0 : 0
}

function isExpired(error: unknown): boolean {
  return statusOf(error) === 404 && (error as FetchError).data?.data?.code === 'expired'
}

/** Intenta guardar el archivo: el servicio lo entrega como `attachment`, así que la página no cambia. */
function saveFile(url: string, filename: string | null) {
  if (!import.meta.client) return
  const anchor = document.createElement('a')
  anchor.href = url
  if (filename) anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

export function useYoutubeDownloads() {
  const state = useState<DownloadsState>('youtube-downloads', () => ({ rows: [], groups: [] }))
  const api = useApi()
  const toast = useToast()
  const m = messages.youtube

  const rows = computed(() => state.value.rows)
  /** Hay algo que mostrar en la bandeja. */
  const active = computed(() => state.value.rows.length > 0)
  /** Algún trabajo se está creando o procesando: el sondeo corre solo entonces. */
  const busy = computed(() => state.value.rows.some(row => ACTIVE.has(row.status)))

  const findRow = (id: number) => state.value.rows.find(row => row.id === id)
  const findGroup = (id: number) => state.value.groups.find(group => group.id === id)
  function patch(id: number, changes: Partial<DownloadRow>) {
    const row = findRow(id)
    if (row) Object.assign(row, changes)
  }

  /** El grupo sigue vivo mientras le queden lotes por crear o alguno esté en curso o en pausa. */
  function groupBusy(group: DownloadGroup): boolean {
    if (group.next < group.batches.length) return true
    return state.value.rows.some(row => row.groupId === group.id && (ACTIVE.has(row.status) || row.status === 'paused'))
  }

  async function startNext(groupId: number) {
    const group = findGroup(groupId)
    if (!group || group.next >= group.batches.length) return
    const index = group.next++
    const row: DownloadRow = {
      id: ++nextId,
      groupId,
      label: group.label,
      format: group.format,
      videoIds: group.batches[index]!,
      batch: index + 1,
      total: group.batches.length,
      status: 'creating',
      job: null,
      message: null,
      rejected: [],
      saved: false,
    }
    state.value.rows.push(row)
    await create(row.id)
  }

  /** Crea (o recrea) el trabajo de un lote. Un 429/503 o la red caída lo dejan en pausa sin perder los IDs. */
  async function create(rowId: number) {
    const row = findRow(rowId)
    if (!row) return
    patch(rowId, { status: 'creating', message: null, rejected: [], job: null, saved: false })

    try {
      const job = await api<YoutubeJob>('/api/youtube/jobs', { method: 'POST', body: { videoIds: row.videoIds, format: row.format } })
      patch(rowId, { job, status: job.status })
    }
    catch (error) {
      const status = statusOf(error)
      if (status === 429 || status === 503 || status === 0) {
        patch(rowId, { status: 'paused', message: status === 429 ? m.service.busy : status === 503 ? m.service.waking : messages.common.connection })
        return
      }
      const videos = (error as FetchError).data?.data?.videos as { videoId: string, message: string }[] | undefined
      // El servicio no pudo con el video (502): se dice la causa. `serverMessage` solo toma el texto del servidor en un 4xx.
      const message = serverMessage(error, serviceFailureMessage(error) ?? m.downloads.startFailed)
      patch(rowId, {
        status: 'failed',
        message,
        rejected: Array.isArray(videos) ? videos.map(v => ({ videoId: v.videoId, message: v.message })) : [],
      })
      toast.error(row.total > 1 ? m.downloads.batchFailed(row.batch) : message)
      await startNext(row.groupId)
    }
  }

  /** Qué decir cuando un trabajo falla del todo: con un solo lote, la causa (si es una sola); con varios, qué lote fue. */
  function failureMessage(row: DownloadRow, job: YoutubeJob): string {
    if (row.total > 1) return m.downloads.batchFailed(row.batch)
    const causes = new Set(job.items.flatMap(item => (item.error ? [item.error.message] : [])))
    return causes.size === 1 ? [...causes][0]! : m.downloads.failed
  }

  /** Anota el lote en «Descargas». Si falla no pasa nada: el archivo ya se guardó. */
  async function recordDownload(row: DownloadRow) {
    try {
      await api('/api/youtube/downloads', { method: 'POST', body: { videoIds: row.videoIds, format: row.format } })
      await refreshDownloadHistory()
    }
    catch {
      // Solo se pierde la entrada del listado.
    }
  }

  /** El lote terminó: se intenta guardar el archivo y sigue el siguiente lote. */
  function finish(rowId: number) {
    const row = findRow(rowId)
    if (!row?.job) return
    if (row.job.downloadUrl) {
      saveFile(row.job.downloadUrl, row.job.filename)
      patch(rowId, { saved: true })
      void recordDownload(row)
    }
    toast.success(row.total > 1 ? `${m.downloads.ready} · ${m.downloads.batch(row.batch, row.total)}` : m.downloads.ready)
    void startNext(row.groupId)
  }

  /** Consulta un trabajo en curso y aplica su estado. */
  async function refresh(rowId: number) {
    const row = findRow(rowId)
    if (!row?.job) return
    const before = row.status
    try {
      const job = await api<YoutubeJob>(`/api/youtube/jobs/${row.job.jobId}`)
      patch(rowId, { job, status: job.status })
      if (job.status === 'done' && before !== 'done') {
        finish(rowId)
      }
      else if (job.status === 'failed' && before !== 'failed') {
        const message = failureMessage(row, job)
        patch(rowId, { message })
        toast.error(message)
        await startNext(row.groupId)
      }
    }
    catch (error) {
      if (!isExpired(error)) return // Un sondeo fallido se reintenta en el siguiente.
      patch(rowId, { status: 'expired', message: m.downloads.expired })
      if (ACTIVE.has(before)) await startNext(row.groupId)
    }
  }

  /** Un ciclo del sondeo: consulta cada trabajo en curso. */
  async function tick() {
    if (ticking) return
    ticking = true
    try {
      const pending = state.value.rows.filter(row => row.job && POLLED.has(row.status)).map(row => row.id)
      await Promise.all(pending.map(refresh))
    }
    finally {
      ticking = false
    }
  }

  /**
   * Encola la descarga de `videoIds` en `format`. Un doble clic (mismo gesto, mismos videos y formato mientras sigue en
   * curso) no crea otro trabajo (FR-031). Devuelve el número de archivos que se recibirán.
   */
  function enqueue(videoIds: readonly string[], format: YoutubeFormat, label: string): number {
    const ids = [...new Set(videoIds)]
    if (ids.length === 0) return 0
    const key = `${format}:${ids.join(',')}`
    const batches = chunkVideoIds(ids)
    if (state.value.groups.some(group => group.key === key && groupBusy(group))) return batches.length
    const group: DownloadGroup = { id: ++nextId, key, label, format, batches, next: 0 }
    state.value.groups.push(group)
    void startNext(group.id)
    return batches.length
  }

  /** Repite el guardado con un enlace firmado nuevo (el anterior dura ~10 min). */
  async function saveAgain(rowId: number) {
    const row = findRow(rowId)
    if (!row?.job) return
    try {
      const job = await api<YoutubeJob>(`/api/youtube/jobs/${row.job.jobId}`)
      patch(rowId, { job, status: job.status })
      if (job.downloadUrl) {
        saveFile(job.downloadUrl, job.filename)
        patch(rowId, { saved: true })
      }
    }
    catch (error) {
      if (isExpired(error)) patch(rowId, { status: 'expired', message: m.downloads.expired })
      else toast.error(serverMessage(error, m.downloads.startFailed))
    }
  }

  /** Cancela el lote en curso y los que faltaban de su grupo. */
  async function cancel(rowId: number) {
    const row = findRow(rowId)
    if (!row) return
    const group = findGroup(row.groupId)
    if (group) group.next = group.batches.length
    const job = row.job
    patch(rowId, { status: 'cancelled', message: null })
    if (job) await api(`/api/youtube/jobs/${job.jobId}`, { method: 'DELETE' }).catch(() => {})
    toast.info(m.downloads.cancelled)
  }

  /** Reintenta un lote en pausa o fallido, o prepara de nuevo uno que expiró. */
  async function retry(rowId: number) {
    const row = findRow(rowId)
    if (!row || ACTIVE.has(row.status)) return
    const group = findGroup(row.groupId)
    // Un lote que vuelve a empezar reabre su grupo para que sigan los lotes que faltaban.
    if (group && row.status === 'paused') group.next = Math.max(group.next, row.batch)
    await create(rowId)
  }

  /** Quita una fila de la bandeja (si estaba en curso, la cancela antes). */
  async function dismiss(rowId: number) {
    const row = findRow(rowId)
    if (!row) return
    if (ACTIVE.has(row.status)) await cancel(rowId)
    state.value.rows = state.value.rows.filter(r => r.id !== rowId)
    state.value.groups = state.value.groups.filter(group => groupBusy(group) || state.value.rows.some(r => r.groupId === group.id))
  }

  return {
    rows,
    active,
    busy,
    enqueue,
    tick,
    saveAgain,
    cancel,
    retry,
    dismiss,
    /** Cuántos archivos producirá una descarga de `count` videos. */
    filesFor: (count: number) => chunkVideoIds(Array.from({ length: count }, (_, i) => String(i))).length,
  }
}

/** Sondeo de las descargas cada 2,5 s mientras haya trabajos en curso; se pausa sin conexión. Lo arranca la bandeja. */
export function useYoutubeDownloadsPolling() {
  const { tick, busy } = useYoutubeDownloads()
  const online = useOnline()
  const { pause, resume } = useIntervalFn(tick, YOUTUBE_JOB_POLL_MS, { immediate: false })
  watch([busy, online], ([isBusy, isOnline]) => {
    if (isBusy && isOnline) resume()
    else pause()
  }, { immediate: true })
  return { pause, resume }
}
