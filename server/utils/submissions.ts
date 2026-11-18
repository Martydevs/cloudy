// Consultas y mapeos de los envíos de invitados (US3).
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { FileItem, Submission, SubmissionStatus } from '#shared/types/api'
import { submissionExpiresAt } from '#shared/retention'
import { files, guestSubmissionFiles, guestSubmissions, profiles } from '../db/schema'

export type SubmissionRow = typeof guestSubmissions.$inferSelect
export type SubmissionFileRow = typeof guestSubmissionFiles.$inferSelect

export function toSubmission(row: SubmissionRow, files: SubmissionFileRow[]): Submission {
  return {
    id: row.id,
    senderName: row.senderName,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: submissionExpiresAt(row.createdAt).toISOString(),
    files: files.map(f => ({
      id: f.id,
      name: f.originalName,
      category: f.category,
      size: Number(f.sizeBytes),
      previewUrl: `/api/submissions/${row.id}/files/${f.id}/content`,
    })),
  }
}

/** Envíos con un estado y sus archivos listos, en dos consultas (sin N+1). */
export async function listSubmissions(status: SubmissionStatus): Promise<Submission[]> {
  const db = useDb()
  const rows = await db.select().from(guestSubmissions)
    .where(eq(guestSubmissions.status, status))
    .orderBy(asc(guestSubmissions.createdAt))
    .limit(200)
  if (rows.length === 0) return []
  const files = await db.select().from(guestSubmissionFiles).where(and(
    inArray(guestSubmissionFiles.submissionId, rows.map(r => r.id)),
    eq(guestSubmissionFiles.uploadStatus, 'ready'),
  ))
  const bySubmission = new Map<string, SubmissionFileRow[]>()
  for (const file of files) {
    const list = bySubmission.get(file.submissionId) ?? []
    list.push(file)
    bySubmission.set(file.submissionId, list)
  }
  // Un envío pendiente sin archivos listos todavía no se muestra (sigue subiendo o quedó vacío).
  return rows
    .map(row => toSubmission(row, bySubmission.get(row.id) ?? []))
    .filter(s => s.status !== 'pending' || s.files.length > 0)
}

/** Archivo listo de un envío y el estado del envío, o 404 (texto de las imágenes, feature 002). */
export async function getSubmissionFile(submissionId: string, fileId: string): Promise<{ status: SubmissionStatus }> {
  const [row] = await useDb()
    .select({ status: guestSubmissions.status })
    .from(guestSubmissionFiles)
    .innerJoin(guestSubmissions, eq(guestSubmissions.id, guestSubmissionFiles.submissionId))
    .where(and(
      eq(guestSubmissionFiles.id, fileId),
      eq(guestSubmissionFiles.submissionId, submissionId),
      eq(guestSubmissionFiles.uploadStatus, 'ready'),
    ))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El envío o el archivo no existen' })
  return row
}

export interface ApproveOptions {
  /**
   * Alta manual de Peticiones: el envío y sus archivos ya verificados (siguen `uploading`). El mismo lote los marca `ready`
   * y cierra el envío (`completed_at`), así nunca existe como pendiente con archivos listos: ni Solicitudes ni el pulso lo ven.
   */
  manual?: { submission: SubmissionRow, files: SubmissionFileRow[] }
}

const alreadyReviewed = () => createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Este envío ya fue revisado por otra persona' })

/**
 * Aprueba un envío hacia una carpeta (FR-019; `null` = raíz) en un solo lote: si otra persona ganó la carrera, el UPDATE
 * condicional no afecta filas y el INSERT dependiente no inserta nada. Registra la actividad y devuelve los archivos creados.
 * Lo usan Solicitudes y el alta manual de Peticiones.
 */
export async function approveSubmission(
  id: string,
  profile: { userId: string, name: string },
  folderId: string | null,
  { manual }: ApproveOptions = {},
): Promise<FileItem[]> {
  const db = useDb()

  let submission = manual?.submission
  if (!submission) {
    [submission] = await db.select().from(guestSubmissions).where(eq(guestSubmissions.id, id)).limit(1)
    if (!submission) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El envío no existe' })
  }
  if (submission.status !== 'pending') throw alreadyReviewed()
  const guestFiles = manual?.files ?? await db.select().from(guestSubmissionFiles).where(and(
    eq(guestSubmissionFiles.submissionId, id),
    eq(guestSubmissionFiles.uploadStatus, 'ready'),
  ))
  if (guestFiles.length === 0) throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'El envío no tiene archivos válidos' })

  const senderName = submission.senderName
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

    const approve = db.update(guestSubmissions)
      // En el alta manual, `completed_at` con el reloj del servidor, igual que el cierre de un invitado.
      .set({ status: 'approved', reviewedBy: profile.userId, reviewedAt, targetFolderId: folderId, ...(manual ? { completedAt: reviewedAt } : {}) })
      .where(and(eq(guestSubmissions.id, id), eq(guestSubmissions.status, 'pending')))
      .returning({ id: guestSubmissions.id })
    // Depende del UPDATE: solo inserta si este mismo revisor acaba de aprobar el envío.
    const insert = db.execute<{ id: string }>(sql`
      INSERT INTO files (id, folder_id, name, extension, mime_type, category, size_bytes, storage_key, upload_status, origin, guest_name, submission_id,
        preview_key)
      SELECT v.id, ${folderId}::uuid, v.name, v.extension, v.mime_type, v.category, v.size_bytes, v.storage_key, 'ready', 'guest', gs.sender_name, gs.id,
        g.preview_key
      FROM (VALUES ${values}) AS v(id, name, extension, mime_type, category, size_bytes, storage_key)
      JOIN guest_submissions gs ON gs.id = ${id}::uuid AND gs.status = 'approved'
        AND gs.reviewed_by = ${profile.userId} AND gs.reviewed_at = ${reviewedAt.toISOString()}::timestamptz
      -- La copia de vista previa de una HEIC antigua (si la tiene) pasa al archivo: la muestra y la limpieza la borra con él.
      JOIN guest_submission_files g ON g.id = v.id
      RETURNING id
    `)
    const [updated, inserted] = manual
      ? await db.batch([
          approve,
          insert,
          db.update(guestSubmissionFiles).set({ uploadStatus: 'ready' }).where(inArray(guestSubmissionFiles.id, guestFiles.map(f => f.id))),
        ])
      : await db.batch([approve, insert])
    if (updated.length === 0) throw alreadyReviewed()
    return inserted.rows.map(r => r.id)
  })

  await activityInsert(
    profile,
    'submission.approve',
    { type: 'submission', id, label: senderName },
    { files: created.length, folderId, ...(manual ? { manual: true } : {}) },
  )

  const rows = await db.select(fileColumns).from(files).leftJoin(profiles, eq(files.uploadedBy, profiles.userId))
    .where(eq(files.submissionId, id))
  return rows.map(row => toFileItem(row))
}
