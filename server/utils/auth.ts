// Única frontera con Neon Auth: toolkit `@neondatabase/auth/server` (research R1).
import type { H3Event } from 'h3'
import { appendResponseHeader, getRequestHeader, getRequestURL } from 'h3'
import {
  handleAuthProxyRequest,
  NEON_AUTH_SESSION_COOKIE_NAME,
  resolveNeonAuthLogging,
  validateCookieConfig,
} from '@neondatabase/auth/server'

/** Configuración plana que comparten la resolución de sesión y el proxy `/api/auth/**`. */
export function proxyConfig() {
  const config = useRuntimeConfig()
  validateCookieConfig({ secret: config.neonAuthCookieSecret })
  return {
    baseUrl: config.neonAuthBaseUrl,
    cookieSecret: config.neonAuthCookieSecret,
    sameSite: 'lax' as const,
    log: resolveNeonAuthLogging({}),
  }
}

export interface SessionPayload {
  user?: { id: string, email: string, name?: string | null } | null
  session?: Record<string, unknown> | null
}

/**
 * Sesión de la petición actual por el mismo camino que el proxy de `get-session`: usa la caché
 * firmada de 5 min (`session_data`) y, cuando caduca, la vuelve a firmar y manda el `Set-Cookie`.
 * `createAuthServer().getSession()` no re-firma la caché al caducar: cada petición posterior iba a
 * Neon Auth, que termina respondiendo 429 y la sesión parecía cerrarse cada pocos minutos.
 */
export async function fetchSession(event: H3Event): Promise<SessionPayload | null> {
  const cookie = getRequestHeader(event, 'cookie') ?? ''
  if (!cookie.includes(NEON_AUTH_SESSION_COOKIE_NAME)) return null

  const userAgent = getRequestHeader(event, 'user-agent')
  const request = new Request(`${getRequestURL(event).origin}/api/auth/get-session`, {
    headers: { cookie, ...(userAgent ? { 'user-agent': userAgent } : {}) },
  })
  const response = await handleAuthProxyRequest({ request, path: 'get-session', ...proxyConfig() })
  for (const setCookie of response.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', setCookie)
  }
  if (!response.ok) return null
  return response.json().catch(() => null) as Promise<SessionPayload | null>
}
