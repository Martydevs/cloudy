// Reglas de la página Peticiones (feature 007, data-model.md § Constantes) que usan cliente y servidor: límites de la
// selección, de la generación y del historial, y textos en español por código de error de `POST /api/peticiones/imagenes`
// (contracts/api.md § 2).

/** Peticiones por imagen: la quinta abre la segunda imagen. */
export const PRAYER_PER_IMAGE = 4
/** Tope de peticiones elegidas por generación (hasta 10 imágenes). */
export const PRAYER_MAX_SELECTION = 40
/** Tarjetas por página del listado: cada una trae una foto sin miniatura (research D9). */
export const PRAYER_PAGE_SIZE = 12
/** Más caracteres que esto solo avisa «puede no caber»; no bloquea la selección. */
export const PRAYER_LONG_TEXT_CHARS = 600
/** Tope del texto que se escribe para una petición en el diálogo de generación. */
export const PRAYER_TEXT_MAX_LENGTH = 10_000
/** Imágenes que el navegador genera a la vez (research D8). */
export const PRAYER_IMAGE_CONCURRENCY = 2
/** Plazo de una generación desde el navegador, por encima del tope del servidor (105 s) y por debajo del de Vercel (120 s). */
export const PRAYER_IMAGE_TIMEOUT_MS = 110_000
/** Tope de la imagen que atraviesa la función (< 4,5 MB de respuesta en Vercel, research D12). */
export const PRAYER_IMAGE_MAX_BYTES = 4_000_000
/** Días que se conserva una imagen generada que no está en ninguna colección (limpieza diaria). */
export const PRAYER_IMAGE_RETENTION_DAYS = 30
/** Imágenes por página del historial: ninguna tiene miniatura. */
export const PRAYER_HISTORY_PAGE = 12
export const PRAYER_HISTORY_MAX_LIMIT = 48

/** Códigos de error de `POST /api/peticiones/imagenes` (`data.code`). */
export type PrayerErrorCode =
  | 'request_unavailable'
  | 'not_configured'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'provider'
  | 'invalid_output'
  | 'too_large'
  | 'timeout'
  | 'save_failed'

export const PRAYER_ERROR_CODES: readonly PrayerErrorCode[] = [
  'request_unavailable', 'not_configured', 'quota_exceeded', 'rate_limited', 'provider', 'invalid_output', 'too_large', 'timeout', 'save_failed',
]

export const PRAYER_ERROR_MESSAGES: Record<PrayerErrorCode, string> = {
  request_unavailable: 'Alguna petición ya no está disponible (se envió a la papelera). La quitamos de tu selección.',
  not_configured: 'La generación de imágenes no está configurada. Avisa a un administrador.',
  quota_exceeded: 'Se agotó el crédito del servicio de imágenes. Avisa a un administrador.',
  rate_limited: 'Generaste muchas imágenes seguidas. Espera un momento e inténtalo de nuevo.',
  provider: 'El servicio de imágenes no respondió bien. Inténtalo de nuevo en un momento.',
  invalid_output: 'El servicio no devolvió una imagen. Usa «Generar de nuevo».',
  too_large: 'La imagen salió demasiado pesada. Usa «Generar de nuevo».',
  timeout: 'La imagen tardó demasiado. Inténtalo de nuevo.',
  save_failed: 'La imagen se generó pero no se pudo guardar. Inténtalo de nuevo.',
}
