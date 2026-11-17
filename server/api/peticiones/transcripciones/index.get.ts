// Transcripciones guardadas de las peticiones elegidas (revisión antes de generar): `?ids=<uuid>,<uuid>…` (1–40). Una sola
// consulta; los ids sin transcripción no aparecen. No llama al modelo.
import { setResponseHeader } from 'h3'
import type { PrayerTranscript } from '#shared/types/api'
import { prayerTranscriptIdsQuery } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<PrayerTranscript[]> => {
  requireRole(event, 'editor')
  const { ids } = queryValid(event, prayerTranscriptIdsQuery)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return listPrayerTranscripts(ids)
})
