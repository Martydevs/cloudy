// Errores HTTP de Peticiones: cada código (`data.code`) con su estado y su texto en español. Lo comparten la generación de
// imágenes, las generaciones y la revisión de transcripciones, así que vive fuera de sus capas.
import { createError } from 'h3'
import type { PrayerErrorCode } from '#shared/constants/prayers'
import { PRAYER_ERROR_MESSAGES } from '#shared/constants/prayers'

const STATUS: Record<PrayerErrorCode, [number, string]> = {
  request_unavailable: [409, 'Conflict'],
  unreadable_image: [422, 'Unprocessable Entity'],
  not_configured: [503, 'Service Unavailable'],
  quota_exceeded: [503, 'Service Unavailable'],
  rate_limited: [429, 'Too Many Requests'],
  provider: [502, 'Bad Gateway'],
  invalid_output: [502, 'Bad Gateway'],
  too_large: [502, 'Bad Gateway'],
  timeout: [504, 'Gateway Timeout'],
  save_failed: [502, 'Bad Gateway'],
  generation_not_found: [404, 'Not Found'],
  generation_mismatch: [409, 'Conflict'],
  transcript_unverified: [409, 'Conflict'],
}

/** Error de Peticiones con su código (`data.code`) y el texto en español. */
export function prayerError(code: PrayerErrorCode, data: Record<string, unknown> = {}) {
  const [statusCode, statusMessage] = STATUS[code]
  return createError({ statusCode, statusMessage, message: PRAYER_ERROR_MESSAGES[code], data: { code, ...data } })
}
