// Una generación (enmienda «Página de generación», 2026-11-15): sus grupos en orden y, para cada uno, la imagen guardada
// (o `null` si falta). `404 generation_not_found` si no existe.
import { setResponseHeader } from 'h3'
import type { PrayerGeneration } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<PrayerGeneration> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getPrayerGeneration(id)
})
