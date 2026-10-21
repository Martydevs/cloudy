// Lectura en la petición del texto de una imagen de un envío (feature 002, contracts/api): red de seguridad
// de la lectura en segundo plano al recibir y Reintentar. Mismas reglas que `POST /api/files/:id/text`.
import { createError } from 'h3'
import type { ImageText } from '#shared/types/api'
import { imageTextReadInput } from '#shared/validation/image-text'

export default defineEventHandler(async (event): Promise<ImageText> => {
  requireRole(event, 'editor')
  const submissionId = paramId(event)
  const fileId = paramId(event, 'fileId')
  const { force } = await readValid(event, imageTextReadInput)
  const { status } = await getSubmissionFile(submissionId, fileId)
  if (status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Este envío ya fue revisado' })
  }
  return requestImageTextRead({ table: 'guest_submission_files', id: fileId }, { force })
})
