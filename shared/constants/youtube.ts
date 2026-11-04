// Reglas de la página YouTube (feature 005) que usan cliente y servidor: formatos, tope de lote, patrón de ID y
// textos en español por código del servicio de descargas (research D6). Una sola fuente para ambos lados.

export type YoutubeFormat = 'mp4_720' | 'mp4_1080' | 'mp3'

/** Motivos de `downloadable: false` del servicio más los códigos de error de video de la sonda (research D10). */
export type YoutubeBlockReason =
  | 'too_long'
  | 'live'
  | 'unknown_duration'
  | 'private'
  | 'unavailable'
  | 'age_restricted'
  | 'members_only'
  | 'geo_restricted'

export interface YoutubeFormatInfo {
  value: YoutubeFormat
  label: string
  extension: 'mp4' | 'mp3'
  /** Altura máxima pedida (solo video). */
  height: number | null
}

export const YOUTUBE_FORMATS: readonly YoutubeFormatInfo[] = [
  { value: 'mp4_720', label: 'Video 720p', extension: 'mp4', height: 720 },
  { value: 'mp4_1080', label: 'Video 1080p', extension: 'mp4', height: 1080 },
  { value: 'mp3', label: 'Audio MP3', extension: 'mp3', height: null },
] as const

export const YOUTUBE_FORMAT_VALUES = YOUTUBE_FORMATS.map(f => f.value) as readonly YoutubeFormat[]

/** Formatos que se pueden guardar en el drive: audio o video (1080p casi nunca cabe en el tope de 100 MB). */
export const YOUTUBE_DRIVE_FORMATS = ['mp4_720', 'mp3'] as const satisfies readonly YoutubeFormat[]
export type YoutubeDriveFormat = (typeof YOUTUBE_DRIVE_FORMATS)[number]

export function youtubeFormatLabel(format: YoutubeFormat): string {
  return YOUTUBE_FORMATS.find(f => f.value === format)?.label ?? format
}

/**
 * Videos por trabajo del servicio (research D8). Si la función de Vercel no alcanza a crear un trabajo de 10 videos
 * dentro de su plazo, solo cambia este valor.
 */
export const YOUTUBE_MAX_BATCH = 10
/** Mismo patrón que el servicio (`VIDEO_ID_PATTERN`). */
export const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
/** ID de trabajo del servicio: `uuid4().hex`. */
export const YOUTUBE_JOB_ID_RE = /^[0-9a-f]{32}$/
export const YOUTUBE_PLAYLIST_NAME_MAX = 80
export const YOUTUBE_TITLE_MAX = 300
export const YOUTUBE_CHANNEL_MAX = 200
export const YOUTUBE_HISTORY_PAGE = 24
export const YOUTUBE_HISTORY_MAX_LIMIT = 48
export const YOUTUBE_RECENT_LIMIT = 12
/** Sondeo de un trabajo en curso (research D2). */
export const YOUTUBE_JOB_POLL_MS = 2500

/** «Guardar en el drive»: tope de cada petición a la API y tiempo sin avance tras el cual se aborta una descarga o subida. */
export const YOUTUBE_IMPORT_REQUEST_MS = 45_000
export const YOUTUBE_IMPORT_STALL_MS = 60_000
/** Reintento del ping mientras el servicio no responde (research D7). */
export const YOUTUBE_HEALTH_RETRY_MS = 5000

/** Respuestas en español del servidor ante fallos del servicio de descargas (research D6). */
export const YOUTUBE_SERVICE_MESSAGES = {
  notConfigured: 'El servicio de descargas no está configurado.',
  waking: 'El servicio de descargas está despertando o no responde. Reintenta en un momento.',
  misconfigured: 'El servicio de descargas no está bien configurado. Avisa a un administrador.',
  busy: 'El servicio está ocupado. Intenta de nuevo en un momento.',
  expired: 'Esta descarga expiró. Prepárala de nuevo.',
  videoNotFound: 'No encontramos ese video. Revisa el enlace.',
  rejected: 'Algunos videos no se pueden descargar. Quítalos e inténtalo de nuevo.',
  invalid: 'El servicio de descargas no aceptó la petición. Inténtalo de nuevo.',
} as const

/** Error de un video dentro de un trabajo o de la sonda: qué pasó y qué hacer. */
export const ITEM_ERROR_MESSAGES: Record<string, string> = {
  private: 'Este video es privado. Pide a su dueño que lo haga público o no listado.',
  unavailable: 'Este video ya no está disponible en YouTube. Revisa el enlace.',
  age_restricted: 'YouTube pide confirmar la edad para este video, así que no se puede descargar.',
  members_only: 'Este video es solo para miembros del canal y no se puede descargar.',
  geo_restricted: 'Este video no está disponible en la región del servicio de descargas.',
  live: 'Es una transmisión en vivo o un estreno. Inténtalo cuando haya terminado.',
  format_unavailable: 'Ese formato no está disponible para este video. Prueba con otro.',
  bot_check: 'YouTube bloqueó temporalmente la descarga. Inténtalo más tarde.',
  ffmpeg_missing: 'El servicio de descargas no está bien configurado. Avisa a un administrador.',
  download_failed: 'No pudimos descargar este video. Inténtalo de nuevo.',
  cancelled: 'Se canceló la descarga.',
  internal: 'Algo falló en el servicio de descargas. Inténtalo de nuevo.',
}

/** Por qué un video no se puede descargar (ficha y botón Descargar deshabilitado). */
export const BLOCK_REASON_MESSAGES: Record<YoutubeBlockReason, string> = {
  too_long: 'Este video dura más de 30 minutos. Solo se descargan videos de hasta 30 minutos.',
  live: 'Es una transmisión en vivo o un estreno. Inténtalo cuando haya terminado.',
  unknown_duration: 'No sabemos cuánto dura este video, así que no se puede descargar.',
  private: ITEM_ERROR_MESSAGES.private!,
  unavailable: ITEM_ERROR_MESSAGES.unavailable!,
  age_restricted: ITEM_ERROR_MESSAGES.age_restricted!,
  members_only: ITEM_ERROR_MESSAGES.members_only!,
  geo_restricted: ITEM_ERROR_MESSAGES.geo_restricted!,
}

export const BLOCK_REASONS = Object.keys(BLOCK_REASON_MESSAGES) as YoutubeBlockReason[]

export function isBlockReason(value: unknown): value is YoutubeBlockReason {
  return typeof value === 'string' && (BLOCK_REASONS as string[]).includes(value)
}

/** Texto en español de un código del servicio; desconocido → genérico. */
export function itemErrorMessage(code: string | null | undefined): string {
  if (code && isBlockReason(code)) return BLOCK_REASON_MESSAGES[code]
  return (code && ITEM_ERROR_MESSAGES[code]) || ITEM_ERROR_MESSAGES.internal!
}

/** Parte una lista de IDs en lotes de `size` sin perder ni repetir ninguno. */
export function chunkVideoIds(ids: readonly string[], size = YOUTUBE_MAX_BATCH): string[][] {
  const step = Math.max(1, Math.floor(size))
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += step) chunks.push(ids.slice(i, i + step))
  return chunks
}
