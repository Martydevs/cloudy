// Fila Colecciones de Peticiones (feature 007, enmienda de historial): todas las colecciones con su autor y conteo, en una
// sola sentencia.
import { setResponseHeader } from 'h3'
import type { PrayerImageCollection } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<{ items: PrayerImageCollection[] }> => {
  requireRole(event, 'editor')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { items: await listPrayerCollections() }
})
