// Consultas y mapeos de los envíos de invitados (US3).
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Submission, SubmissionStatus } from '#shared/types/api'
import { submissionExpiresAt } from '#shared/retention'
import { guestSubmissionFiles, guestSubmissions } from '../db/schema'

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
