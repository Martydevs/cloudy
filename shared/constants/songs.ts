// Reglas de la página Canciones (feature 006, data-model.md § Constantes) que usan cliente y servidor: límites de la
// letra y de los nombres, tamaños de página y textos en español por código de error (contracts/ui.md § Textos).

/** Límite del servicio de presentaciones (`POST /api/lyrics/pptx`): más líneas no parece una canción. */
export const LYRICS_MAX_LINES = 300
/** Límite del servicio sobre el HTML que se le envía. */
export const LYRICS_MAX_CHARS = 500_000
/** Mismo valor que el CHECK `songs_title_length` y que el límite de `title` del servicio. */
export const SONG_TITLE_MAX = 200
export const SONG_ARTIST_MAX = 200
export const SONG_COLLECTION_NAME_MAX = 80
export const SONG_HISTORY_PAGE = 24
export const SONG_HISTORY_MAX_LIMIT = 48
export const SONG_RECENT_LIMIT = 12
/** Color de la letra en la presentación: blanco fijo (research D12). Es dato del archivo, no un color de interfaz. */
export const SONG_FONT_COLOR = 'FFFFFF'
/** Plazo de una generación desde el navegador (arranque en frío del servicio incluido). */
export const SONG_PRESENTATION_TIMEOUT_MS = 90_000
/** Canciones por petición de `POST /api/songs/presentations`: el mismo tope que `MAX_LYRICS_BATCH` de cloudy-api. */
export const SONG_PRESENTATION_BATCH_MAX = 3
/**
 * Plazo de un lote desde el navegador, por encima del servidor (cloudy-api con 110 s y Vercel cortando a los 120 s): así la
 * respuesta real del servidor (`503 waking` o el `504` de Vercel) llega antes y este plazo es solo la red de seguridad de
 * una conexión muerta.
 */
export const SONG_PRESENTATION_BATCH_TIMEOUT_MS = 125_000
/** Nombre del `.zip` de un lote. */
export const SONG_PRESENTATION_ZIP_NAME = 'canciones.zip'

/** Por qué una canción de un lote no tiene presentación (`SongPresentationBatchItem.errorCode`). */
export type SongPresentationItemError = 'not_found' | 'no_lyrics' | 'lyrics_too_long' | 'invalid'

export const SONG_PRESENTATION_ITEM_ERRORS: readonly SongPresentationItemError[] = ['not_found', 'no_lyrics', 'lyrics_too_long', 'invalid']

export const SONG_PRESENTATION_ITEM_MESSAGES: Record<SongPresentationItemError, string> = {
  not_found: 'Esa canción ya no existe.',
  no_lyrics: 'La letra guardada no tiene contenido. Vuelve a obtenerla.',
  lyrics_too_long: 'Eso no parece una canción: la letra pasa de 300 líneas.',
  invalid: 'El servicio de presentaciones no pudo leer esta letra.',
}

/** Códigos de error de `/api/songs/**` (`data.code`). */
export type SongErrorCode =
  | 'not_configured'
  | 'misconfigured'
  | 'quota'
  | 'busy'
  | 'crawl_failed'
  | 'no_lyrics'
  | 'lyrics_too_long'
  | 'waking'
  | 'invalid'

export const SONG_ERROR_CODES: readonly SongErrorCode[] = [
  'not_configured', 'misconfigured', 'quota', 'busy', 'crawl_failed', 'no_lyrics', 'lyrics_too_long', 'waking', 'invalid',
]

/** Motivos de rechazo de un enlace pegado (`parseLetrasUrl`, research D6). */
export type SongUrlReason = 'not_url' | 'not_https' | 'not_letras' | 'credentials' | 'not_song'

/** Texto del campo por motivo de rechazo del enlace. */
export const SONG_URL_MESSAGES: Record<SongUrlReason, string> = {
  not_url: 'Pega el enlace completo de la canción, por ejemplo https://www.letras.com/artista/cancion/',
  not_https: 'Pega un enlace que empiece con https://, por ejemplo https://www.letras.com/artista/cancion/',
  not_letras: 'Solo aceptamos enlaces de Letras.com (letras.com o www.letras.com).',
  credentials: 'Ese enlace no es válido. Cópialo de nuevo desde Letras.com.',
  not_song: 'Ese enlace no es de una canción. Abre la canción en Letras.com y copia su enlace.',
}

/** Respuestas del servidor al obtener la letra (rastreo con Apify, research D2). */
export const SONG_ERROR_MESSAGES: Record<SongErrorCode, string> = {
  not_configured: 'El rastreo de letras no está configurado. Avisa a un administrador.',
  misconfigured: 'El servicio de rastreo no está bien configurado. Avisa a un administrador.',
  quota: 'Se agotó el crédito del servicio de rastreo. Avisa a un administrador.',
  busy: 'El servicio de rastreo está ocupado. Intenta de nuevo en un momento.',
  crawl_failed: 'No pudimos leer la página de la canción. Intenta de nuevo en un momento.',
  no_lyrics: 'No encontramos una letra en ese enlace.',
  lyrics_too_long: 'Eso no parece una canción: la letra pasa de 300 líneas.',
  waking: 'El servicio de presentaciones está despertando o no responde. Reintenta en un momento.',
  invalid: 'El servicio de presentaciones no aceptó la petición. Inténtalo de nuevo.',
}

/** Respuestas del servidor al generar la presentación (servicio `cloudy-api`, research D9). */
export const SONG_SERVICE_MESSAGES = {
  notConfigured: 'El servicio de presentaciones no está configurado. Avisa a un administrador.',
  misconfigured: 'El servicio de presentaciones no está bien configurado. Avisa a un administrador.',
  waking: SONG_ERROR_MESSAGES.waking,
  invalid: SONG_ERROR_MESSAGES.invalid,
  noLyrics: 'La letra guardada no tiene contenido. Vuelve a obtenerla.',
  tooLong: SONG_ERROR_MESSAGES.lyrics_too_long,
  songNotFound: 'Esa canción ya no existe.',
  batchFailed: 'No se pudo generar ninguna de las presentaciones.',
} as const
