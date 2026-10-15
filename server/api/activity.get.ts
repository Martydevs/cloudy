// Registro de actividad para el administrador (FR-023): cursor por id descendente, 50 por página.
import { and, desc, eq, lt } from 'drizzle-orm'
import type { ActivityEntry, Paginated } from '#shared/types/api'
import { int, object, oneOf, optional, str } from '#shared/validation/core'
import { activityAction, activityLog } from '../db/schema'

const ACTIVITY_PAGE_SIZE = 50

const activityQuery = object({
  actor: optional(str({ max: 100 })),
  action: optional(oneOf(activityAction.enumValues)),
  cursor: optional(int({ min: 1, message: 'Cursor no válido' })),
})

export default defineEventHandler(async (event): Promise<Paginated<ActivityEntry>> => {
  requireRole(event, 'admin')
  const { actor, action, cursor } = queryValid(event, activityQuery)

  const rows = await useDb().select().from(activityLog)
    .where(and(
      actor ? eq(activityLog.actorId, actor) : undefined,
      action ? eq(activityLog.action, action) : undefined,
      cursor ? lt(activityLog.id, cursor) : undefined,
    ))
    .orderBy(desc(activityLog.id))
    .limit(ACTIVITY_PAGE_SIZE)

  const last = rows[rows.length - 1]
  return {
    items: rows.map(row => ({
      id: row.id,
      actorId: row.actorId,
      actorLabel: row.actorLabel,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: row.targetLabel,
      meta: row.meta,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length === ACTIVITY_PAGE_SIZE && last ? String(last.id) : null,
  }
})
