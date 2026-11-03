// Única frontera con el servicio de descargas `cloudy-api` (feature 005, research D1, D6, D8). Solo este módulo lee
// `cloudyApiUrl`/`cloudyApiKey` y llama al servicio; los endpoints `/api/youtube/**` usan sus funciones. La clave
// nunca sale en una respuesta ni en un registro: los fallos se registran solo con estado HTTP y código.
import type { H3Event } from 'h3'
import { createError, setResponseHeader } from 'h3'
import type {
  YoutubeFormat,
  YoutubeJob,
  YoutubeJobItem,
  YoutubeJobStatus,
  YoutubeServiceHealth,
  YoutubeVideoDetail,
} from '#shared/types/api'
import { isBlockReason, itemErrorMessage, YOUTUBE_SERVICE_MESSAGES as MSG } from '#shared/constants/youtube'

/** Plazo por llamada (research D8): `createJob` sondea cada video antes de encolar. */
export const CLOUDY_API_TIMEOUTS = { ping: 5_000, job: 10_000, probe: 20_000, create: 45_000 } as const
/** Segundos que se sugieren al cliente cuando la cola del servicio está llena. */
export const QUEUE_RETRY_AFTER = 30

type Call = 'ping' | 'video' | 'job' | 'cancel' | 'create'

interface ServiceDetail {
  code?: unknown
  message?: unknown
  videos?: unknown
}

export interface RejectedVideo { videoId: string, code: string, message: string }

// ---------------------------------------------------------------- errores (research D6)

function notConfigured() {
  return createError({ statusCode: 503, statusMessage: 'Service Unavailable', message: MSG.notConfigured, data: { state: 'notConfigured' } })
}

function waking() {
  return createError({ statusCode: 503, statusMessage: 'Service Unavailable', message: MSG.waking, data: { state: 'waking' } })
}

function config(): { base: string, key: string } {
  const { cloudyApiUrl, cloudyApiKey } = useRuntimeConfig()
  if (!cloudyApiUrl || !cloudyApiKey) throw notConfigured()
  return { base: String(cloudyApiUrl).replace(/\/+$/, ''), key: String(cloudyApiKey) }
}

/** Nombre breve del error de red para el registro (nunca la URL ni cabeceras). */
function codeOf(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name
  return typeof name === 'string' ? name : 'unknown'
}

/** `detail` de FastAPI: objeto `{ code, message, … }` o la lista de errores de validación. */
async function readDetail(res: Response): Promise<ServiceDetail | null> {
  try {
    const body = await res.json() as { detail?: unknown }
    return body?.detail && typeof body.detail === 'object' && !Array.isArray(body.detail) ? body.detail as ServiceDetail : null
  }
  catch {
    return null
  }
}

function rejectedVideos(value: unknown): RejectedVideo[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const { video_id: videoId, code } = (item ?? {}) as { video_id?: unknown, code?: unknown }
    if (typeof videoId !== 'string') return []
    const safeCode = typeof code === 'string' ? code : 'internal'
    // Nunca el `message` del servicio: está en inglés y puede llevar detalles internos.
    return [{ videoId, code: safeCode, message: itemErrorMessage(safeCode) }]
  })
}

/** Traduce una respuesta de error del servicio a un `createError` en español. Siempre lanza. */
async function fail(res: Response, call: Call, event?: H3Event): Promise<never> {
  const status = res.status
  const detail = await readDetail(res)
  const code = typeof detail?.code === 'string' ? detail.code : null
  console.warn(`[cloudy-api] ${call} → ${status}${code ? ` (${code})` : ''}`)

  if (status === 401 || status === 403) {
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', message: MSG.misconfigured })
  }
  if (status === 429) {
    if (event) setResponseHeader(event, 'Retry-After', QUEUE_RETRY_AFTER)
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests', message: MSG.busy, data: { retryAfter: QUEUE_RETRY_AFTER } })
  }
  if (call === 'job' && (status === 404 || status === 410)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: MSG.expired, data: { code: 'expired' } })
  }
  if (call === 'video' && (status === 404 || (status === 422 && code))) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: MSG.videoNotFound, data: { code: code ?? 'unavailable' } })
  }
  if (status === 422 && code === 'videos_rejected') {
    throw createError({ statusCode: 422, statusMessage: 'Unprocessable Entity', message: MSG.rejected, data: { videos: rejectedVideos(detail?.videos) } })
  }
  if (status === 422) {
    throw createError({ statusCode: 422, statusMessage: 'Unprocessable Entity', message: MSG.invalid })
  }
  if (status === 404) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: MSG.videoNotFound })
  }
  // 502/503/504 (Render dormido o caído) y cualquier otro fallo del servicio: se ofrece reintentar.
  throw waking()
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  timeoutMs: number
  /** El ping (`/healthz`) no usa la clave. */
  auth?: boolean
}

async function request(path: string, call: Call, { method = 'GET', body, timeoutMs, auth = true }: RequestOptions): Promise<Response> {
  const { base, key } = config()
  const headers: Record<string, string> = { accept: 'application/json' }
  if (auth) headers['X-API-Key'] = key
  if (body !== undefined) headers['content-type'] = 'application/json'
  try {
    return await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
  catch (error) {
    // Red caída, DNS o plazo vencido: el servicio gratuito suele estar despertando.
    console.warn(`[cloudy-api] ${call} → network (${codeOf(error)})`)
    throw waking()
  }
}

// ---------------------------------------------------------------- mapeo a los DTOs

const percent = (value: unknown) => Math.max(0, Math.min(100, Math.round((typeof value === 'number' ? value : 0) * 100)))
const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const https = (value: unknown) => (typeof value === 'string' && value.startsWith('https://') ? value : null)

const JOB_STATUSES: readonly YoutubeJobStatus[] = ['queued', 'running', 'zipping', 'done', 'failed', 'expired']
const ITEM_STATUSES: readonly YoutubeJobItem['status'][] = ['queued', 'running', 'done', 'failed']

function toVideoDetail(raw: Record<string, unknown>, videoId: string): YoutubeVideoDetail {
  const downloadable = raw.downloadable === true
  const heights = Array.isArray(raw.available_heights) ? raw.available_heights.filter((h): h is number => typeof h === 'number') : []
  return {
    videoId: str(raw.video_id) ?? videoId,
    title: str(raw.title) ?? videoId,
    channel: str(raw.channel),
    durationSeconds: num(raw.duration),
    thumbnailUrl: https(raw.thumbnail),
    availableHeights: [...new Set(heights)].sort((a, b) => a - b),
    downloadable,
    reason: downloadable ? null : isBlockReason(raw.reason) ? raw.reason : 'unavailable',
  }
}

function toJobItem(raw: Record<string, unknown>): YoutubeJobItem {
  const error = raw.error && typeof raw.error === 'object' ? raw.error as { code?: unknown } : null
  const code = error ? (str(error.code) ?? 'internal') : null
  return {
    videoId: str(raw.video_id) ?? '',
    title: str(raw.title),
    status: ITEM_STATUSES.includes(raw.status as YoutubeJobItem['status']) ? raw.status as YoutubeJobItem['status'] : 'queued',
    progress: percent(raw.progress),
    error: code ? { code, message: itemErrorMessage(code) } : null,
    actualHeight: num(raw.actual_height),
  }
}

function toJob(raw: Record<string, unknown>): YoutubeJob {
  const expires = num(raw.expires_at)
  return {
    jobId: str(raw.job_id) ?? '',
    status: JOB_STATUSES.includes(raw.status as YoutubeJobStatus) ? raw.status as YoutubeJobStatus : 'queued',
    format: raw.format as YoutubeFormat,
    progress: percent(raw.progress),
    items: Array.isArray(raw.items) ? raw.items.map(item => toJobItem((item ?? {}) as Record<string, unknown>)) : [],
    downloadUrl: str(raw.download_url),
    filename: str(raw.filename),
    sizeBytes: num(raw.size_bytes),
    expiresAt: expires === null ? null : new Date(expires * 1000).toISOString(),
  }
}

/** Trabajo recién creado, con un elemento en cola por video (contracts/api.md § POST /jobs). */
export function queuedJob(jobId: string, videoIds: string[], format: YoutubeFormat): YoutubeJob {
  return {
    jobId,
    status: 'queued',
    format,
    progress: 0,
    items: videoIds.map(videoId => ({ videoId, title: null, status: 'queued', progress: 0, error: null, actualHeight: null })),
    downloadUrl: null,
    filename: null,
    sizeBytes: null,
    expiresAt: null,
  }
}

// ---------------------------------------------------------------- llamadas

/** Datos del video y si se puede descargar (`GET /v1/videos/{id}`). */
export async function probeVideo(videoId: string): Promise<YoutubeVideoDetail> {
  const res = await request(`/v1/videos/${encodeURIComponent(videoId)}`, 'video', { timeoutMs: CLOUDY_API_TIMEOUTS.probe })
  if (!res.ok) return fail(res, 'video')
  return toVideoDetail(await res.json() as Record<string, unknown>, videoId)
}

/** Crea un trabajo de hasta `YOUTUBE_MAX_BATCH` videos (`POST /v1/jobs`). */
export async function createJob(videoIds: string[], format: YoutubeFormat, event?: H3Event): Promise<{ jobId: string, status: YoutubeJobStatus }> {
  const res = await request('/v1/jobs', 'create', { method: 'POST', body: { video_ids: videoIds, format }, timeoutMs: CLOUDY_API_TIMEOUTS.create })
  if (!res.ok) return fail(res, 'create', event)
  const raw = await res.json() as Record<string, unknown>
  const jobId = str(raw.job_id)
  if (!jobId) throw waking()
  return { jobId, status: JOB_STATUSES.includes(raw.status as YoutubeJobStatus) ? raw.status as YoutubeJobStatus : 'queued' }
}

/** Avance del trabajo; con `done` trae el enlace firmado nuevo (`GET /v1/jobs/{id}`). */
export async function getJob(jobId: string, event?: H3Event): Promise<YoutubeJob> {
  const res = await request(`/v1/jobs/${encodeURIComponent(jobId)}`, 'job', { timeoutMs: CLOUDY_API_TIMEOUTS.job })
  if (!res.ok) return fail(res, 'job', event)
  return toJob(await res.json() as Record<string, unknown>)
}

/** Cancela y olvida el trabajo; si el servicio ya no lo conoce, el resultado buscado ya se cumple. */
export async function cancelJob(jobId: string, event?: H3Event): Promise<void> {
  const res = await request(`/v1/jobs/${encodeURIComponent(jobId)}`, 'cancel', { method: 'DELETE', timeoutMs: CLOUDY_API_TIMEOUTS.job })
  if (res.ok || res.status === 404 || res.status === 410) return
  return fail(res, 'cancel', event)
}

/**
 * Despierta el servicio y dice cómo está (research D7): `up` si `/healthz` responde 200, `down` si responde 503
 * (dependencias faltantes), `waking` si no responde a tiempo o la plataforma aún no lo levanta.
 */
export async function pingService(): Promise<YoutubeServiceHealth> {
  let res: Response
  try {
    res = await request('/healthz', 'ping', { timeoutMs: CLOUDY_API_TIMEOUTS.ping, auth: false })
  }
  catch (error) {
    if ((error as { data?: { state?: string } }).data?.state === 'notConfigured') throw error
    return { state: 'waking' }
  }
  if (res.ok) return { state: 'up' }
  if (res.status === 503) {
    const body = await res.json().catch(() => null) as { status?: unknown } | null
    if (body?.status === 'degraded') return { state: 'down' }
  }
  return { state: 'waking' }
}
