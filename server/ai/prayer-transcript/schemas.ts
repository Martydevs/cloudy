// Entrada y salida de la lectura de la foto de una petición (revisión antes de generar). Solo para la IA: el cuerpo HTTP
// usa `shared/validation/prayers`.
import { jsonSchema } from 'ai'
import { z } from 'zod'
import { PRAYER_TEXT_MAX_LENGTH } from '#shared/constants/prayers'
import type { ProviderErrorCode } from '../errors'

/** Formatos de foto que el modelo recibe; una HEIC sin copia JPEG no llega hasta aquí. */
export const PRAYER_PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

/** La foto de una petición: URL firmada de lectura (https) y su formato. */
export const prayerPhotoSchema = z.object({
  url: z.string().regex(/^https:\/\/\S+$/, { message: 'URL no válida' }),
  mediaType: z.enum(PRAYER_PHOTO_MEDIA_TYPES),
})

export type PrayerPhotoInput = z.infer<typeof prayerPhotoSchema>

/**
 * Tope de tokens de la respuesta: el texto de una petición cabe en `PRAYER_TEXT_MAX_LENGTH` caracteres (unos 350–500
 * tokens en español) más el envoltorio JSON; el resto es margen por si el modelo del preset razona antes de responder.
 * Así una foto rara no puede gastar más de lo útil. Ajustable: si las lecturas salen cortadas (`invalid_output`), súbelo.
 */
export const PRAYER_TRANSCRIPT_MAX_OUTPUT_TOKENS = 1200

const HAS_TEXT_HINT = 'Falso si la foto no tiene texto legible'
const TEXT_HINT = `El texto de la foto, literal y con sus saltos de línea, de ${PRAYER_TEXT_MAX_LENGTH} caracteres como máximo; vacío si no hay`

/**
 * Lo que responde el modelo: si la foto tiene texto legible y cuál es, tal cual está escrito. El texto está acotado al
 * tope de una petición: una respuesta más larga no se recorta en silencio, se rechaza (`invalid_output`).
 */
export const prayerTranscriptOutputSchema = z.object({
  hasText: z.boolean().describe(HAS_TEXT_HINT),
  text: z.string().max(PRAYER_TEXT_MAX_LENGTH).describe(TEXT_HINT),
})

export type PrayerTranscriptOutput = z.infer<typeof prayerTranscriptOutputSchema>

/**
 * El esquema tal como viaja al modelo. El tope se valida aquí (`prayerTranscriptOutputSchema`) y se le dice al modelo en
 * la descripción, pero no va como `maxLength`: el proveedor pide la salida en modo estricto y varios modelos rechazan la
 * llamada entera si el JSON Schema trae palabras clave que no soportan.
 */
export const prayerTranscriptOutput = jsonSchema<PrayerTranscriptOutput>({
  type: 'object',
  properties: {
    hasText: { type: 'boolean', description: HAS_TEXT_HINT },
    text: { type: 'string', description: TEXT_HINT },
  },
  required: ['hasText', 'text'],
  additionalProperties: false,
}, {
  validate: (value) => {
    const parsed = prayerTranscriptOutputSchema.safeParse(value)
    return parsed.success ? { success: true, value: parsed.data } : { success: false, error: parsed.error }
  },
})

/**
 * Por qué falló una lectura. `invalid_input` es propio de esta función. `rejected`: OpenRouter rechazó la clave o el
 * preset (401, 403, 404, clave ilegible); reintentar no sirve, hace falta un administrador.
 */
export type PrayerTranscriptErrorCode = ProviderErrorCode | 'invalid_input' | 'rejected'
