// Quitar una canción de una colección (contracts/api.md § 13, FR-021): cualquier persona del equipo, idempotente. No toca la
// canción ni el historial.
import { and, eq } from 'drizzle-orm'
import { setResponseStatus } from 'h3'
import { songCollectionItems } from '../../../../../db/schema'

export default defineEventHandler(async (event): Promise<null> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  const songId = paramId(event, 'songId')
  const removed = await useDb()
    .delete(songCollectionItems)
    .where(and(eq(songCollectionItems.collectionId, id), eq(songCollectionItems.songId, songId)))
    .returning({ songId: songCollectionItems.songId })
  if (removed.length > 0) await touchCollection(id)
  setResponseStatus(event, 204)
  return null
})
