// Eliminar una lista (FR-017): solo su autor o un administrador. La cascada borra sus elementos; los videos y el
// historial no se tocan.
import { eq } from 'drizzle-orm'
import { setResponseStatus } from 'h3'
import { youtubePlaylists } from '../../../../db/schema'

export default defineEventHandler(async (event): Promise<null> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  await getManagedPlaylist(id, profile)
  await useDb().delete(youtubePlaylists).where(eq(youtubePlaylists.id, id))
  setResponseStatus(event, 204)
  return null
})
