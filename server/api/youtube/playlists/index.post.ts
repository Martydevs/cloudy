// Crear una lista (FR-015). Con `videoId`, la lista nace con ese video en el mismo `db.batch`; si el video no está
// guardado, 404 y no se crea nada (sin listas a medias).
import { randomUUID } from 'node:crypto'
import { createError, setResponseStatus } from 'h3'
import type { YoutubePlaylist } from '#shared/types/api'
import { youtubePlaylistInput } from '#shared/validation/youtube'
import { youtubePlaylistItems, youtubePlaylists } from '../../../db/schema'

export default defineEventHandler(async (event): Promise<YoutubePlaylist> => {
  const { profile } = requireRole(event, 'editor')
  const { name, videoId } = await readValid(event, youtubePlaylistInput)

  const video = videoId ? await findStoredVideo(videoId) : null
  if (videoId && !video) {
    throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'Ese video ya no está guardado. Ábrelo de nuevo e inténtalo otra vez.' })
  }

  const db = useDb()
  const id = randomUUID()
  const now = new Date()
  const insertPlaylist = db.insert(youtubePlaylists).values({ id, name, createdBy: profile.userId, createdAt: now, updatedAt: now })
  if (video) {
    await db.batch([insertPlaylist, db.insert(youtubePlaylistItems).values({ playlistId: id, videoId: video.videoId, addedBy: profile.userId, addedAt: now })])
  }
  else {
    await db.batch([insertPlaylist])
  }

  setResponseStatus(event, 201)
  return {
    id,
    name,
    author: toYoutubePerson(profile),
    itemCount: video ? 1 : 0,
    covers: video?.thumbnailUrl ? [video.thumbnailUrl] : [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
})
