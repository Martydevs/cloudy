// Estado en vivo del invitado (feature 003, FR-013): una lectura por índice único, sondeada cada 5 s.
// Sin limitador; nunca devuelve datos del equipo.
import type { GuestAccess } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<GuestAccess> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const tokenHash = readAccessTokenHash(event)
  return toGuestAccess(tokenHash ? await findAccessByTokenHash(tokenHash) : null, new Date())
})
