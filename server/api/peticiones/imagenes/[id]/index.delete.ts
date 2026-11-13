// Eliminar una imagen generada (feature 007, enmienda de historial): solo quien la generó o un administrador. Sale de sus
// colecciones (cascada) y se borra del bucket.
import { setResponseStatus } from 'h3'

export default defineEventHandler(async (event): Promise<null> => {
  const { profile } = requireRole(event, 'editor')
  await deletePrayerImage(paramId(event), profile)
  setResponseStatus(event, 204)
  return null
})
