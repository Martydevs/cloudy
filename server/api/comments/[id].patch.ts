// Editar un comentario: solo su autor, ni siquiera el admin (FR-039). Marca `edited_at`.
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { Comment } from '#shared/types/api'
import { commentInput } from '#shared/validation/comments'
import { comments } from '../../db/schema'

export default defineEventHandler(async (event): Promise<Comment> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { body } = await readValid(event, commentInput)
  const comment = await getComment(id)
  if (comment.authorId !== profile.userId) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No tienes permiso para esta acción' })
  }
  if (comment.fileDeletedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'El archivo está en la papelera' })
  }

  const [row] = await useDb().update(comments)
    .set({ body, editedAt: new Date() })
    .where(eq(comments.id, id))
    .returning()
  return toComment({ ...row!, authorName: comment.authorName }, profile)
})
