// Historial de imágenes generadas (feature 007, enmienda de historial): página keyset de 12, la más reciente primero. Global
// del equipo, como el de Canciones.
import { setResponseHeader } from 'h3'
import type { Paginated, PrayerGeneratedImage } from '#shared/types/api'
import { prayerHistoryQuery } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<Paginated<PrayerGeneratedImage>> => {
  requireRole(event, 'editor')
  const query = queryValid(event, prayerHistoryQuery)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return listPrayerImages(query)
})
