// Esquemas Zod del flujo de lectura (research A3). Solo para la IA: los cuerpos HTTP usan `shared/validation`.
import { z } from 'zod'
import { IMAGE_TEXT_EXTENSIONS, MAX_IMAGE_TEXT_BYTES, MAX_IMAGE_TEXT_LENGTH } from '#shared/constants/image-text'

/** El archivo antes de descargarlo: un fallo de formato o tamaño deja la imagen `unavailable`. */
export const imageSourceSchema = z.object({
  fileId: z.uuid(),
  extension: z.enum(IMAGE_TEXT_EXTENSIONS),
  sizeBytes: z.number().int().min(1).max(MAX_IMAGE_TEXT_BYTES),
})

/** Los bytes que van al modelo: el original JPEG/PNG o la copia JPEG de una HEIC. */
export const modelImageSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png']),
  data: z.custom<Uint8Array>(
    data => data instanceof Uint8Array && data.byteLength > 0 && data.byteLength <= MAX_IMAGE_TEXT_BYTES,
    { message: 'La imagen debe pesar entre 1 B y 5 MB' },
  ),
})

/** Respuesta estructurada del modelo; el `refine` y el `trim` solo se garantizan con una segunda pasada. */
export const imageTextOutputSchema = z.object({
  hasText: z.boolean(),
  text: z.string().trim().max(MAX_IMAGE_TEXT_LENGTH),
}).refine(
  output => (output.hasText ? output.text.length > 0 : output.text.length === 0),
  { message: 'text debe tener contenido solo si hasText es true' },
)

export type ImageSource = z.infer<typeof imageSourceSchema>
export type ModelImage = z.infer<typeof modelImageSchema>
export type ImageTextOutput = z.infer<typeof imageTextOutputSchema>
