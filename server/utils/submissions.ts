// Consultas y mapeos de los envíos de invitados (US3).
import { and, asc, eq, getTableColumns, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import type { Submission, SubmissionStatus } from '#shared/types/api'
import { submissionExpiresAt } from '#shared/retention'
import { guestSubmissionFiles, guestSubmissions, profiles } from '../db/schema'
import { toImageText } from './image-text'

export type SubmissionRow = typeof guestSubmissions.$inferSelect
export type SubmissionFileRow = typeof guestSubmissionFiles.$inferSelect

/** `grantedByName`: nombre de quien aprobó el acceso (feature 003), del `LEFT JOIN` del listado. */
export function toSubmission(row: SubmissionRow & { grantedByName?: string | null }, files: SubmissionFileRow[]): Submission {
  return {
    id: row.id,
    senderName: row.senderName,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: submissionExpiresAt(row.createdAt).toISOString(),
    origin: row.origin,
    // Si el perfil ya no existe (FK con ON DELETE SET NULL) queda `null` y la UI dice "una persona del equipo".
    accessGrantedBy: row.grantedByName ? { name: row.grantedByName } : null,
    files: files.map(f => ({
      id: f.id,
      name: f.originalName,
      category: f.category,
      size: Number(f.sizeBytes),
      previewUrl: `/api/submissions/${row.id}/files/${f.id}/content`,
      // El texto viaja en el mismo SELECT del listado (sin N+1, feature 002).
      text: f.category === 'image'
        ? toImageText({ ...f, sizeBytes: Number(f.sizeBytes), textEditedAt: null, editedByName: null })
        : null,
    })),
  }
}

/** Envíos con un estado y sus archivos listos, en dos consultas (sin N+1); quién dio acceso va en el mismo SELECT. */
export async function listSubmissions(status: SubmissionStatus): Promise<Submission[]> {
  const db = useDb()
  const rows = await db.select({ ...getTableColumns(guestSubmissions), grantedByName: profiles.name }).from(guestSubmissions)
    .leftJoin(profiles, eq(profiles.userId, guestSubmissions.accessGrantedBy))
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
