// Quitar una canción del historial (contracts/api.md § 6, FR-029): sin tocar sus colecciones; 404 si no existe.
import { setResponseStatus } from 'h3'

export default defineEventHandler(async (event): Promise<null> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  if (!await removeSongFromHistory(id)) throw songNotFound()
  setResponseStatus(event, 204)
  return null
})
