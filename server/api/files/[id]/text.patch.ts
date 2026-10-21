// Corrección manual del texto de una imagen (feature 002, FR-014, FR-018): queda "editado por" y se
// registra en la actividad solo con su longitud.
import type { ImageText } from '#shared/types/api'
import { imageTextEditInput } from '#shared/validation/image-text'

export default defineEventHandler(async (event): Promise<ImageText> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { text } = await readValid(event, imageTextEditInput)
  const file = await getVisibleImage(id)
  return saveImageTextEdit(file, text, profile)
})
