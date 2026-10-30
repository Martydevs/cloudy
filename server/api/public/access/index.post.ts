// Pedir acceso (feature 003, FR-003/FR-004/FR-006): idempotente con una solicitud viva en la cookie; si no,
// límite por navegador y tope por red (research B2) y una solicitud nueva que caduca a los 8 min.
import { getRequestIP } from 'h3'
import type { H3Error } from 'h3'
import { ACCESS_NETWORK_LIMIT, ACCESS_REQUEST_LIMIT } from '#shared/constants/access'
import type { GuestAccess } from '#shared/types/api'
import { accessRequestInput } from '#shared/validation/access'

/** El 429 dice qué límite saltó para que la página explique si es el navegador o la red. */
const withScope = (scope: 'device' | 'network') => (error: H3Error) => {
  if (error.statusCode === 429) error.data = { ...(error.data as object), scope }
  throw error
}

export default defineEventHandler(async (event): Promise<GuestAccess> => {
  const { senderName } = await readValid(event, accessRequestInput)

  const tokenHash = readAccessTokenHash(event)
  if (tokenHash) {
    const current = toGuestAccess(await findAccessByTokenHash(tokenHash), new Date())
    // Pedir de nuevo con una solicitud viva no crea otra ni cuenta para el límite.
    if (current.state === 'waiting' || current.state === 'approved') return current
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  await hitRateLimit(event, `access:device:${ensureDeviceKey(event)}`, ACCESS_REQUEST_LIMIT).catch(withScope('device'))
  await hitRateLimit(event, `access:net:${hashSender(ip)}`, ACCESS_NETWORK_LIMIT).catch(withScope('network'))

  const access = await createAccessRequest(event, senderName)
  setResponseStatus(event, 201)
  return access
})
