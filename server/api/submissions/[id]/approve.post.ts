// Aprobar un envío hacia una carpeta (FR-019). El lote (UPDATE condicional + INSERT dependiente) vive en
// `approveSubmission` (`server/utils/submissions.ts`), que también usa el alta manual de Peticiones.
import type { FileItem } from '#shared/types/api'
import { approveInput } from '#shared/validation/submissions'

export default defineEventHandler(async (event): Promise<{ files: FileItem[] }> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { folderId } = await readValid(event, approveInput)
  if (folderId) await getVisibleFolder(folderId)
  return { files: await approveSubmission(id, profile, folderId) }
})
