// Avance de un trabajo y, al terminar, su enlace firmado nuevo (FR-008). 404 `expired` si el servicio ya lo olvidó.
// `?engine=` es el motor que lo creó (`v2` si no se dice): el trabajo se consulta con su mismo prefijo.
import { setResponseHeader } from 'h3'
import type { YoutubeJob } from '#shared/types/api'
import { youtubeEngineQuery } from '#shared/validation/youtube'

export default defineEventHandler(async (event): Promise<YoutubeJob> => {
  requireRole(event, 'editor')
  const jobId = jobIdParam(event)
  const { engine } = queryValid(event, youtubeEngineQuery)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getJob(jobId, engine, event)
})
