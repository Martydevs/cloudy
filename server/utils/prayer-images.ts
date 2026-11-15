// Capa de aplicación de las imágenes de peticiones (feature 007, contracts/api.md § 2; feature 008: el modelo lee las
// fotos): comprueba en el servidor que las peticiones sigan disponibles y se puedan leer, firma una URL de lectura corta por
// foto, carga la plantilla, llama a la IA y traduce cada fallo a HTTP. Único importador de `#server/ai`; el SQL vive en
// `prayer-requests.ts`, `prayer-gallery.ts` y `prayer-collections.ts`. Al proveedor solo viajan la plantilla y las fotos de
// los invitados, nunca nombres, notas, IP ni ids (FR-022), y el registro solo lleva códigos.
import { createError } from 'h3'
import { generatePrayerImage, PRAYER_PHOTO_MEDIA_TYPES } from '#server/ai'
import type { PrayerImageErrorCode, PrayerPhotoInput } from '#server/ai'
import type { PrayerErrorCode } from '#shared/constants/prayers'
import { PRAYER_ERROR_MESSAGES } from '#shared/constants/prayers'
import type { PrayerPhoto } from './prayer-requests'
import { loadEligibleRequests } from './prayer-requests'
import { presignGet } from './storage'

/** Vida de la URL firmada de cada foto: cubre una generación de 105 s con su reintento y la descarga de OpenRouter. */
const PHOTO_URL_TTL_SEC = 600

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

type PhotoSource = { key: string, mediaType: PrayerPhotoInput['mediaType'] }

const isReadable = (mime: string): mime is PrayerPhotoInput['mediaType'] =>
  (PRAYER_PHOTO_MEDIA_TYPES as readonly string[]).includes(mime)

/**
 * Qué objeto del bucket ve el modelo: la copia JPEG de una HEIC antigua si existe; si no, el original cuando es JPEG, PNG,
 * WebP o GIF. Las subidas nuevas ya llegan convertidas a JPEG desde el navegador; queda fuera la HEIC que no se pudo
 * convertir (más de 5 MB o falló la conversión): `null`.
 */
export function photoSource(photo: Pick<PrayerPhoto, 'storageKey' | 'previewKey' | 'mimeType'>): PhotoSource | null {
  if (photo.previewKey) return { key: photo.previewKey, mediaType: 'image/jpeg' }
  const mime = photo.mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : photo.mimeType.toLowerCase()
  return isReadable(mime) ? { key: photo.storageKey, mediaType: mime } : null
}

/**
 * Genera una imagen con 1–4 peticiones (ya validadas por el endpoint). El modelo lee el texto de cada foto; el servidor
 * comprueba que cada petición siga siendo una imagen aprobada, visible y legible, y fija el orden de las fotos. Lanza
 * errores HTTP con `data.code`.
 */
export async function createPrayerImage(fileIds: string[], { abortSignal }: { abortSignal?: AbortSignal } = {}): Promise<PrayerImage> {
  const { found, missing } = await loadEligibleRequests(fileIds)
  if (missing.length > 0) throw prayerError('request_unavailable', { ids: missing })
  // El orden lo decide el servidor (aprobación, envío, id), no el navegador.
  const sources = found.map(photo => ({ id: photo.id, source: photoSource(photo) }))
  const unreadable = sources.filter(entry => !entry.source).map(entry => entry.id)
  if (unreadable.length > 0) {
    console.warn('[prayer-image] unreadable_image')
    throw prayerError('unreadable_image', { ids: unreadable })
  }

  // Sin clave o sin plantilla no se llama a nadie.
  const template = useRuntimeConfig().openrouterApikey?.trim() ? await loadTemplate() : null
  if (!template) {
    console.error('[prayer-image] not_configured')
    throw prayerError('not_configured')
  }

  // URLs firmadas: OpenRouter descarga cada foto directo del bucket y sus bytes no pasan por esta función.
  const photos: PrayerPhotoInput[] = await Promise.all(sources.map(async ({ source }) => ({
    url: await presignGet(source!.key, {}, PHOTO_URL_TTL_SEC),
    mediaType: source!.mediaType,
  })))

  const result = await generatePrayerImage({ photos, template, abortSignal })
  if (result.status === 'failed') {
    const code = httpCode(result.error)
    // Saldo agotado pide acción de un administrador: se registra como error.
    const log = code === 'quota_exceeded' ? console.error : console.warn
    log(`[prayer-image] ${code}`)
    throw prayerError(code)
  }
  return { mediaType: result.mediaType, data: result.data, count: photos.length }
}
