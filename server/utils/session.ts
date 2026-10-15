// Sesión (Neon Auth) + perfil propio (roles y aprobación, research R2) y guards por endpoint.
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { eq, sql } from 'drizzle-orm'
import type { AuthUser, Profile } from '#shared/types/api'
import type { Role } from '#shared/permissions'
import { profiles } from '../db/schema'

export type ProfileRow = typeof profiles.$inferSelect

export interface AuthContext {
  user: AuthUser
  profile: ProfileRow
}

declare module 'h3' {
  interface H3EventContext {
    auth?: AuthContext | null
  }
}

export function toProfile(row: ProfileRow): Profile {
  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Usuario de la sesión de Neon Auth, o `null` si no hay sesión válida. */
export async function getAuthUser(_event: H3Event): Promise<AuthUser | null> {
  const { data } = await useAuthServer().getSession()
  const user = data?.user
  if (!user) return null
  return { id: user.id, email: user.email.toLowerCase(), name: user.name || user.email }
}

/**
 * Devuelve el perfil del usuario y lo crea si no existe. El primer perfil del sistema
 * queda `active/admin`; los demás `pending` sin rol (FR-002). Una sola sentencia decide.
 */
export async function ensureProfile(user: AuthUser): Promise<ProfileRow> {
  const db = useDb()
  const [existing] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1)
  if (existing) return existing

  const name = user.name.trim().slice(0, 80) || user.email
  const result = await db.execute<Record<string, unknown>>(sql`
    INSERT INTO profiles (user_id, email, name, role, status)
    SELECT ${user.id}, ${user.email}, ${name},
      CASE WHEN NOT EXISTS (SELECT 1 FROM profiles) THEN 'admin'::user_role ELSE NULL END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM profiles) THEN 'active'::user_status ELSE 'pending'::user_status END
    ON CONFLICT (user_id) DO UPDATE SET email = excluded.email
    RETURNING user_id
  `)
  const userId = String(result.rows[0]?.user_id ?? user.id)
  const [created] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1)
  if (!created) throw createError({ statusCode: 500, statusMessage: 'No se pudo crear el perfil' })
  return created
}

export function requireSession(event: H3Event): AuthContext {
  const auth = event.context.auth
  if (!auth) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Inicia sesión para continuar' })
  }
  return auth
}

export function requireActive(event: H3Event): AuthContext & { profile: ProfileRow & { role: Role } } {
  const auth = requireSession(event)
  const { status, role } = auth.profile
  if (status !== 'active' || !role) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Tu cuenta no está activa',
      data: { reason: status === 'active' ? 'pending' : status },
    })
  }
  return auth as AuthContext & { profile: ProfileRow & { role: Role } }
}

/** `editor` admite editor y admin; `admin` solo admin. */
export function requireRole(event: H3Event, role: Role) {
  const auth = requireActive(event)
  if (role === 'admin' && auth.profile.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No tienes permiso para esta acción' })
  }
  return auth
}
