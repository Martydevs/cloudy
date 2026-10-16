// Limpieza diaria (Vercel Cron, FR-020, FR-036, R8): papelera vencida, envíos caducados, subidas huérfanas y ventanas de rate limit.
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { SUBMISSION_TTL_DAYS, TRASH_RETENTION_DAYS, UPLOAD_ORPHAN_HOURS } from '#shared/constants/files'
import { files, guestSubmissionFiles, guestSubmissions, rateLimits } from '../../db/schema'
import { deleteMany } from '../../utils/storage'

const BATCH = 500

export interface CleanupReport {
  purgedTrash: number
  expiredSubmissions: number
  orphanUploads: number
  rateLimitRows: number
}

export default defineEventHandler(async (event): Promise<CleanupReport> => {
  requireCron(event)
  const db = useDb()
  const now = Date.now()
  const report: CleanupReport = { purgedTrash: 0, expiredSubmissions: 0, orphanUploads: 0, rateLimitRows: 0 }

  // 0. Raíces con más de 30 días en la papelera: filas y objetos, en lotes de 500.
  report.purgedTrash = await purgeAll(new Date(now - TRASH_RETENTION_DAYS * 86_400_000))

  // 1. Envíos pendientes de más de 7 días: se marcan `expired` y se borran sus objetos y archivos.
  const expiryLimit = new Date(now - SUBMISSION_TTL_DAYS * 86_400_000)
  for (;;) {
    const expired = await db.update(guestSubmissions)
      .set({ status: 'expired' })
      .where(sql`${guestSubmissions.id} IN (
        SELECT id FROM guest_submissions WHERE status = 'pending' AND created_at < ${expiryLimit.toISOString()}::timestamptz LIMIT ${BATCH}
      )`)
      .returning({ id: guestSubmissions.id })
    if (expired.length === 0) break
    const ids = expired.map(r => r.id)
    const objects = await db.select({ storageKey: guestSubmissionFiles.storageKey }).from(guestSubmissionFiles)
      .where(inArray(guestSubmissionFiles.submissionId, ids))
    await deleteMany(objects.map(o => o.storageKey))
    await db.delete(guestSubmissionFiles).where(inArray(guestSubmissionFiles.submissionId, ids))
    report.expiredSubmissions += ids.length
    if (expired.length < BATCH) break
  }

  // 2. Subidas del equipo que nunca se completaron (más de 24 h en `uploading`).
  const orphanLimit = new Date(now - UPLOAD_ORPHAN_HOURS * 3_600_000)
  for (;;) {
    const orphans = await db.select({ id: files.id, storageKey: files.storageKey }).from(files)
      .where(and(eq(files.uploadStatus, 'uploading'), lt(files.createdAt, orphanLimit)))
      .limit(BATCH)
    if (orphans.length === 0) break
    await deleteMany(orphans.flatMap(o => [o.storageKey, thumbKeyFor(o.id)]))
    await db.delete(files).where(inArray(files.id, orphans.map(o => o.id)))
    report.orphanUploads += orphans.length
    if (orphans.length < BATCH) break
  }

  // 3. Archivos de invitados en `uploading` de envíos con más de 24 h (la tabla no tiene created_at propio).
  for (;;) {
    const orphans = await db.select({ id: guestSubmissionFiles.id, storageKey: guestSubmissionFiles.storageKey })
      .from(guestSubmissionFiles)
      .innerJoin(guestSubmissions, eq(guestSubmissionFiles.submissionId, guestSubmissions.id))
      .where(and(eq(guestSubmissionFiles.uploadStatus, 'uploading'), lt(guestSubmissions.createdAt, orphanLimit)))
      .limit(BATCH)
    if (orphans.length === 0) break
    await deleteMany(orphans.map(o => o.storageKey))
    await db.delete(guestSubmissionFiles).where(inArray(guestSubmissionFiles.id, orphans.map(o => o.id)))
    report.orphanUploads += orphans.length
    if (orphans.length < BATCH) break
  }
  // Envíos pendientes que quedaron sin ningún archivo (el invitado nunca cerró la subida) se borran.
  await db.delete(guestSubmissions).where(and(
    eq(guestSubmissions.status, 'pending'),
    sql`${guestSubmissions.completedAt} IS NULL`,
    lt(guestSubmissions.createdAt, orphanLimit),
    sql`NOT EXISTS (SELECT 1 FROM guest_submission_files f WHERE f.submission_id = ${guestSubmissions.id})`,
  ))

  // 4. Ventanas de rate limit de más de un día.
  const rate = await db.delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now - 86_400_000)))
    .returning({ key: rateLimits.key })
  report.rateLimitRows = rate.length

  return report
})
