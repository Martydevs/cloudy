// Registro de actividad (FR-023): se inserta en el mismo `db.batch` que la operación auditada.
import { activityAction, activityLog } from '../db/schema'

export type ActivityAction = (typeof activityAction.enumValues)[number]

export interface Actor {
  userId: string
  name: string
}

/** Devuelve la query de inserción sin ejecutarla, para incluirla en `db.batch([...])`. */
export function activityInsert(
  actor: Actor | null,
  action: ActivityAction,
  target: { type: string, id: string | null, label: string },
  meta?: Record<string, unknown>,
) {
  return useDb().insert(activityLog).values({
    actorId: actor?.userId ?? null,
    actorLabel: actor?.name ?? 'Sistema',
    action,
    targetType: target.type,
    targetId: target.id,
    targetLabel: target.label,
    meta: meta ?? null,
  })
}
