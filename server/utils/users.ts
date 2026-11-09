// Reglas de gestión de usuarios: nunca puede quedar el sistema sin un administrador activo (FR-022).
import { and, eq, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { LAST_ADMIN_MESSAGE as SHARED_LAST_ADMIN_MESSAGE } from '#shared/constants/messages'
import { profiles } from '../db/schema'

/** 409 del guard del último administrador; el texto vive en `shared/` porque el cliente también lo muestra. */
export const LAST_ADMIN_MESSAGE = SHARED_LAST_ADMIN_MESSAGE

/** Clave fija del advisory lock que serializa los cambios de rol/estado entre administradores. */
export const ADMIN_LOCK_KEY = 7_311_001

/**
 * Se ejecuta primero dentro del `db.batch` (una sola transacción con neon-http): dos admins no
 * pueden quitarse el rol el uno al otro a la vez y dejar el sistema sin administradores.
 */
export function adminLock() {
  return useDb().execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_LOCK_KEY})`)
}

export interface NextState {
  status?: 'active' | 'disabled' | 'removed'
  role?: 'admin' | 'editor' | null
}

/**
 * Condición para el `UPDATE profiles … WHERE user_id = $target AND <guard>`: el cambio se rechaza
 * (0 filas) si el objetivo es un admin activo, el cambio lo deja sin serlo y es el único.
 */
export function lastAdminGuardSql(targetId: string, next: NextState): SQL {
  const leavesAdmin = (next.status !== undefined && next.status !== 'active') || (next.role !== undefined && next.role !== 'admin')
  if (!leavesAdmin) return sql`true`
  return sql`NOT (
    ${profiles.role} = 'admin' AND ${profiles.status} = 'active'
    AND (SELECT count(*) FROM profiles p WHERE p.role = 'admin' AND p.status = 'active' AND p.user_id <> ${targetId}) = 0
  )`
}

/**
 * `UPDATE` condicional de un perfil, para el `db.batch` que abre `adminLock()`: devuelve la fila si el cambio se aplicó
 * y ninguna si el guard del último administrador lo rechazó (o si `only` no se cumple). Lo usan el cambio de una
 * cuenta (`PATCH`/`DELETE /api/users/:id`) y el de varias (`POST /api/users/batch`): dentro del mismo lote, cada
 * `UPDATE` ve los cambios de los anteriores.
 */
export function guardedProfileUpdate(id: string, changes: Partial<typeof profiles.$inferInsert>, next: NextState, only?: SQL) {
  return useDb().update(profiles)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(profiles.userId, id), only, lastAdminGuardSql(id, next)))
    .returning()
}

/** Eliminar una cuenta (FR-021): el perfil queda `removed` y anonimizado; nunca el último admin activo. */
export function removeProfileUpdate(id: string) {
  return guardedProfileUpdate(
    id,
    { status: 'removed', role: null, name: 'Usuario eliminado' },
    { status: 'removed', role: null },
    ne(profiles.status, 'removed'),
  )
}
