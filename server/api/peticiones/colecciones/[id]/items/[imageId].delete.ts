// Quitar una imagen de una colección (feature 007, enmienda de historial): cualquier persona del equipo, idempotente. La
// imagen sigue en el historial.
import { setResponseStatus } from 'h3'

export default defineEventHandler(async (event): Promise<null> => {
  requireRole(event, 'editor')
  await removePrayerCollectionItem(paramId(event), paramId(event, 'imageId'))
  setResponseStatus(event, 204)
  return null
})
