// Estado del texto de una imagen de un envío (feature 002, contracts/api): la tarjeta de Solicitudes lo
// consulta mientras dura `reading`. No exige que el envío siga pendiente.
import type { ImageText } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<ImageText> => {
  requireRole(event, 'editor')
  const submissionId = paramId(event)
  const fileId = paramId(event, 'fileId')
  await getSubmissionFile(submissionId, fileId)
  return getImageText({ table: 'guest_submission_files', id: fileId })
})
