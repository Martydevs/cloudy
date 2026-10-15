// Vista previa o descarga: 302 a una URL firmada; el binario nunca pasa por la función (FR-013, FR-014).
import { presignGet } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  requireRole(event, 'editor')
  const file = await getVisibleFile(paramId(event))
  const download = getQuery(event).download === '1'
  const url = await presignGet(file.storageKey, download ? { download: file.name } : {})
  setResponseHeader(event, 'Cache-Control', 'private, max-age=600')
  return sendRedirect(event, url, 302)
})
