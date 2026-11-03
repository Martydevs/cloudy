// Últimas descargas del equipo (sección «Descargas» de /youtube): de la más reciente a la más antigua, con cursor keyset.
import { setResponseHeader } from 'h3'
import type { YoutubeDownloadsPage } from '#shared/types/api'
import { youtubeHistoryQuery } from '#shared/validation/youtube'

export default defineEventHandler(async (event): Promise<YoutubeDownloadsPage> => {
  requireRole(event, 'editor')
  const { cursor, limit } = queryValid(event, youtubeHistoryQuery)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return listDownloads({ cursor, limit })
})
