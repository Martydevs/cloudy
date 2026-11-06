// Agregar una canción a una colección (contracts/api.md § 12, FR-021, FR-023): cualquier persona del equipo. Si ya estaba,
// `added: false` sin duplicarla; la colección sube al inicio solo si cambió.
import { eq } from 'drizzle-orm'
import { songCollectionItemInput } from '#shared/validation/songs'
import { songCollections, songs } from '../../../../../db/schema'

export default defineEventHandler(async (event): Promise<{ added: boolean }> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { songId } = await readValid(event, songCollectionItemInput)
  const db = useDb()
  const [[collection], [song]] = await db.batch([
    db.select({ id: songCollections.id }).from(songCollections).where(eq(songCollections.id, id)).limit(1),
    db.select({ id: songs.id }).from(songs).where(eq(songs.id, songId)).limit(1),
  ])
  if (!collection) throw collectionNotFound()
  if (!song) throw songGone()

  const inserted = await addCollectionItem(id, songId, profile.userId)
  const added = inserted.length > 0
  if (added) await touchCollection(id)
  return { added }
})
