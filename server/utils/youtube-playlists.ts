// Listas de YouTube del equipo (feature 005, data-model.md, research D11–D12). La fila Listas trae el conteo y hasta 4
// miniaturas por subconsulta en la misma sentencia (sin N+1). Renombrar o eliminar: su autor o quien modera (admin).
import { asc, desc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { YoutubePlaylist, YoutubePlaylistItem } from '#shared/types/api'
import type { Role } from '#shared/permissions'
import { can } from '#shared/permissions'
import { profiles, youtubePlaylistItems, youtubePlaylists, youtubeVideos } from '../db/schema'

export const PLAYLIST_COVERS = 4
export const FORBIDDEN_PLAYLIST_MESSAGE = 'Solo quien la creó o un administrador puede cambiar esta lista.'

/** Columnas de una lista con su autor, el conteo de videos y las miniaturas más recientes. */
export const playlistColumns = {
  id: youtubePlaylists.id,
  name: youtubePlaylists.name,
  createdBy: youtubePlaylists.createdBy,
  createdAt: youtubePlaylists.createdAt,
  updatedAt: youtubePlaylists.updatedAt,
  authorName: profiles.name,
  authorStatus: profiles.status,
  itemCount: sql<number>`(SELECT count(*)::int FROM youtube_playlist_items i WHERE i.playlist_id = ${youtubePlaylists.id})`,
  covers: sql<string[] | null>`(
    SELECT json_agg(c.thumbnail_url) FROM (
      SELECT v.thumbnail_url FROM youtube_playlist_items i
      JOIN youtube_videos v ON v.video_id = i.video_id
      WHERE i.playlist_id = ${youtubePlaylists.id} AND v.thumbnail_url IS NOT NULL
      ORDER BY i.added_at DESC LIMIT ${PLAYLIST_COVERS}
    ) c
  )`,
}

export interface PlaylistRow {
  id: string
  name: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
  authorName: string | null
  authorStatus: string | null
  itemCount: number | string | null
  covers: string[] | null
}

/** Todas las listas (son decenas), la más reciente primero. */
export function listPlaylistsQuery() {
  return useDb()
    .select(playlistColumns)
    .from(youtubePlaylists)
    .leftJoin(profiles, eq(youtubePlaylists.createdBy, profiles.userId))
    .orderBy(desc(youtubePlaylists.updatedAt), asc(youtubePlaylists.id))
}

export function playlistQuery(id: string) {
  return useDb()
    .select(playlistColumns)
    .from(youtubePlaylists)
    .leftJoin(profiles, eq(youtubePlaylists.createdBy, profiles.userId))
    .where(eq(youtubePlaylists.id, id))
    .limit(1)
}

/** Videos de una lista, el agregado más reciente primero, con quién lo agregó (mismo select). */
export function playlistItemsQuery(id: string) {
  return useDb()
    .select({
      videoId: youtubeVideos.videoId,
      title: youtubeVideos.title,
      channel: youtubeVideos.channel,
      durationSeconds: youtubeVideos.durationSeconds,
      thumbnailUrl: youtubeVideos.thumbnailUrl,
      addedAt: youtubePlaylistItems.addedAt,
      addedBy: youtubePlaylistItems.addedBy,
      adderName: profiles.name,
      adderStatus: profiles.status,
    })
    .from(youtubePlaylistItems)
    .innerJoin(youtubeVideos, eq(youtubePlaylistItems.videoId, youtubeVideos.videoId))
    .leftJoin(profiles, eq(youtubePlaylistItems.addedBy, profiles.userId))
    .where(eq(youtubePlaylistItems.playlistId, id))
    .orderBy(desc(youtubePlaylistItems.addedAt), asc(youtubeVideos.videoId))
}

export type PlaylistItemRow = Awaited<ReturnType<typeof playlistItemsQuery>>[number]

const person = (userId: string, name: string | null, status: string | null) => ({
  userId,
  name: name ?? 'Usuario',
  active: status === 'active',
})

export function toYoutubePlaylist(row: PlaylistRow): YoutubePlaylist {
  return {
    id: row.id,
    name: row.name,
    author: person(row.createdBy, row.authorName, row.authorStatus),
    itemCount: Number(row.itemCount ?? 0),
    covers: Array.isArray(row.covers) ? row.covers.filter((c): c is string => typeof c === 'string').slice(0, PLAYLIST_COVERS) : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toYoutubePlaylistItem(row: PlaylistItemRow): YoutubePlaylistItem {
  return {
    videoId: row.videoId,
    title: row.title,
    channel: row.channel,
    durationSeconds: row.durationSeconds,
    thumbnailUrl: row.thumbnailUrl,
    addedAt: row.addedAt.toISOString(),
    addedBy: person(row.addedBy, row.adderName, row.adderStatus),
  }
}

/** Renombrar o eliminar: su autor o quien tiene `youtube.moderate` (admin). */
export function canManagePlaylist(me: { userId: string, role: Role | null }, playlist: { createdBy: string }): boolean {
  return playlist.createdBy === me.userId || can(me.role, 'youtube.moderate')
}

export function playlistNotFound() {
  return createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'Esa lista ya no existe.' })
}

/** La lista o 404. */
export async function getPlaylist(id: string): Promise<PlaylistRow> {
  const [row] = await playlistQuery(id)
  if (!row) throw playlistNotFound()
  return row
}

/** La lista, si quien llama puede cambiarla; si no, 403 (y 404 si no existe). */
export async function getManagedPlaylist(id: string, me: { userId: string, role: Role | null }): Promise<PlaylistRow> {
  const row = await getPlaylist(id)
  if (!canManagePlaylist(me, row)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: FORBIDDEN_PLAYLIST_MESSAGE })
  }
  return row
}

/** Agrega un video sin duplicarlo (FR-018): `ON CONFLICT DO NOTHING RETURNING`; sin fila devuelta, ya estaba. */
export function addPlaylistItem(playlistId: string, videoId: string, userId: string) {
  return useDb()
    .insert(youtubePlaylistItems)
    .values({ playlistId, videoId, addedBy: userId })
    .onConflictDoNothing()
    .returning({ videoId: youtubePlaylistItems.videoId })
}

/** La lista cambió (renombrar, agregar o quitar): sube al inicio de la fila Listas. */
export function touchPlaylist(id: string) {
  return useDb().update(youtubePlaylists).set({ updatedAt: sql`now()` }).where(eq(youtubePlaylists.id, id))
}
