// Entrada de la generación de imágenes de peticiones (feature 007, contracts/api.md § 4; feature 008: el modelo lee las
// fotos). Solo para la IA: el cuerpo HTTP usa `shared/validation/prayers`.
import { z } from 'zod'
import { PRAYER_PER_IMAGE } from '#shared/constants/prayers'
import type { ProviderErrorCode } from '../errors'

/** Formatos de foto que el modelo recibe; una HEIC sin copia JPEG no llega hasta aquí. */
export const PRAYER_PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

/** La foto de una petición: URL firmada de lectura (https) y su formato. */
export const prayerPhotoSchema = z.object({
  url: z.string().regex(/^https:\/\/\S+$/, { message: 'URL no válida' }),
  mediaType: z.enum(PRAYER_PHOTO_MEDIA_TYPES),
})

export type PrayerPhotoInput = z.infer<typeof prayerPhotoSchema>

/** 1–4 fotos, en el orden de la imagen, y la plantilla JPEG. */
export const prayerImageInputSchema = z.object({
  photos: z.array(prayerPhotoSchema).min(1).max(PRAYER_PER_IMAGE),
  template: z.custom<Uint8Array>(data => data instanceof Uint8Array && data.byteLength > 0, { message: 'Plantilla vacía' }),
})

/**
 * Por qué falló una imagen. `invalid_input` y `too_large` son propios de esta función.
 */
export type PrayerImageErrorCode = ProviderErrorCode | 'invalid_input' | 'too_large'
