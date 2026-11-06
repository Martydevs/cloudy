// Historial compartido de Canciones (contracts/api.md § 5, FR-027, FR-028): de la más reciente a la más antigua, con cursor
// keyset y sin la letra.
import { setResponseHeader } from 'h3'
import type { SongHistoryPage } from '#shared/types/api'
import { songHistoryQuery } from '#shared/validation/songs'

export default defineEventHandler(async (event): Promise<SongHistoryPage> => {
  requireRole(event, 'editor')
  const query = queryValid(event, songHistoryQuery)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return listSongHistory(query)
})
