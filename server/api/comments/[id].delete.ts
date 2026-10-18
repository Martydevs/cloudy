// Borrar un comentario: el autor o un admin. Si modera un admin, queda en la actividad (FR-039).
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { can } from '#shared/permissions'
import { comments } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const comment = await getComment(id)
  const isAuthor = comment.authorId === profile.userId
  if (!isAuthor && !can(profile.role, 'comments.moderate')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No tienes permiso para esta acción' })
  }

  const db = useDb()
  const remove = db.delete(comments).where(eq(comments.id, id))
  if (isAuthor) await remove
  else {
    await db.batch([
      remove,
      activityInsert(profile, 'comment.admin_delete', { type: 'file', id: comment.fileId, label: comment.fileName }, { author: comment.authorName }),
    ])
  }

  setResponseStatus(event, 204)
  return null
})
