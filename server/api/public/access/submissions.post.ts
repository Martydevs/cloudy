// Crear el envío con permiso (feature 003, FR-014–FR-017, research B4): solo el navegador de la solicitud
// aprobada y vigente; sin el límite por IP del envío abierto, con un tope de creaciones por solicitud (B2).
import { ACCESS_SUBMIT_LIMIT } from '#shared/constants/access'
import { permittedSubmissionInput } from '#shared/validation/access'
import type { GuestSubmissionTicket } from '../../../utils/guest-submissions'

export default defineEventHandler(async (event): Promise<GuestSubmissionTicket> => {
  const input = await readGuestSubmission(event, permittedSubmissionInput)
  const tokenHash = readAccessTokenHash(event)
  if (!tokenHash) throw accessDeniedError('none')
  await hitRateLimit(event, `access:submit:${tokenHash}`, ACCESS_SUBMIT_LIMIT)

  const result = await createGuestSubmission(event, input, { origin: 'permission', tokenHash })
  if ('denied' in result) throw accessDeniedError(result.denied)

  renewAccessCookie(event)
  setResponseStatus(event, 201)
  return result
})
