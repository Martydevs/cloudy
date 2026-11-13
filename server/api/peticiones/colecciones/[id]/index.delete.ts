// Eliminar una colección de imágenes (feature 007, enmienda de historial): solo su autor o un administrador. Las imágenes
// siguen en el historial (y vuelven a vencer a los 30 días si no están en otra colección).
import { setResponseStatus } from 'h3'

export default defineEventHandler(async (event): Promise<null> => {
  const { profile } = requireRole(event, 'editor')
  await deletePrayerCollection(paramId(event), profile)
  setResponseStatus(event, 204)
  return null
})
