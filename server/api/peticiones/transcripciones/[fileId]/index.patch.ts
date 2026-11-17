// Guardar el texto de una petición (revisión antes de generar): «Guardar», la casilla «Verificada» y «Escribir a mano».
// `verified` sella quién y cuándo la verificó; un texto en blanco no se puede verificar (422). `409 request_unavailable` si
// la petición ya no está disponible.
import { setResponseHeader } from 'h3'
import type { PrayerTranscript } from '#shared/types/api'
import { prayerTranscriptSaveInput } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<PrayerTranscript> => {
  const { profile } = requireRole(event, 'editor')
  const fileId = paramId(event, 'fileId')
  const input = await readValid(event, prayerTranscriptSaveInput)
  const transcript = await savePrayerTranscript(fileId, input, profile)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return transcript
})
