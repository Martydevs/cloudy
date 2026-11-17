// Capa de aplicación de las imágenes de peticiones (feature 007, contracts/api.md § 2; revisión antes de generar): comprueba
// en el servidor que las peticiones sigan disponibles y que una persona haya verificado su texto, carga esos textos y la
// plantilla, llama a la IA y traduce cada fallo a HTTP. Importa `#server/ai` solo para generar la imagen; el SQL vive en
// `prayer-requests.ts`, `prayer-transcripts.ts`, `prayer-gallery.ts` y `prayer-collections.ts`. Al proveedor solo viajan la
// plantilla y los textos verificados, nunca las fotos de los invitados, nombres, notas, IP ni ids, y el registro solo lleva
// códigos.
import { generatePrayerImage } from '#server/ai'
import type { PrayerImageErrorCode } from '#server/ai'
import type { PrayerErrorCode } from '#shared/constants/prayers'
import { prayerError } from './prayer-errors'
import { loadEligibleRequests } from './prayer-requests'
import { loadVerifiedTexts } from './prayer-transcripts'

/**
 * `invalid_input` es un fallo interno (el endpoint ya validó): al cliente le llega como `provider`. `rejected` (OpenRouter
 * rechazó la clave o el preset) es, para el equipo, lo mismo que no tener clave: `not_configured`, sin «Reintentar».
 */
function httpCode(error: PrayerImageErrorCode): PrayerErrorCode {
  if (error === 'invalid_input') return 'provider'
  if (error === 'rejected') return 'not_configured'
  return error
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

/**
 * Genera una imagen con 1–4 peticiones (ya validadas por el endpoint). El texto no llega del navegador: el servidor carga
 * el que una persona verificó para cada petición, justo antes de generar (un texto guardado de nuevo mientras la imagen
 * esperaba en la cola es el que se usa), comprueba que cada petición siga siendo una imagen aprobada y visible y fija el
 * orden. Sin texto verificado, `409 transcript_unverified` sin llamar al proveedor. Lanza errores HTTP con `data.code`.
 */
export async function createPrayerImage(fileIds: string[], { abortSignal }: { abortSignal?: AbortSignal } = {}): Promise<PrayerImage> {
  const [{ found, missing }, { texts, unverified }] = await Promise.all([loadEligibleRequests(fileIds), loadVerifiedTexts(fileIds)])
  if (missing.length > 0) throw prayerError('request_unavailable', { ids: missing })
  if (unverified.length > 0) {
    console.warn('[prayer-image] transcript_unverified')
    throw prayerError('transcript_unverified', { ids: unverified })
  }

  // Sin clave o sin plantilla no se llama a nadie.
  const template = useRuntimeConfig().openrouterApikey?.trim() ? await loadTemplate() : null
  if (!template) {
    console.error('[prayer-image] not_configured')
    throw prayerError('not_configured')
  }

  // El orden lo decide el servidor (aprobación, envío, id), no el navegador.
  const result = await generatePrayerImage({ texts: found.map(request => texts.get(request.id)!), template, abortSignal })
  if (result.status === 'failed') {
    const code = httpCode(result.error)
    // Saldo agotado o clave/preset rechazados piden acción de un administrador: se registran como error.
    const log = code === 'quota_exceeded' || code === 'not_configured' ? console.error : console.warn
    log(result.error === 'rejected'
      ? '[prayer-image] not_configured (OpenRouter rejected the key or preset)'
      : `[prayer-image] ${code}`)
    throw prayerError(code)
  }
  return { mediaType: result.mediaType, data: result.data, count: found.length }
}
