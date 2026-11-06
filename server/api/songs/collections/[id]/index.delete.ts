// Eliminar una colección (contracts/api.md § 11, FR-022): solo su autor o un administrador. La cascada borra sus elementos;
// las canciones y el historial no se tocan.
import { eq } from 'drizzle-orm'
import { setResponseStatus } from 'h3'
import { songCollections } from '../../../../db/schema'

export default defineEventHandler(async (event): Promise<null> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  await getManagedCollection(id, profile)
  await useDb().delete(songCollections).where(eq(songCollections.id, id))
  setResponseStatus(event, 204)
  return null
})
