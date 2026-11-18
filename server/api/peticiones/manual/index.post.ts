// Alta manual de una petición («Agregar petición» en /peticiones), fase 1: crea el envío con el remitente de la sesión y
// firma las subidas. Reutiliza el envío de invitados (`createGuestSubmission`), pero solo con imágenes y sin nombre en el
// cuerpo: el servidor pone el del perfil. El envío se aprueba al cerrar la subida (`manual/[id]/complete`).
import { manualPrayerInput } from '#shared/validation/prayers'
import type { GuestSubmissionTicket } from '../../../utils/guest-submissions'

const MANUAL_LIMIT = { limit: 60, windowSec: 3600 }

export default defineEventHandler(async (event): Promise<GuestSubmissionTicket> => {
  const { profile } = requireRole(event, 'editor')
  await hitRateLimit(event, `peticiones-manual:${profile.userId}`, MANUAL_LIMIT)

  const input = await readGuestSubmission(event, manualPrayerInput)
  assertPrayerPhotos(input.files)
  const ticket = await createGuestSubmission(
    event,
    { senderName: manualSenderName(profile), note: input.note, files: input.files },
    { senderKey: manualSenderKey(profile.userId) },
  )
  setResponseStatus(event, 201)
  return ticket
})
