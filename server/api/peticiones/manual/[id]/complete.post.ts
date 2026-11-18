// Alta manual de una petición, fase 2: verifica las fotos subidas (tamaño real y firma, como el cierre de un invitado) y, en
// un solo lote, deja el envío aprobado por quien lo creó, con sus imágenes en la raíz del drive. Nunca pasa por Solicitudes
// ni por el aviso en vivo. Solo quien creó el alta puede cerrarla: cualquier otro envío responde 404.
export default defineEventHandler(async (event): Promise<{ status: 'approved', accepted: number, rejected: number }> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)

  const { submission, accepted, rejected } = await verifyGuestSubmission(id, { senderKey: manualSenderKey(profile.userId) })
  await approveSubmission(id, profile, null, { manual: { submission, files: accepted } })
  return { status: 'approved', accepted: accepted.length, rejected }
})
