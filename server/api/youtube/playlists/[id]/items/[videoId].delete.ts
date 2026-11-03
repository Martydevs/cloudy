// Quitar un video de una lista (FR-015): cualquier persona del equipo, idempotente. No toca el video ni el historial.
import { and, eq } from 'drizzle-orm'
import { setResponseStatus } from 'h3'
import { youtubePlaylistItems } from '../../../../../db/schema'

export default defineEventHandler(async (event): Promise<null> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  const videoId = videoIdParam(event)
  const removed = await useDb()
    .delete(youtubePlaylistItems)
    .where(and(eq(youtubePlaylistItems.playlistId, id), eq(youtubePlaylistItems.videoId, videoId)))
    .returning({ videoId: youtubePlaylistItems.videoId })
  if (removed.length > 0) await touchPlaylist(id)
  setResponseStatus(event, 204)
  return null
})
