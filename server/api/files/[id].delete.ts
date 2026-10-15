// Enviar un archivo a la papelera (FR-034).
import { eq } from 'drizzle-orm'
import { files } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const file = await getVisibleFile(id)

  const db = useDb()
  await db.batch([
    db.update(files)
      .set({ deletedAt: new Date(), deletedBy: profile.userId, trashRootId: id })
      .where(eq(files.id, id)),
    activityInsert(profile, 'file.trash', { type: 'file', id, label: file.name }),
  ])

  setResponseStatus(event, 204)
  return null
})
