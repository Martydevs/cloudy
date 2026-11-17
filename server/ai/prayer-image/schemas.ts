// Entrada de la generación de imágenes de peticiones (feature 007, contracts/api.md § 4; revisión antes de generar: el
// modelo escribe el texto verificado, ya no lee las fotos). Solo para la IA: el cuerpo HTTP usa `shared/validation/prayers`.
import { z } from 'zod'
import { PRAYER_PER_IMAGE, PRAYER_TEXT_MAX_LENGTH } from '#shared/constants/prayers'
import type { ProviderErrorCode } from '../errors'

/** El texto verificado de una petición: con contenido y dentro del tope. */
const prayerTextSchema = z.string().max(PRAYER_TEXT_MAX_LENGTH).refine(text => text.trim() !== '', { message: 'Texto vacío' })

/** 1–4 textos, en el orden de la imagen, y la plantilla JPEG. */
export const prayerImageInputSchema = z.object({
  texts: z.array(prayerTextSchema).min(1).max(PRAYER_PER_IMAGE),
  template: z.custom<Uint8Array>(data => data instanceof Uint8Array && data.byteLength > 0, { message: 'Plantilla vacía' }),
})

/**
 * Por qué falló una imagen. `invalid_input` y `too_large` son propios de esta función. `rejected`: OpenRouter rechazó la
 * clave o el preset (401, 403, 404, clave ilegible); reintentar no sirve, hace falta un administrador.
 */
export type PrayerImageErrorCode = ProviderErrorCode | 'invalid_input' | 'too_large' | 'rejected'
