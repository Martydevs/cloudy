// Desactivar, eliminar o cambiar el rol de varias cuentas a la vez (selección múltiple de Usuarios; FR-021, FR-022).
// Mismas reglas que `PATCH`/`DELETE /api/users/:id`: todo va en una transacción que abre `adminLock()` y aplica el
// `UPDATE` condicional de cada cuenta en el orden pedido, así el guard del último administrador ve los cambios
// anteriores del mismo lote. La cuenta que el guard frena se salta (no falla el resto) y se informa con su motivo.
// La actividad se registra después y solo para las cuentas que cambiaron.
import { inArray } from 'drizzle-orm'
import type { UsersBatchResult, UsersBatchSkip } from '#shared/types/api'
import { userBatchInput } from '#shared/validation/users'
import { profiles } from '../../db/schema'
import type { ProfileRow } from '../../utils/session'

type Input = { action: 'disable' | 'remove' | 'role', role?: 'admin' | 'editor' }

/** El cambio de una cuenta y su registro de actividad, o `null` si la acción no le aplica. */
function plan(target: ProfileRow, { action, role }: Input, me: ProfileRow) {
  const subject = { type: 'user', id: target.userId, label: target.name }
  if (action === 'remove') {
    return {
      update: removeProfileUpdate(target.userId),
      log: () => activityInsert(me, 'user.remove', subject, { email: target.email }),
    }
  }
  // Desactivar y cambiar el rol solo tienen sentido en cuentas activas (como en la fila de cada cuenta).
  if (target.status !== 'active') return null
  if (action === 'disable') {
    return {
      update: guardedProfileUpdate(target.userId, { status: 'disabled' }, { status: 'disabled' }),
      log: () => activityInsert(me, 'user.disable', subject),
    }
  }
  if (!role || role === target.role) return null
  return {
    update: guardedProfileUpdate(target.userId, { role }, { role }),
    log: () => activityInsert(me, 'user.role_change', subject, { from: target.role, to: role }),
  }
}

export default defineEventHandler(async (event): Promise<UsersBatchResult> => {
  const { profile: me } = requireRole(event, 'admin')
  const input = await readValid(event, userBatchInput)
  const ids = [...new Set(input.ids)]
  const db = useDb()

  // Una consulta para toda la selección (sin N+1).
  const rows = await db.select().from(profiles).where(inArray(profiles.userId, ids))
  const byId = new Map(rows.map(row => [row.userId, row]))

  const skipped = new Map<string, UsersBatchSkip['reason']>()
  const planned: { target: ProfileRow, update: ReturnType<typeof guardedProfileUpdate>, log: () => ReturnType<typeof activityInsert> }[] = []
  for (const id of ids) {
    const target = byId.get(id)
    if (!target || target.status === 'removed') {
      skipped.set(id, 'not_found')
      continue
    }
    const change = plan(target, input, me)
    if (change) planned.push({ target, ...change })
    else skipped.set(id, 'unchanged')
  }

  const updated = new Set<string>()
  if (planned.length > 0) {
    // `db.batch` pide una tupla; aquí la lista depende de la selección. El primer resultado es el del lock.
    const queries = [adminLock(), ...planned.map(item => item.update)]
    const [, ...results] = await db.batch(queries as unknown as Parameters<typeof db.batch>[0]) as unknown as [unknown, ...ProfileRow[][]]
    const logs: ReturnType<typeof activityInsert>[] = []
    planned.forEach(({ target, log }, index) => {
      if (results[index]?.[0]) {
        updated.add(target.userId)
        logs.push(log())
      }
      // 0 filas: lo frenó el guard del último administrador, o la cuenta cambió entre la consulta y el lote.
      else skipped.set(target.userId, target.role === 'admin' && target.status === 'active' ? 'last_admin' : 'not_found')
    })
    if (logs.length > 0) await db.batch(logs as unknown as Parameters<typeof db.batch>[0])
  }

  return {
    updated: ids.filter(id => updated.has(id)),
    skipped: ids.flatMap((id) => {
      const reason = skipped.get(id)
      return reason ? [{ id, reason }] : []
    }),
  }
})
