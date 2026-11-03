// Agregar un video a una lista (FR-015, FR-018): cualquier persona del equipo. Si ya estaba, `added: false` sin
// duplicarlo; la lista sube al inicio solo si cambió.
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { youtubePlaylistItemInput } from '#shared/validation/youtube'
import { youtubePlaylists, youtubeVideos } from '../../../../../db/schema'

export default defineEventHandler(async (event): Promise<{ added: boolean }> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { videoId } = await readValid(event, youtubePlaylistItemInput)
  const db = useDb()
  const [[playlist], [video]] = await db.batch([
    db.select({ id: youtubePlaylists.id }).from(youtubePlaylists).where(eq(youtubePlaylists.id, id)).limit(1),
    db.select({ videoId: youtubeVideos.videoId }).from(youtubeVideos).where(eq(youtubeVideos.videoId, videoId)).limit(1),
  ])
  if (!playlist) throw playlistNotFound()
  if (!video) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'Ese video ya no está guardado. Ábrelo de nuevo e inténtalo otra vez.' })

  const inserted = await addPlaylistItem(id, videoId, profile.userId)
  const added = inserted.length > 0
  if (added) await touchPlaylist(id)
  return { added }
})
