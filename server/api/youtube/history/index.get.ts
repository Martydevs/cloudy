// Historial compartido del equipo (FR-023, FR-026): del más reciente al más antiguo, con cursor keyset.
import { setResponseHeader } from 'h3'
import type { YoutubeHistoryPage } from '#shared/types/api'
import { youtubeHistoryQuery } from '#shared/validation/youtube'

export default defineEventHandler(async (event): Promise<YoutubeHistoryPage> => {
  requireRole(event, 'editor')
  const query = queryValid(event, youtubeHistoryQuery)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return listHistory(query)
})
