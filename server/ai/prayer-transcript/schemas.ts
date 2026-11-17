// Entrada y salida de la lectura de la foto de una petición (revisión antes de generar). Solo para la IA: el cuerpo HTTP
// usa `shared/validation/prayers`.
import { z } from 'zod'
import type { ProviderErrorCode } from '../errors'

/** Formatos de foto que el modelo recibe; una HEIC sin copia JPEG no llega hasta aquí. */
export const PRAYER_PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

/** La foto de una petición: URL firmada de lectura (https) y su formato. */
export const prayerPhotoSchema = z.object({
  url: z.string().regex(/^https:\/\/\S+$/, { message: 'URL no válida' }),
  mediaType: z.enum(PRAYER_PHOTO_MEDIA_TYPES),
})

export type PrayerPhotoInput = z.infer<typeof prayerPhotoSchema>

/** Lo que responde el modelo: si la foto tiene texto legible y cuál es, tal cual está escrito. */
export const prayerTranscriptOutputSchema = z.object({
  hasText: z.boolean().describe('Falso si la foto no tiene texto legible'),
  text: z.string().describe('El texto de la foto, literal y con sus saltos de línea; vacío si no hay'),
})

/**
 * Por qué falló una lectura. `invalid_input` es propio de esta función. `rejected`: OpenRouter rechazó la clave o el
 * preset (401, 403, 404, clave ilegible); reintentar no sirve, hace falta un administrador.
 */
export type PrayerTranscriptErrorCode = ProviderErrorCode | 'invalid_input' | 'rejected'
