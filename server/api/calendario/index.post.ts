// Agendar un día de trabajo (solo administradores): el día, sus rangos, miembros y adjuntos nacen en un solo lote.
// 409 si una persona elegida ya no está activa o parte del material ya no existe; no se crea nada.
import { setResponseStatus } from 'h3'
import type { WorkDayDetail } from '#shared/types/api'
import { workDayInput } from '#shared/validation/calendar'

export default defineEventHandler(async (event): Promise<WorkDayDetail> => {
  const { profile } = requireRole(event, 'admin')
  const input = await readValid(event, workDayInput)
  const id = await createWorkDay(input, profile)
  setResponseStatus(event, 201)
  return getWorkDayDetail(id)
})
