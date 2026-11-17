// Leer la foto de una petición con el modelo (revisión antes de generar). Si ya hay una transcripción guardada la devuelve
// sin llamar al modelo; `{ force: true }` («Volver a leer») la reemplaza por un borrador nuevo. Sin límite propio de Cloudy:
// el crédito de OpenRouter es el único freno (decisión del equipo). `409 request_unavailable`, `422 unreadable_image`,
// `503 not_configured` / `quota_exceeded` y los fallos del proveedor llegan con `data.code`.
import { setResponseHeader } from 'h3'
import type { PrayerTranscript } from '#shared/types/api'
import { prayerTranscriptReadInput } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<PrayerTranscript> => {
  const { profile } = requireRole(event, 'editor')
  const fileId = paramId(event, 'fileId')
  const { force } = await readValid(event, prayerTranscriptReadInput)

  // Si la persona cierra el diálogo o la pestaña, se deja de esperar al proveedor.
  const controller = new AbortController()
  event.node.res.once('close', () => {
    if (!event.node.res.writableFinished) controller.abort()
  })

  const transcript = await readPrayerTranscript(fileId, { force, me: profile, abortSignal: controller.signal })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return transcript
})
