// Entrada de la generación de imágenes de peticiones (feature 007, contracts/api.md § 4; revisión antes de generar: el
// modelo escribe el texto verificado, ya no lee las fotos). Solo para la IA: el cuerpo HTTP usa `shared/validation/prayers`.
import { z } from 'zod'
import { PRAYER_PER_IMAGE, PRAYER_TEXT_MAX_LENGTH } from '#shared/constants/prayers'
import type { ProviderErrorCode } from '../errors'

/** El texto verificado de una petición: con contenido y dentro del tope. */
const prayerTextSchema = z.string().max(PRAYER_TEXT_MAX_LENGTH).refine(text => text.trim() !== '', { message: 'Texto vacío' })

/** La plantilla: sus bytes JPEG o la URL firmada https de su copia en el bucket (el modelo la descarga de ahí). */
const templateSchema = z.custom<Uint8Array | URL>(
  data => (data instanceof Uint8Array && data.byteLength > 0) || (data instanceof URL && data.protocol === 'https:'),
  { message: 'Plantilla no válida' },
)

/** Tamaño que se pide al modelo (`image_config.image_size`): el estándar; más resolución solo hace la respuesta más pesada. */
export const PRAYER_IMAGE_SIZE = '1K'

/** 1–4 textos, en el orden de la imagen, la plantilla y, si se conoce, su relación de aspecto (`16:9`). */
export const prayerImageInputSchema = z.object({
  texts: z.array(prayerTextSchema).min(1).max(PRAYER_PER_IMAGE),
  template: templateSchema,
  aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).nullish(),
})

/**
 * Por qué falló una imagen. `invalid_input` y `too_large` son propios de esta función. `rejected`: OpenRouter rechazó la
 * clave o el preset (401, 403, 404, clave ilegible); reintentar no sirve, hace falta un administrador.
 */
export type PrayerImageErrorCode = ProviderErrorCode | 'invalid_input' | 'too_large' | 'rejected'
