// Entrada de la generación de imágenes de peticiones (feature 007, contracts/api.md § 4). Solo para la IA: el cuerpo HTTP
// usa `shared/validation/prayers`.
import { z } from 'zod'
import { PRAYER_PER_IMAGE } from '#shared/constants/prayers'
import { MAX_IMAGE_TEXT_LENGTH } from '#shared/constants/image-text'
import type { ProviderErrorCode } from '../errors'

/** 1–4 textos de 1–10 000 caracteres (el mismo tope que una transcripción) y la plantilla JPEG. */
export const prayerImageInputSchema = z.object({
  paragraphs: z.array(
    z.string().max(MAX_IMAGE_TEXT_LENGTH).refine(text => text.trim().length > 0, { message: 'Texto vacío' }),
  ).min(1).max(PRAYER_PER_IMAGE),
  template: z.custom<Uint8Array>(data => data instanceof Uint8Array && data.byteLength > 0, { message: 'Plantilla vacía' }),
})

/**
 * Por qué falló una imagen. `invalid_input` y `too_large` son propios de esta función; `ProviderErrorCode` no cambia para no
 * tocar el cortacircuito de la lectura de texto.
 */
export type PrayerImageErrorCode = ProviderErrorCode | 'invalid_input' | 'too_large'
