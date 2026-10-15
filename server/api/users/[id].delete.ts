// Eliminar un usuario (FR-021): el perfil queda `removed` y anonimizado; nunca el último admin activo.
import { and, eq, ne } from 'drizzle-orm'
import { profiles } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const { profile: me } = requireRole(event, 'admin')
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()

  const [target] = await db.select().from(profiles).where(eq(profiles.userId, id)).limit(1)
  if (!target || target.status === 'removed') throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })

  const [, rows] = await db.batch([
    adminLock(),
    db.update(profiles)
      .set({ status: 'removed', role: null, name: 'Usuario eliminado', updatedAt: new Date() })
      .where(and(eq(profiles.userId, id), ne(profiles.status, 'removed'), lastAdminGuardSql(id, { status: 'removed', role: null })))
      .returning(),
  ])
  if (!rows[0]) throw createError({ statusCode: 409, statusMessage: 'Conflict', message: LAST_ADMIN_MESSAGE })

  await activityInsert(me, 'user.remove', { type: 'user', id, label: target.name }, { email: target.email })
  setResponseStatus(event, 204)
  return null
})
