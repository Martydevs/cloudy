// Entrada de la generación de imágenes de peticiones (feature 007, contracts/api.md § 4). Solo para la IA: el cuerpo HTTP
// usa `shared/validation/prayers`.
import { z } from 'zod'
import { PRAYER_PER_IMAGE, PRAYER_TEXT_MAX_LENGTH } from '#shared/constants/prayers'
import type { ProviderErrorCode } from '../errors'

/** 1–4 textos de 1–10 000 caracteres y la plantilla JPEG. */
export const prayerImageInputSchema = z.object({
  paragraphs: z.array(
    z.string().max(PRAYER_TEXT_MAX_LENGTH).refine(text => text.trim().length > 0, { message: 'Texto vacío' }),
  ).min(1).max(PRAYER_PER_IMAGE),
  template: z.custom<Uint8Array>(data => data instanceof Uint8Array && data.byteLength > 0, { message: 'Plantilla vacía' }),
})

/**
 * Por qué falló una imagen. `invalid_input` y `too_large` son propios de esta función.
 */
export type PrayerImageErrorCode = ProviderErrorCode | 'invalid_input' | 'too_large'
