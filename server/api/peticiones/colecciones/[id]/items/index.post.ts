// Guardar una imagen en una colección (feature 007, enmienda de historial): cualquier persona del equipo. Si ya estaba,
// `added: false` sin duplicarla; la colección sube al inicio solo si cambió.
import { prayerCollectionItemInput } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<{ added: boolean }> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { imageId } = await readValid(event, prayerCollectionItemInput)
  return addPrayerCollectionItem(id, imageId, profile.userId)
})
