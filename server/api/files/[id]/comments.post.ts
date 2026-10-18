// Publicar un comentario (US8). Un archivo en la papelera no admite comentarios (409).
import { createError } from 'h3'
import type { Comment } from '#shared/types/api'
import { commentInput } from '#shared/validation/comments'
import { comments } from '../../../db/schema'

export default defineEventHandler(async (event): Promise<Comment> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { body } = await readValid(event, commentInput)
  const file = await findFileForComments(id)
  if (file.deletedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'El archivo está en la papelera' })
  }

  const [row] = await useDb().insert(comments).values({ fileId: id, authorId: profile.userId, body }).returning()
  setResponseStatus(event, 201)
  return toComment({ ...row!, authorName: profile.name }, profile)
})
