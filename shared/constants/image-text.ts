// Reglas de lectura del texto de imágenes compartidas por cliente y servidor (feature 002, data-model).

/** Estados guardados en la fila; `NULL` en la base de datos es "pendiente". */
export const IMAGE_TEXT_STATUSES = ['reading', 'ready', 'empty', 'failed', 'unavailable'] as const
export const IMAGE_TEXT_ERRORS = ['timeout', 'provider', 'rate_limited', 'quota_exceeded', 'invalid_input', 'invalid_output'] as const
export const IMAGE_TEXT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic'] as const

export type ImageTextExtension = (typeof IMAGE_TEXT_EXTENSIONS)[number]

/** 5 MB: se compara con el tamaño original del archivo (y con la copia JPEG de una HEIC). */
export const MAX_IMAGE_TEXT_BYTES = 5_242_880
export const MAX_IMAGE_TEXT_LENGTH = 10_000
/** Una lectura en `reading` más antigua que esto se da por vencida (FR-007). */
export const READING_STALE_MS = 90_000
/** Consulta del panel mientras dura `reading`. */
export const TEXT_POLL_INTERVAL_MS = 3000

/**
 * La parte del archivo de la elegibilidad: imagen JPG/JPEG/PNG/HEIC de hasta 5 MB. Para una HEIC el
 * servidor exige además su copia JPEG (`text_source_key`).
 */
export function isImageTextEligible({ category = 'image', extension, size }: { category?: string, extension: string, size: number }): boolean {
  return category === 'image'
    && (IMAGE_TEXT_EXTENSIONS as readonly string[]).includes(extension.toLowerCase())
    && size > 0
    && size <= MAX_IMAGE_TEXT_BYTES
}
