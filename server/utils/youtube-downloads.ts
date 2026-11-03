// Descargas guardadas de YouTube (sección «Descargas» de /youtube). Una fila por video con su última descarga: bajar el
// mismo video otra vez la actualiza, así la tabla no se acumula. El registro lo pide el navegador cuando el archivo ya
// se guardó (los trabajos viven solo en el servicio de descargas, research D2).
import { desc, eq, inArray, sql } from 'drizzle-orm'
import type { YoutubeDownloadItem, YoutubeFormat } from '#shared/types/api'
import { profiles, youtubeDownloads, youtubeVideos } from '../db/schema'
import { decodeCursor, encodeCursor } from './pagination'
import type { ProfileRow } from './session'
import { toYoutubePerson, toYoutubeVideo } from './youtube-videos'

interface DownloadCursorRow { videoId: string, downloadedAt: Date }

/** Orden, condición "después del cursor" y siguiente cursor sobre `(downloaded_at DESC, video_id DESC)`. */
export function downloadsKeyset(cursor: string | undefined, limit: number) {
  const after = decodeCursor(cursor)
  const where = after
    ? sql`(${youtubeDownloads.downloadedAt}, ${youtubeDownloads.videoId}) < (${after.v}::timestamptz, ${after.id})`
    : undefined
  const orderBy = [desc(youtubeDownloads.downloadedAt), desc(youtubeDownloads.videoId)]

  function nextCursor(rows: DownloadCursorRow[]): string | null {
    if (rows.length < limit) return null
    const last = rows[rows.length - 1]!
    return encodeCursor({ v: last.downloadedAt.toISOString(), id: last.videoId })
  }
  return { where, orderBy, nextCursor }
}

/** Página de descargas, de la más reciente a la más antigua, con quién la hizo en el mismo select (sin N+1). */
export async function listDownloads({ cursor, limit }: { cursor?: string, limit: number }) {
  const keyset = downloadsKeyset(cursor, limit)
  const rows = await useDb()
    .select({
      videoId: youtubeVideos.videoId,
      title: youtubeVideos.title,
      channel: youtubeVideos.channel,
      durationSeconds: youtubeVideos.durationSeconds,
      thumbnailUrl: youtubeVideos.thumbnailUrl,
      format: youtubeDownloads.format,
      downloadedAt: youtubeDownloads.downloadedAt,
      userId: profiles.userId,
      userName: profiles.name,
      userStatus: profiles.status,
    })
    .from(youtubeDownloads)
    .innerJoin(youtubeVideos, eq(youtubeDownloads.videoId, youtubeVideos.videoId))
    .leftJoin(profiles, eq(youtubeDownloads.downloadedBy, profiles.userId))
    .where(keyset.where)
    .orderBy(...keyset.orderBy)
    .limit(limit)

  const items: YoutubeDownloadItem[] = rows.map(row => ({
    ...toYoutubeVideo(row),
    format: row.format as YoutubeFormat,
    downloadedAt: row.downloadedAt.toISOString(),
    downloadedBy: row.userId && row.userName && row.userStatus
      ? toYoutubePerson({ userId: row.userId, name: row.userName, status: row.userStatus })
      : null,
  }))
  return { items, nextCursor: keyset.nextCursor(rows) }
}

/**
 * Guarda (o actualiza) la última descarga de cada video. Solo cuenta lo que ya conocemos (`youtube_videos`): un ID
 * inventado no crea filas. Una sola consulta (`INSERT … SELECT … ON CONFLICT`); devuelve cuántos videos quedaron.
 */
export async function recordDownloads(videoIds: string[], format: YoutubeFormat, profile: Pick<ProfileRow, 'userId'>): Promise<number> {
  const db = useDb()
  const known = await db.select({ videoId: youtubeVideos.videoId }).from(youtubeVideos).where(inArray(youtubeVideos.videoId, videoIds))
  if (known.length === 0) return 0
  const now = new Date()
  await db
    .insert(youtubeDownloads)
    .values(known.map(({ videoId }) => ({ videoId, format, downloadedBy: profile.userId, downloadedAt: now })))
    .onConflictDoUpdate({
      target: youtubeDownloads.videoId,
      set: { format, downloadedBy: profile.userId, downloadedAt: now },
    })
  return known.length
}

