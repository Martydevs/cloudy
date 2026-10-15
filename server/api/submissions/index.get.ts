// Cola de envíos de invitados para el equipo (FR-017): pendientes por defecto.
import type { Submission, SubmissionStatus } from '#shared/types/api'
import { submissionsQuery } from '#shared/validation/submissions'

export default defineEventHandler(async (event): Promise<Submission[]> => {
  requireRole(event, 'editor')
  const { status = 'pending' } = queryValid(event, submissionsQuery)
  return listSubmissions(status as SubmissionStatus)
})
