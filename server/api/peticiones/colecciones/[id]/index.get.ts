// Detalle de una colección de imágenes (feature 007, enmienda de historial): la colección y sus imágenes en un solo viaje.
import { setResponseHeader } from 'h3'
import type { PrayerImageCollectionDetail } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<PrayerImageCollectionDetail> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getPrayerCollectionDetail(id)
})
