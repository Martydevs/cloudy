// Renombrar una colección de imágenes (feature 007, enmienda de historial): solo su autor o un administrador.
import type { PrayerImageCollection } from '#shared/types/api'
import { prayerCollectionRename } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<PrayerImageCollection> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { name } = await readValid(event, prayerCollectionRename)
  return renamePrayerCollection(id, name, profile)
})
