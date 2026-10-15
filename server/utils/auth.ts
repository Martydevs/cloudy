// Única frontera con Neon Auth: adaptador h3 del toolkit `@neondatabase/auth/server` (research R1).
import type { H3Event } from 'h3'
import { appendResponseHeader, getRequestHeader, getRequestURL } from 'h3'
import type { NeonAuthServer, RequestContext } from '@neondatabase/auth/server'
import {
  createAuthServer,
  extractNeonAuthCookies,
  resolveNeonAuthLogging,
  serializeSetCookie,
  validateCookieConfig,
} from '@neondatabase/auth/server'

/** Puente entre el evento h3 en curso y el toolkit. Por defecto usa `useEvent()` (asyncContext). */
export function createH3RequestContext(event: H3Event = useEvent()): RequestContext {
  return {
    getCookies: () => extractNeonAuthCookies(getRequestHeader(event, 'cookie') ?? ''),
    setCookie: (name, value, options) => {
      appendResponseHeader(event, 'set-cookie', serializeSetCookie({ name, value, ...options }))
    },
    getHeader: name => getRequestHeader(event, name) ?? null,
    getOrigin: () => getRequestURL(event).origin,
    getFramework: () => 'nuxt',
  }
}

/** Configuración plana que comparten el servidor y el proxy `/api/auth/**`. */
export function proxyConfig() {
  const config = useRuntimeConfig()
  return {
    baseUrl: config.neonAuthBaseUrl,
    cookieSecret: config.neonAuthCookieSecret,
    sameSite: 'lax' as const,
    log: resolveNeonAuthLogging({}),
  }
}

let server: NeonAuthServer | undefined

export function useAuthServer(): NeonAuthServer {
  if (!server) {
    const { baseUrl, cookieSecret, sameSite, log } = proxyConfig()
    validateCookieConfig({ secret: cookieSecret })
    server = createAuthServer({
      baseUrl,
      cookieSecret,
      sameSite,
      log,
      context: () => createH3RequestContext(),
    })
  }
  return server
}
