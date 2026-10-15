// Vista previa de un archivo de un envío: 302 a una URL firmada (el binario nunca pasa por la función).
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { guestSubmissionFiles } from '../../../../../db/schema'
import { presignGet } from '../../../../../utils/storage'

export default defineEventHandler(async (event) => {
  requireRole(event, 'editor')
  const submissionId = paramId(event)
  const fileId = paramId(event, 'fileId')
  const [file] = await useDb().select().from(guestSubmissionFiles).where(and(
    eq(guestSubmissionFiles.id, fileId),
    eq(guestSubmissionFiles.submissionId, submissionId),
    eq(guestSubmissionFiles.uploadStatus, 'ready'),
  )).limit(1)
  if (!file) throw createError({ statusCode: 404, statusMessage: 'No encontrado' })
  const url = await presignGet(file.storageKey)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=600')
  return sendRedirect(event, url, 302)
})
