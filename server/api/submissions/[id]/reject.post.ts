// Rechazar un envío (FR-019): UPDATE condicional, borrado de objetos y de sus filas, y registro.
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { rejectInput } from '#shared/validation/submissions'
import { guestSubmissionFiles, guestSubmissions } from '../../../db/schema'
import { deleteMany } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { reason } = await readValid(event, rejectInput)
  const db = useDb()

  const [updated] = await db.update(guestSubmissions)
    .set({ status: 'rejected', reviewedBy: profile.userId, reviewedAt: new Date(), rejectionReason: reason || null })
    .where(and(eq(guestSubmissions.id, id), eq(guestSubmissions.status, 'pending')))
    .returning()
  if (!updated) {
    const [exists] = await db.select({ id: guestSubmissions.id }).from(guestSubmissions).where(eq(guestSubmissions.id, id)).limit(1)
    if (!exists) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El envío no existe' })
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Este envío ya fue revisado por otra persona' })
  }

  const guestFiles = await db.select({ id: guestSubmissionFiles.id, storageKey: guestSubmissionFiles.storageKey, textSourceKey: guestSubmissionFiles.textSourceKey })
    .from(guestSubmissionFiles)
    .where(eq(guestSubmissionFiles.submissionId, id))
  // También la copia JPEG de cada HEIC (feature 002), aunque la subida no se completara.
  await deleteMany(guestFiles.flatMap(f => [f.storageKey, f.textSourceKey ?? '', textSourceKeyFor(f.id)]))
  await db.batch([
    db.delete(guestSubmissionFiles).where(eq(guestSubmissionFiles.submissionId, id)),
    activityInsert(profile, 'submission.reject', { type: 'submission', id, label: updated.senderName }, { reason: reason || null }),
  ])

  setResponseStatus(event, 204)
  return null
})
