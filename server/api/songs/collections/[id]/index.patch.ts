// Renombrar una colección (contracts/api.md § 10, FR-022): solo su autor o un administrador.
import { eq, sql } from 'drizzle-orm'
import type { SongCollection } from '#shared/types/api'
import { songCollectionRename } from '#shared/validation/songs'
import { songCollections } from '../../../../db/schema'

export default defineEventHandler(async (event): Promise<SongCollection> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { name } = await readValid(event, songCollectionRename)
  const row = await getManagedCollection(id, profile)
  const [updated] = await useDb()
    .update(songCollections)
    .set({ name, updatedAt: sql`now()` })
    .where(eq(songCollections.id, id))
    .returning({ updatedAt: songCollections.updatedAt })
  if (!updated) throw collectionNotFound()
  return toSongCollection({ ...row, name, updatedAt: updated.updatedAt })
})
