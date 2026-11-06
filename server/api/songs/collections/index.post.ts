// Crear una colección (contracts/api.md § 8, FR-020). Con `songId`, nace con esa canción en el mismo `db.batch`; si la
// canción no existe, 404 y no se crea nada (sin colecciones a medias). Los nombres pueden repetirse.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { setResponseStatus } from 'h3'
import type { SongCollection } from '#shared/types/api'
import { songCollectionInput } from '#shared/validation/songs'
import { songCollectionItems, songCollections, songs } from '../../../db/schema'

export default defineEventHandler(async (event): Promise<SongCollection> => {
  const { profile } = requireRole(event, 'editor')
  const { name, songId } = await readValid(event, songCollectionInput)

  const db = useDb()
  if (songId) {
    const [song] = await db.select({ id: songs.id }).from(songs).where(eq(songs.id, songId)).limit(1)
    if (!song) throw songGone()
  }

  const id = randomUUID()
  const now = new Date()
  const insertCollection = db.insert(songCollections).values({ id, name, createdBy: profile.userId, createdAt: now, updatedAt: now })
  if (songId) {
    await db.batch([insertCollection, db.insert(songCollectionItems).values({ collectionId: id, songId, addedBy: profile.userId, addedAt: now })])
  }
  else {
    await db.batch([insertCollection])
  }

  setResponseStatus(event, 201)
  return {
    id,
    name,
    author: toSongPerson(profile.userId, profile.name, profile.status),
    itemCount: songId ? 1 : 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
})
