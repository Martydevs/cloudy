// Reglas de gestión de usuarios: nunca puede quedar el sistema sin un administrador activo (FR-022).
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { profiles } from '../db/schema'

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

export const LAST_ADMIN_MESSAGE = 'Debe existir al menos un administrador activo'
