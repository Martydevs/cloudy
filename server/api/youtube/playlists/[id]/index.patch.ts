// Renombrar una lista (FR-017): solo su autor o un administrador.
import { eq, sql } from 'drizzle-orm'
import type { YoutubePlaylist } from '#shared/types/api'
import { youtubePlaylistRename } from '#shared/validation/youtube'
import { youtubePlaylists } from '../../../../db/schema'

export default defineEventHandler(async (event): Promise<YoutubePlaylist> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const { name } = await readValid(event, youtubePlaylistRename)
  const row = await getManagedPlaylist(id, profile)
  const [updated] = await useDb()
    .update(youtubePlaylists)
    .set({ name, updatedAt: sql`now()` })
    .where(eq(youtubePlaylists.id, id))
    .returning({ updatedAt: youtubePlaylists.updatedAt })
  if (!updated) throw playlistNotFound()
  return toYoutubePlaylist({ ...row, name, updatedAt: updated.updatedAt })
})
