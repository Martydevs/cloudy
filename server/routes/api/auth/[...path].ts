// Proxy same-origin a Neon Auth (research R1) con límite de intentos en login y recuperación (FR-006).
import { handleAuthProxyRequest } from '@neondatabase/auth/server'

const RATE_LIMITED_PATHS = /^(sign-in\/|request-password-reset$|forget-password$)/
const SKIPPED_HEADERS = new Set(['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding'])

async function readEmail(request: Request): Promise<string> {
  try {
    const body = await request.clone().json() as { email?: unknown }
    return typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  }
  catch {
    return ''
  }
}

export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path') ?? ''
  const request = toWebRequest(event)

  if (request.method === 'POST' && RATE_LIMITED_PATHS.test(path)) {
    const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
    const email = await readEmail(request)
    await hitRateLimit(event, `auth:${hashSender(ip)}:${email}`, { limit: 5, windowSec: 900 })
  }

  const response = await handleAuthProxyRequest({ request, path, ...proxyConfig() })

  // Se copian los Set-Cookie uno por uno: unirlos con comas rompe los `Expires=…, …`.
  // `fetch` ya descomprimió el cuerpo, así que no se reenvían content-encoding ni content-length.
  setResponseStatus(event, response.status, response.statusText)
  for (const [name, value] of response.headers) {
    if (!SKIPPED_HEADERS.has(name.toLowerCase())) setResponseHeader(event, name, value)
  }
  for (const cookie of response.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', cookie)
  }
  return response.body ? new Uint8Array(await response.arrayBuffer()) : null
})
