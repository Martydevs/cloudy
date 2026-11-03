// Fila Listas (FR-016): todas las listas del equipo con su autor, conteo y miniaturas, en una sola sentencia.
import { setResponseHeader } from 'h3'
import type { YoutubePlaylist } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<{ items: YoutubePlaylist[] }> => {
  requireRole(event, 'editor')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const rows = await listPlaylistsQuery()
  return { items: rows.map(toYoutubePlaylist) }
})
