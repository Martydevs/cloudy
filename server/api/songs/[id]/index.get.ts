// Ficha de una canción con su letra (contracts/api.md § 2): registra la vista en la misma sentencia (FR-027).
import { setResponseHeader } from 'h3'
import type { SongDetail } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<SongDetail> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const row = await markSongViewed({ id }, profile)
  if (!row) throw songNotFound()
  return toSongDetail(row)
})
