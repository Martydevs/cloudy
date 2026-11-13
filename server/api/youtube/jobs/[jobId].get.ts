// Avance de un trabajo y, al terminar, su enlace firmado nuevo (FR-008). 404 `expired` si el servicio ya lo olvidó.
import { setResponseHeader } from 'h3'
import type { YoutubeJob } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<YoutubeJob> => {
  requireRole(event, 'editor')
  const jobId = jobIdParam(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getJob(jobId, event)
})
