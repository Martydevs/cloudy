// Única frontera con el servicio de descargas `cloudy-api` (feature 005, research D1, D6, D8). Solo este módulo lee
// `cloudyApiUrl`/`cloudyApiKey` y llama al servicio; los endpoints `/api/youtube/**` y `/api/songs/**` usan sus funciones.
// La clave nunca sale en una respuesta ni en un registro: los fallos se registran solo con llamada, estado HTTP y código.
//
// El servicio expone sus rutas sin versión bajo `/api` (`/api/videos/{id}`, `/api/jobs`, `/api/lyrics/pptx`…) y
// `/healthz` en la raíz. Tiene un solo motor de descargas (pytubefix): no hay respaldo que probar.
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
import type { YoutubeServiceFailure } from '#shared/constants/youtube'
import {
  isBlockReason,
  itemErrorMessage,
  YOUTUBE_SERVICE_FAILED,
  YOUTUBE_SERVICE_MESSAGES as MSG,
} from '#shared/constants/youtube'
import type { SongPresentationItemError } from '#shared/constants/songs'
import { SONG_FONT_COLOR, SONG_SERVICE_MESSAGES } from '#shared/constants/songs'
import { songError } from './songs'
import { readZipEntry, withoutZipEntry } from './zip'

/**
 * Plazo por llamada (research D8): `createJob` sondea cada video antes de encolar. `pptxBatch` genera hasta 3 canciones de
 * una en una y queda por debajo de los 120 s de la función en Vercel. Ese margen depende de que el servicio reparta con el
 * LLM bajo un solo plazo de 45 s para todo el lote (`LYRICS_BATCH_DEADLINE_SECONDS` en Render; después usa el reparto de
 * respaldo): arranque en frío (~50 s) + 45 s + 3 renders ≈ 100 s. Si ese plazo sube en Render, hay que revisar este presupuesto.
 */
export const CLOUDY_API_TIMEOUTS = { ping: 5_000, job: 10_000, probe: 20_000, create: 45_000, pptx: 90_000, pptxBatch: 110_000 } as const
/** Segundos que se sugieren al cliente cuando la cola del servicio está llena. */
export const QUEUE_RETRY_AFTER = 30

type Call = 'ping' | 'video' | 'job' | 'cancel' | 'create' | 'pptx' | 'pptxBatch'

interface ServiceDetail {
  code?: unknown
  message?: unknown
  videos?: unknown
}

export interface RejectedVideo { videoId: string, code: string, message: string }

/** Respuesta de error del servicio ya leída (el cuerpo de un `Response` solo se lee una vez). */
interface Failure {
  status: number
  code: string | null
  detail: ServiceDetail | null
}

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

async function failureOf(res: Response): Promise<Failure> {
  const detail = await readDetail(res)
  return { status: res.status, code: typeof detail?.code === 'string' ? detail.code : null, detail }
}

/** Para el registro: estado y código; nada más. */
const describeFailure = ({ status, code }: Pick<Failure, 'status' | 'code'>) => `→ ${status}${code ? ` (${code})` : ''}`

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

/**
 * El servicio respondió pero no pudo con el video (5xx con código: `bot_check`, `download_failed`, `quota_exceeded`…).
 * El error dice la causa para que la persona sepa qué pasó, en vez de «está despertando».
 */
function serviceFailed(code: string) {
  const cause: YoutubeServiceFailure = code === 'bot_check' ? 'botCheck' : 'failed'
  return createError({ statusCode: 502, statusMessage: 'Bad Gateway', message: MSG[cause], data: { code: YOUTUBE_SERVICE_FAILED, cause } })
}

/** Traduce una respuesta de error del servicio a un `createError` en español. Siempre lanza. */
function raise(failure: Failure, call: Call, event?: H3Event): never {
  const { status, code, detail } = failure
  console.warn(`[cloudy-api] ${call} ${describeFailure(failure)}`)

  // Presentaciones de Canciones (feature 006, research D9): errores con `data.code` y textos del servicio de presentaciones.
  if (call === 'pptx' || call === 'pptxBatch') {
    // Un tope `MAX_LYRICS_BATCH` en el servicio menor que el nuestro es un error de configuración, no del usuario.
    if (status === 422 && code === 'batch_too_large') throw songError('misconfigured', SONG_SERVICE_MESSAGES.misconfigured)
    if (status === 422 && (code === 'no_lyrics' || code === 'lyrics_too_long')) {
      throw songError(code, code === 'no_lyrics' ? SONG_SERVICE_MESSAGES.noLyrics : SONG_SERVICE_MESSAGES.tooLong, 422)
    }
    // Un 422 sin código es la lista de validación de FastAPI: la petición la armamos nosotros.
    if (status === 422) throw songError('invalid', SONG_SERVICE_MESSAGES.invalid)
    if (status === 401 || status === 403) throw songError('misconfigured', SONG_SERVICE_MESSAGES.misconfigured)
    throw songError('waking', SONG_SERVICE_MESSAGES.waking)
  }

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
  // El servicio no pudo con el video y dijo por qué: se dice la causa en vez de «está despertando».
  if (status >= 500 && code && (call === 'create' || call === 'video')) throw serviceFailed(code)
  // 502/503/504 (Render dormido o caído) y cualquier otro fallo del servicio: se ofrece reintentar.
  throw waking()
}

/** Lee la respuesta de error y lanza. */
async function fail(res: Response, call: Call, event?: H3Event): Promise<never> {
  return raise(await failureOf(res), call, event)
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  /** Tipo de respuesta que se acepta (`application/json` por defecto). */
  accept?: string
  body?: unknown
  timeoutMs: number
  /** El ping (`/healthz`) no usa la clave. */
  auth?: boolean
}

async function request(path: string, call: Call, { method = 'GET', body, timeoutMs, auth = true, accept = 'application/json' }: RequestOptions): Promise<Response> {
  const { base, key } = config()
  const headers: Record<string, string> = { accept }
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

/** Datos del video y si se puede descargar (`GET /api/videos/{id}`). */
export async function probeVideo(videoId: string): Promise<YoutubeVideoDetail> {
  const res = await request(`/api/videos/${encodeURIComponent(videoId)}`, 'video', { timeoutMs: CLOUDY_API_TIMEOUTS.probe })
  if (!res.ok) return fail(res, 'video')
  return toVideoDetail(await res.json() as Record<string, unknown>, videoId)
}

/** Crea un trabajo de hasta `YOUTUBE_MAX_BATCH` videos (`POST /api/jobs`). */
export async function createJob(
  videoIds: string[],
  format: YoutubeFormat,
  event?: H3Event,
): Promise<{ jobId: string, status: YoutubeJobStatus }> {
  const res = await request('/api/jobs', 'create', { method: 'POST', body: { video_ids: videoIds, format }, timeoutMs: CLOUDY_API_TIMEOUTS.create })
  if (!res.ok) return fail(res, 'create', event)
  const raw = await res.json() as Record<string, unknown>
  const jobId = str(raw.job_id)
  if (!jobId) throw waking()
  const status: YoutubeJobStatus = JOB_STATUSES.includes(raw.status as YoutubeJobStatus) ? raw.status as YoutubeJobStatus : 'queued'
  return { jobId, status }
}

/** Avance del trabajo; con `done` trae el enlace firmado nuevo (`GET /api/jobs/{id}`). 404 = expiró. */
export async function getJob(jobId: string, event?: H3Event): Promise<YoutubeJob> {
  const res = await request(`/api/jobs/${encodeURIComponent(jobId)}`, 'job', { timeoutMs: CLOUDY_API_TIMEOUTS.job })
  if (!res.ok) return fail(res, 'job', event)
  return toJob(await res.json() as Record<string, unknown>)
}

/** Cancela y olvida el trabajo (`DELETE /api/jobs/{id}`); si el servicio ya no lo conoce, el resultado buscado ya se cumple. */
export async function cancelJob(jobId: string, event?: H3Event): Promise<void> {
  const res = await request(`/api/jobs/${encodeURIComponent(jobId)}`, 'cancel', { method: 'DELETE', timeoutMs: CLOUDY_API_TIMEOUTS.job })
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

// ---------------------------------------------------------------- presentaciones de Canciones (feature 006)

export interface LyricsPptx {
  bytes: Uint8Array
  contentDisposition: string | null
  slideCount: number | null
  arrangedBy: 'llm' | 'fallback' | null
}

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/**
 * Genera el `.pptx` de una letra (`POST /api/lyrics/pptx`, research D9). La letra va siempre en blanco (`SONG_FONT_COLOR`,
 * D12). Los fallos salen como errores de Canciones con `data.code`: sin configurar, despertando, mal configurado, letra vacía
 * o demasiado larga y petición rechazada.
 */
export async function createLyricsPptx({ html, title }: { html: string, title: string }): Promise<LyricsPptx> {
  let res: Response
  try {
    res = await request('/api/lyrics/pptx', 'pptx', {
      method: 'POST',
      body: { html, title, font_color: SONG_FONT_COLOR },
      timeoutMs: CLOUDY_API_TIMEOUTS.pptx,
      accept: `${PPTX_TYPE}, application/json`,
    })
  }
  catch (error) {
    const state = (error as { data?: { state?: string } }).data?.state
    if (state === 'notConfigured') throw songError('not_configured', SONG_SERVICE_MESSAGES.notConfigured)
    throw songError('waking', SONG_SERVICE_MESSAGES.waking)
  }
  if (!res.ok) return fail(res, 'pptx')

  const slides = Number(res.headers.get('x-slide-count'))
  const arranged = res.headers.get('x-lyrics-arranged-by')
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await res.arrayBuffer())
  }
  catch (error) {
    console.warn(`[cloudy-api] pptx → body (${codeOf(error)})`)
    throw songError('waking', SONG_SERVICE_MESSAGES.waking)
  }
  return {
    bytes,
    contentDisposition: res.headers.get('content-disposition') || null,
    slideCount: res.headers.has('x-slide-count') && Number.isInteger(slides) && slides >= 0 ? slides : null,
    arrangedBy: arranged === 'llm' || arranged === 'fallback' ? arranged : null,
  }
}

// ---------------------------------------------------------------- lote de presentaciones (POST /api/lyrics/pptx/batch)

/** Resultado del servicio para la canción `index` del lote (el orden de `items` en la petición). */
export interface LyricsBatchItem {
  index: number
  status: 'done' | 'failed'
  filename: string | null
  slideCount: number | null
  arrangedBy: 'llm' | 'fallback' | null
  errorCode: SongPresentationItemError | null
}

/** `zip` es `null` cuando ninguna canción se pudo generar (422 `all_items_failed`); `items` dice por qué. */
export interface LyricsPptxBatch {
  zip: Uint8Array | null
  items: LyricsBatchItem[]
}

const MANIFEST = 'manifest.json'

function toBatchItem(raw: Record<string, unknown>): LyricsBatchItem | null {
  const index = num(raw.index)
  if (index === null || !Number.isInteger(index) || index < 0) return null
  const done = raw.status === 'done'
  const error = raw.error && typeof raw.error === 'object' ? str((raw.error as { code?: unknown }).code) : null
  const arranged = raw.arranged_by
  return {
    index,
    status: done ? 'done' : 'failed',
    filename: done ? str(raw.filename) : null,
    slideCount: done ? num(raw.slide_count) : null,
    arrangedBy: done && (arranged === 'llm' || arranged === 'fallback') ? arranged : null,
    // El texto del servicio (en inglés) nunca llega al usuario: solo el código, y uno desconocido es `invalid`.
    errorCode: done ? null : error === 'no_lyrics' || error === 'lyrics_too_long' ? error : 'invalid',
  }
}

function toBatchItems(value: unknown): LyricsBatchItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => toBatchItem((item ?? {}) as Record<string, unknown>) ?? [])
}

/** Un resultado por canción, con los índices `0..count-1` exactamente una vez: sin eso no se sabe cuál salió. */
function coversEveryInput(items: LyricsBatchItem[], count: number): boolean {
  const seen = new Set(items.map(item => item.index))
  return items.length === count && seen.size === count && items.every(item => item.index < count)
}

/** Una respuesta que no sigue el contrato es un despliegue desalineado, no un fallo pasajero: no se ofrece reintentar. */
function brokenBatch(what: string): never {
  console.warn(`[cloudy-api] pptxBatch → ${what}`)
  throw songError('misconfigured', SONG_SERVICE_MESSAGES.misconfigured)
}

/**
 * Genera hasta `SONG_PRESENTATION_BATCH_MAX` presentaciones en una sola llamada. El servicio las hace de una en una y
 * responde un `.zip` con un `.pptx` por canción lograda y un `manifest.json` con el resultado de cada una (éxito parcial).
 * El manifest se lee aquí y se quita del `.zip` que se devuelve: la persona recibe solo los `.pptx`. Letra siempre en
 * blanco (D12). Los fallos de todo el lote salen como errores de Canciones, igual que `createLyricsPptx`; una respuesta
 * que no sigue el contrato (sin zip, sin manifest, índices que no cuadran) es `misconfigured`.
 */
export async function createLyricsPptxBatch(inputs: readonly { html: string, title: string }[]): Promise<LyricsPptxBatch> {
  let res: Response
  try {
    res = await request('/api/lyrics/pptx/batch', 'pptxBatch', {
      method: 'POST',
      body: { items: inputs.map(({ html, title }) => ({ html, title, font_color: SONG_FONT_COLOR })) },
      timeoutMs: CLOUDY_API_TIMEOUTS.pptxBatch,
      accept: 'application/zip, application/json',
    })
  }
  catch (error) {
    const state = (error as { data?: { state?: string } }).data?.state
    if (state === 'notConfigured') throw songError('not_configured', SONG_SERVICE_MESSAGES.notConfigured)
    throw songError('waking', SONG_SERVICE_MESSAGES.waking)
  }

  if (res.status === 422) {
    // Ninguna canción se pudo generar: no es un fallo del lote sino de cada letra; el detalle trae cada una.
    const detail = await readDetail(res.clone())
    if (detail?.code === 'all_items_failed') {
      console.warn('[cloudy-api] pptxBatch → 422 (all_items_failed)')
      const items = toBatchItems((detail as { items?: unknown }).items)
      if (!coversEveryInput(items, inputs.length)) return brokenBatch('all_items_failed items')
      return { zip: null, items }
    }
  }
  if (!res.ok) return fail(res, 'pptxBatch')

  let zip: Uint8Array
  try {
    zip = new Uint8Array(await res.arrayBuffer())
  }
  catch (error) {
    // Un cuerpo que se corta a medio leer es un fallo de red: sí vale reintentar.
    console.warn(`[cloudy-api] pptxBatch → body (${codeOf(error)})`)
    throw songError('waking', SONG_SERVICE_MESSAGES.waking)
  }

  const manifest = readZipEntry(zip, MANIFEST)
  if (!manifest) return brokenBatch('manifest')
  let items: LyricsBatchItem[]
  try {
    items = toBatchItems((JSON.parse(new TextDecoder().decode(manifest)) as { items?: unknown }).items)
  }
  catch {
    return brokenBatch('manifest')
  }
  if (!coversEveryInput(items, inputs.length)) return brokenBatch('manifest items')
  const clean = withoutZipEntry(zip, MANIFEST)
  if (!clean) return brokenBatch('zip')
  return { zip: clean, items }
}
