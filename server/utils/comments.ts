// Consultas y mapeo de comentarios (US8). El nombre del autor llega en el mismo select (sin N+1).
import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { Comment } from '#shared/types/api'
import type { Role } from '#shared/permissions'
import { can } from '#shared/permissions'
import { comments, files, profiles } from '../db/schema'

export type CommentWithAuthor = typeof comments.$inferSelect & { authorName: string | null }

export const commentColumns = {
  ...getTableColumns(comments),
  authorName: profiles.name,
}

/** `canEdit` solo el autor; `canDelete` el autor o quien modera (admin, FR-039). */
export function toComment(row: CommentWithAuthor, me: { userId: string, role: Role | null }): Comment {
  const canEdit = row.authorId === me.userId
  return {
    id: row.id,
    body: row.body,
    author: { id: row.authorId, name: row.authorName ?? 'Usuario' },
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    canEdit,
    canDelete: canEdit || can(me.role, 'comments.moderate'),
  }
}

/** Archivo listo, esté o no en la papelera: quien llama decide entre 404 y 409. */
export function commentFileQuery(id: string) {
  return useDb()
    .select({ id: files.id, name: files.name, deletedAt: files.deletedAt })
    .from(files)
    .where(and(eq(files.id, id), eq(files.uploadStatus, 'ready')))
    .limit(1)
}

export async function findFileForComments(id: string) {
  const [file] = await commentFileQuery(id)
  if (!file) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El archivo no existe' })
  return file
}

/**
 * Comentarios del archivo en orden cronológico. `since` viene de `toISOString()` (milisegundos) y
 * Postgres guarda microsegundos: se compara truncado para no repetir el último en cada sondeo.
 */
export function listComments(fileId: string, since?: Date) {
  return useDb()
    .select(commentColumns)
    .from(comments)
    .leftJoin(profiles, eq(comments.authorId, profiles.userId))
    .where(and(
      eq(comments.fileId, fileId),
      since ? sql`date_trunc('milliseconds', ${comments.createdAt}) > ${since.toISOString()}::timestamptz` : undefined,
    ))
    .orderBy(asc(comments.createdAt), asc(comments.id))
}

/** Comentario con su autor y el archivo al que pertenece, o 404. */
export async function getComment(id: string) {
  const [row] = await useDb()
    .select({ ...commentColumns, fileName: files.name, fileDeletedAt: files.deletedAt })
    .from(comments)
    .innerJoin(files, eq(comments.fileId, files.id))
    .leftJoin(profiles, eq(comments.authorId, profiles.userId))
    .where(eq(comments.id, id))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El comentario ya no existe' })
  return row
}
