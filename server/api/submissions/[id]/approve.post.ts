// Aprobar un envío hacia una carpeta (FR-019): un solo lote; si otra persona ganó la carrera, el
// UPDATE condicional no afecta filas y el INSERT dependiente no inserta nada.
import { and, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { FileItem } from '#shared/types/api'
import { approveInput } from '#shared/validation/submissions'
import { files, guestSubmissionFiles, guestSubmissions, profiles } from '../../../db/schema'

export default defineEventHandler(async (event): Promise<{ files: FileItem[] }> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { folderId } = await readValid(event, approveInput)
  if (folderId) await getVisibleFolder(folderId)
  const db = useDb()

  const [submission] = await db.select().from(guestSubmissions).where(eq(guestSubmissions.id, id)).limit(1)
  if (!submission) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El envío no existe' })
  if (submission.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Este envío ya fue revisado por otra persona' })
  }
  const guestFiles = await db.select().from(guestSubmissionFiles).where(and(
    eq(guestSubmissionFiles.submissionId, id),
    eq(guestSubmissionFiles.uploadStatus, 'ready'),
  ))
  if (guestFiles.length === 0) throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'El envío no tiene archivos válidos' })

  const reviewedAt = new Date()
  const created = await retryOnUniqueViolation(async () => {
    // Nombres sin choque dentro de la carpeta ni dentro del mismo lote.
    const taken = new Set<string>()
    const named = []
    for (const file of guestFiles) {
      const wanted = file.originalName
      const name = withSuffix(wanted, new Set([...await takenNames('file', folderId, wanted), ...taken]))
      taken.add(name)
      named.push({ ...file, name })
    }

    const values = sql.join(named.map(f => sql`(
      ${f.id}::uuid, ${f.name}, ${f.extension}, ${f.mimeType}, ${f.category}::file_category, ${f.sizeBytes}::bigint, ${f.storageKey}
    )`), sql`, `)

    const [updated, inserted] = await db.batch([
      db.update(guestSubmissions)
        .set({ status: 'approved', reviewedBy: profile.userId, reviewedAt, targetFolderId: folderId })
        .where(and(eq(guestSubmissions.id, id), eq(guestSubmissions.status, 'pending')))
        .returning({ id: guestSubmissions.id }),
      // Depende del UPDATE: solo inserta si este mismo revisor acaba de aprobar el envío.
      db.execute<{ id: string }>(sql`
        INSERT INTO files (id, folder_id, name, extension, mime_type, category, size_bytes, storage_key, upload_status, origin, guest_name, submission_id,
          text_status, text_content, text_error, text_attempts, text_started_at, text_read_at, text_source_key)
        SELECT v.id, ${folderId}::uuid, v.name, v.extension, v.mime_type, v.category, v.size_bytes, v.storage_key, 'ready', 'guest', gs.sender_name, gs.id,
          g.text_status, g.text_content, g.text_error, g.text_attempts, g.text_started_at, g.text_read_at, g.text_source_key
        FROM (VALUES ${values}) AS v(id, name, extension, mime_type, category, size_bytes, storage_key)
        JOIN guest_submissions gs ON gs.id = ${id}::uuid AND gs.status = 'approved'
          AND gs.reviewed_by = ${profile.userId} AND gs.reviewed_at = ${reviewedAt.toISOString()}::timestamptz
        -- El texto leído pasa al archivo sin volver a leerlo (feature 002, FR-010).
        JOIN guest_submission_files g ON g.id = v.id
        RETURNING id
      `),
    ])
    if (updated.length === 0) {
      throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Este envío ya fue revisado por otra persona' })
    }
    return inserted.rows.map(r => r.id)
  })

  await activityInsert(profile, 'submission.approve', { type: 'submission', id, label: submission.senderName }, { files: created.length, folderId })

  const rows = await db.select(fileColumns).from(files).leftJoin(profiles, eq(files.uploadedBy, profiles.userId))
    .where(eq(files.submissionId, id))
  return { files: rows.map(row => toFileItem(row)) }
})
