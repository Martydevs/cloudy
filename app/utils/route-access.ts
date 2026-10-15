// Matriz de acceso de contracts/ui-routes.md. La autoridad real está en el servidor.
import type { Role } from '#shared/permissions'
import type { Profile } from '#shared/types/api'

export type Access = 'public' | 'guest-only' | 'pending' | 'private'

declare module '#app' {
  interface PageMeta {
    access?: Access
    roles?: Role[]
  }
}

export type AccessDecision = { allow: true } | { redirect: string }

const DEFAULT_ROLES: Role[] = ['editor', 'admin']

export function isActiveProfile(profile: Pick<Profile, 'status' | 'role'> | null | undefined): boolean {
  return profile?.status === 'active' && !!profile.role
}

/**
 * Decide si se muestra la ruta o a dónde redirigir. Las páginas sin `access` se tratan
 * como `private` para editor y admin (opción segura por defecto).
 */
export function resolveAccess(
  meta: { access?: Access, roles?: Role[] },
  me: { profile: Pick<Profile, 'status' | 'role'> } | null,
  path: string,
): AccessDecision {
  const access = meta.access ?? 'private'
  const profile = me?.profile ?? null
  const active = isActiveProfile(profile)

  switch (access) {
    case 'public':
      return { allow: true }
    case 'guest-only':
      if (!profile) return { allow: true }
      return { redirect: active ? '/' : '/pendiente' }
    case 'pending':
      if (!profile) return { redirect: '/login' }
      return active ? { redirect: '/' } : { allow: true }
    case 'private': {
      if (!profile) return { redirect: `/login?redirect=${encodeURIComponent(path)}` }
      if (!active) return { redirect: '/pendiente' }
      const roles = meta.roles ?? DEFAULT_ROLES
      return roles.includes(profile.role!) ? { allow: true } : { redirect: '/acceso-denegado' }
    }
  }
}
