// Crear una colección de imágenes (feature 007, enmienda de historial). Con `imageId` nace con esa imagen en el mismo
// `db.batch`; si la imagen ya no existe, 404 y no se crea nada.
import { setResponseStatus } from 'h3'
import type { PrayerImageCollection } from '#shared/types/api'
import { prayerCollectionInput } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<PrayerImageCollection> => {
  const { profile } = requireRole(event, 'editor')
  const { name, imageId } = await readValid(event, prayerCollectionInput)
  const collection = await createPrayerCollection({ name, imageId, me: profile })
  setResponseStatus(event, 201)
  return collection
})
