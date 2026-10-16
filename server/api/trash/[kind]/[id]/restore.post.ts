// Restaurar un elemento de la papelera con su contenido (FR-035).
import type { TrashRestoreResult } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<TrashRestoreResult> => {
  const { profile } = requireRole(event, 'editor')
  const kind = paramTrashKind(event)
  const id = paramId(event)
  return restore(kind, id, profile)
})
