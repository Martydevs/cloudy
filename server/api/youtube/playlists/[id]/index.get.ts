// Detalle de una lista con sus videos (FR-016): la lista y sus elementos en un solo viaje (`db.batch`).
import { setResponseHeader } from 'h3'
import type { YoutubePlaylistDetail } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<YoutubePlaylistDetail> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const [[row], items] = await useDb().batch([playlistQuery(id), playlistItemsQuery(id)])
  if (!row) throw playlistNotFound()
  return { ...toYoutubePlaylist(row), items: items.map(toYoutubePlaylistItem) }
})
