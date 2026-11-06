// Fila Colecciones (contracts/api.md § 7, FR-020): todas las colecciones con su autor y conteo, en una sola sentencia.
import { setResponseHeader } from 'h3'
import type { SongCollection } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<{ items: SongCollection[] }> => {
  requireRole(event, 'editor')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const rows = await listCollectionsQuery()
  return { items: rows.map(toSongCollection) }
})
