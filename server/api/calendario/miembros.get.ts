// Personas que se pueden asignar a un día (cuentas activas), para el selector del formulario. Solo administradores.
import type { CalendarMember } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<{ items: CalendarMember[] }> => {
  requireRole(event, 'admin')
  return { items: await listCalendarMembers() }
})
