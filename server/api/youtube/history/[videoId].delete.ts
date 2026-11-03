// Quitar un video del historial (FR-025): idempotente y sin tocar las listas.
import { setResponseStatus } from 'h3'

export default defineEventHandler(async (event): Promise<null> => {
  requireRole(event, 'editor')
  const videoId = videoIdParam(event)
  await removeFromHistory(videoId)
  setResponseStatus(event, 204)
  return null
})
