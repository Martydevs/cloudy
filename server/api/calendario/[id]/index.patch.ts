// Editar un día de trabajo (solo administradores): reemplaza sus datos, rangos, miembros y adjuntos en un solo lote.
import type { WorkDayDetail } from '#shared/types/api'
import { workDayInput } from '#shared/validation/calendar'

export default defineEventHandler(async (event): Promise<WorkDayDetail> => {
  const { profile } = requireRole(event, 'admin')
  const id = paramId(event)
  const input = await readValid(event, workDayInput)
  await updateWorkDay(id, input, profile)
  return getWorkDayDetail(id)
})
