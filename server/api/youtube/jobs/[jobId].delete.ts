// Cancela un trabajo (FR-009). 204 también si el servicio ya no lo conoce. `?engine=` es el motor que lo creó.
import { setResponseStatus } from 'h3'
import { youtubeEngineQuery } from '#shared/validation/youtube'

export default defineEventHandler(async (event): Promise<null> => {
  requireRole(event, 'editor')
  const jobId = jobIdParam(event)
  const { engine } = queryValid(event, youtubeEngineQuery)
  await cancelJob(jobId, engine, event)
  setResponseStatus(event, 204)
  return null
})
