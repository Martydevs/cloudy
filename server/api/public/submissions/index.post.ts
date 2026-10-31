// Fase 1 del envío abierto de un invitado (FR-016, FR-020): límite por IP y creación del envío con URLs firmadas.
import { getRequestIP } from 'h3'
import { submissionInput } from '#shared/validation/submissions'
import type { GuestSubmissionTicket } from '../../../utils/guest-submissions'

export default defineEventHandler(async (event): Promise<GuestSubmissionTicket> => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  await hitRateLimit(event, `guest:${hashSender(ip)}`, { limit: 5, windowSec: 3600 })

  const input = await readGuestSubmission(event, submissionInput)
  const ticket = await createGuestSubmission(event, input, { origin: 'link' })
  setResponseStatus(event, 201)
  return ticket
})
