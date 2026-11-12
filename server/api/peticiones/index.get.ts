// Peticiones de oración aprobadas (feature 007, contracts/api.md § 1): página keyset de 12 con búsqueda sin tildes,
// rango de fechas de aprobación y orden.
import { setResponseHeader } from 'h3'
import type { Paginated, PrayerRequest } from '#shared/types/api'
import { prayersQuery } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<Paginated<PrayerRequest>> => {
  requireRole(event, 'editor')
  const query = queryValid(event, prayersQuery)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return listPrayerRequests(query)
})
