// Cancela un trabajo (FR-009). 204 también si el servicio ya no lo conoce.
import { setResponseStatus } from 'h3'

export default defineEventHandler(async (event): Promise<null> => {
  requireRole(event, 'editor')
  const jobId = jobIdParam(event)
  await cancelJob(jobId, event)
  setResponseStatus(event, 204)
  return null
})
