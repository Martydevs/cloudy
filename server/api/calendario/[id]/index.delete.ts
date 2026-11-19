// Borrar un día de trabajo (solo administradores; la interfaz confirma antes). Sus rangos, miembros y adjuntos se van con él.
import { setResponseStatus } from 'h3'

export default defineEventHandler(async (event): Promise<null> => {
  requireRole(event, 'admin')
  await deleteWorkDay(paramId(event))
  setResponseStatus(event, 204)
  return null
})
