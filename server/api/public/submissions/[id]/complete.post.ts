// Fase 2 del envío de un invitado: verifica cada archivo (tamaño real y firma), descarta los
// inválidos y cierra el envío con `completed_at`, que dispara el aviso en vivo (T120a). La lógica vive en
// `completeGuestSubmission` (`server/utils/guest-submissions.ts`), que comparte la verificación con el alta manual.
import { getRequestIP } from 'h3'

// Un cierre por envío. Más holgado que la creación (5 por hora y red): muchos invitados comparten la misma red
// (el Wi-Fi de la iglesia en un evento) y un cierre fallido se puede reintentar.
const COMPLETE_LIMIT = { limit: 60, windowSec: 3600 }

export default defineEventHandler(async (event): Promise<{ status: 'pending', accepted: number, rejected: number }> => {
  // El id del envío es la capacidad (no hay sesión); el límite por IP frena a quien lo use para leer el bucket a ciegas.
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  await hitRateLimit(event, `guest-complete:${hashSender(ip)}`, COMPLETE_LIMIT)

  const { accepted, rejected } = await completeGuestSubmission(paramId(event))
  return { status: 'pending', accepted, rejected }
})
