// Texto leído de las imágenes (feature 002): mismas reglas en el panel y en los endpoints.
import { MAX_IMAGE_TEXT_LENGTH } from '../constants/image-text'
import { bool, object, optional, str } from './core'

/** `POST …/text`: `force` relee aunque ya haya un resultado (Reintentar, Volver a leer). */
export const imageTextReadInput = object({ force: optional(bool()) })

/** `PATCH /api/files/:id/text`: corrección manual, 1–10 000 caracteres tras `trim`. */
export const imageTextEditInput = object({ text: str({ max: MAX_IMAGE_TEXT_LENGTH }) })
