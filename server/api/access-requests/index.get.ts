// Solicitudes de acceso abiertas para el equipo (feature 003, FR-008).
import type { AccessRequest } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<AccessRequest[]> => {
  requireRole(event, 'editor')
  return listOpenAccessRequests()
})
