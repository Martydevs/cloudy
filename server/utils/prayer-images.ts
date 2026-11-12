// Capa de aplicación de las imágenes de peticiones (feature 007, contracts/api.md § 2): relee las peticiones en el servidor
// (el navegador no manda texto), carga la plantilla, llama a la IA y traduce cada fallo a HTTP. Junto con `image-text.ts`,
// es el único importador de `#server/ai`; el SQL vive en `prayer-requests.ts`. Al proveedor solo viajan los textos y la
// plantilla (FR-022) y el registro solo lleva códigos.
import { createError } from 'h3'
import { generatePrayerImage } from '#server/ai'
import type { PrayerImageErrorCode } from '#server/ai'
import type { PrayerErrorCode } from '#shared/constants/prayers'
import { PRAYER_ERROR_MESSAGES } from '#shared/constants/prayers'
import { loadEligibleRequests } from './prayer-requests'

const STATUS: Record<PrayerErrorCode, [number, string]> = {
  request_unavailable: [409, 'Conflict'],
  not_configured: [503, 'Service Unavailable'],
  quota_exceeded: [503, 'Service Unavailable'],
  rate_limited: [429, 'Too Many Requests'],
  provider: [502, 'Bad Gateway'],
  invalid_output: [502, 'Bad Gateway'],
  too_large: [502, 'Bad Gateway'],
  timeout: [504, 'Gateway Timeout'],
}

/** Error de Peticiones con su código (`data.code`) y el texto en español. */
export function prayerError(code: PrayerErrorCode, data: Record<string, unknown> = {}) {
  const [statusCode, statusMessage] = STATUS[code]
  return createError({ statusCode, statusMessage, message: PRAYER_ERROR_MESSAGES[code], data: { code, ...data } })
}

/** `invalid_input` es un fallo interno (el endpoint ya validó): al cliente le llega como `provider`. */
function httpCode(error: PrayerImageErrorCode): PrayerErrorCode {
  return error === 'invalid_input' ? 'provider' : error
}

/** La plantilla empaquetada como server asset (`nitro.serverAssets`); `null` si falta o está vacía. */
async function loadTemplate(): Promise<Uint8Array | null> {
  const raw = await useStorage('assets:peticiones').getItemRaw<Uint8Array | ArrayBuffer>('plantilla.jpg').catch(() => null)
  if (!raw) return null
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  return bytes.byteLength > 0 ? bytes : null
}

export interface PrayerImage {
  mediaType: string
  data: Uint8Array
  /** Peticiones incluidas. */
  count: number
}

/** Genera una imagen con 1–4 peticiones (ya validadas por el endpoint). Lanza errores HTTP con `data.code`. */
export async function createPrayerImage(fileIds: string[], { abortSignal }: { abortSignal?: AbortSignal } = {}): Promise<PrayerImage> {
  const { found, missing } = await loadEligibleRequests(fileIds)
  if (missing.length > 0) throw prayerError('request_unavailable', { ids: missing })
  const paragraphs = found.map(request => (request.text.text ?? '').trim())

  // Sin clave o sin plantilla no se llama a nadie.
  const template = useRuntimeConfig().openrouterApikey?.trim() ? await loadTemplate() : null
  if (!template) {
    console.error('[prayer-image] not_configured')
    throw prayerError('not_configured')
  }

  const result = await generatePrayerImage({ paragraphs, template, abortSignal })
  if (result.status === 'failed') {
    const code = httpCode(result.error)
    // Saldo agotado pide acción de un administrador: se registra como error.
    const log = code === 'quota_exceeded' ? console.error : console.warn
    log(`[prayer-image] ${code}`)
    throw prayerError(code)
  }
  return { mediaType: result.mediaType, data: result.data, count: paragraphs.length }
}
