// Activar, desactivar, reactivar o cambiar el rol de un usuario (FR-021, FR-022).
import { and, eq } from 'drizzle-orm'
import type { Profile } from '#shared/types/api'
import { userPatchInput } from '#shared/validation/users'
import { profiles } from '../../db/schema'

export default defineEventHandler(async (event): Promise<Profile> => {
  const { profile: me } = requireRole(event, 'admin')
  const id = getRouterParam(event, 'id') ?? ''
  const input = await readValid(event, userPatchInput)
  const db = useDb()

  const [target] = await db.select().from(profiles).where(eq(profiles.userId, id)).limit(1)
  if (!target || target.status === 'removed') throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })

  const activating = input.status === 'active' && target.status !== 'active'
  if (activating && !input.role && !target.role) {
    throw createError({ statusCode: 422, statusMessage: 'Validation failed', data: { errors: { role: 'Elige un rol para activar la cuenta' } } })
  }

  const changes: Partial<typeof profiles.$inferInsert> = { updatedAt: new Date() }
  if (input.status) changes.status = input.status
  if (input.role) changes.role = input.role
  if (activating) changes.approvedBy = me.userId

  // El lock y el UPDATE condicional van en la misma transacción. El registro de actividad se hace
  // después y solo si el cambio se aplicó: así nunca se registra un cambio que el guard rechazó.
  const [, rows] = await db.batch([
    adminLock(),
    db.update(profiles)
      .set(changes)
      .where(and(eq(profiles.userId, id), lastAdminGuardSql(id, { status: input.status, role: input.role })))
      .returning(),
  ])
  const updated = rows[0]
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'Conflict', message: LAST_ADMIN_MESSAGE })

  const subject = { type: 'user', id, label: updated.name }
  if (activating) await activityInsert(me, 'user.activate', subject, { role: updated.role })
  else if (input.status === 'disabled' && target.status !== 'disabled') await activityInsert(me, 'user.disable', subject)
  if (input.role && input.role !== target.role && !activating) await activityInsert(me, 'user.role_change', subject, { from: target.role, to: input.role })

  return toProfile(updated)
})
