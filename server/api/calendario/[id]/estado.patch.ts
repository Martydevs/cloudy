// Cambiar solo el estado de un día (un toque desde la lista o el detalle). Quien administra, el de cualquier
// día; un editor, solo el de los días en los que está asignado (`setWorkDayStatus` lo comprueba en la misma escritura).
import type { WorkDayStatus } from '#shared/types/api'
import { workDayStatusInput } from '#shared/validation/calendar'

export default defineEventHandler(async (event): Promise<{ id: string, status: WorkDayStatus }> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { status } = await readValid(event, workDayStatusInput)
  await setWorkDayStatus(id, status, profile)
  return { id, status }
})
