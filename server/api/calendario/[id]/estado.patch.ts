// Cambiar solo el estado de un día (un toque desde la lista o el detalle). Solo administradores.
import type { WorkDayStatus } from '#shared/types/api'
import { workDayStatusInput } from '#shared/validation/calendar'

export default defineEventHandler(async (event): Promise<{ id: string, status: WorkDayStatus }> => {
  requireRole(event, 'admin')
  const id = paramId(event)
  const { status } = await readValid(event, workDayStatusInput)
  await setWorkDayStatus(id, status)
  return { id, status }
})
