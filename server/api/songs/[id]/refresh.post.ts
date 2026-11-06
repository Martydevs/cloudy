// Volver a obtener la letra (contracts/api.md § 3, FR-010): rastrea de nuevo y reemplaza la letra solo si el nuevo rastreo
// trae una letra válida; cualquier fallo deja la guardada intacta.
import { setResponseHeader } from 'h3'
import type { SongDetail } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<SongDetail> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const song = await findSong(id)
  if (!song) throw songNotFound()

  const content = readCrawledSong(await crawlLetras(song.sourceUrl), song.sourceUrl)
  const row = await replaceLyrics(id, content)
  if (!row) throw songNotFound()
  return toSongDetail(row)
})
