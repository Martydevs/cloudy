// Raíces de la papelera con su ubicación original y días restantes (FR-034, FR-036).
import type { TrashItem } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<TrashItem[]> => {
  requireRole(event, 'editor')
  return listTrash()
})
