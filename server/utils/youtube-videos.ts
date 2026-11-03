// Videos de YouTube conocidos y el historial compartido del equipo (feature 005, data-model.md, research D9–D11).
// El historial vive en la misma fila del video: `last_viewed_at` `NULL` = fuera del historial.
import { and, desc, eq, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { createError, getRouterParam } from 'h3'
import type { YoutubeHistoryItem, YoutubePerson, YoutubeVideo } from '#shared/types/api'
import { YOUTUBE_CHANNEL_MAX, YOUTUBE_JOB_ID_RE, YOUTUBE_TITLE_MAX, YOUTUBE_VIDEO_ID_RE } from '#shared/constants/youtube'
import { profiles, youtubeVideos } from '../db/schema'
import { decodeCursor, encodeCursor } from './pagination'
import type { ProfileRow } from './session'

export type YoutubeVideoRow = typeof youtubeVideos.$inferSelect

const notFound = () => createError({ statusCode: 404, statusMessage: 'No encontrado' })

/** Parámetro de ruta con un ID de video; 404 si no tiene la forma correcta (como `paramId`). */
export function videoIdParam(event: H3Event, name = 'videoId'): string {
  const value = getRouterParam(event, name)
  if (!value || !YOUTUBE_VIDEO_ID_RE.test(value)) throw notFound()
  return value
}

/** Parámetro de ruta con el ID de un trabajo del servicio (32 hex); 404 sin llamar al servicio. */
export function jobIdParam(event: H3Event, name = 'jobId'): string {
  const value = getRouterParam(event, name)
  if (!value || !YOUTUBE_JOB_ID_RE.test(value)) throw notFound()
  return value
}

/** Datos guardables del video: recortes y descartes de data-model.md. */
export function cleanVideo(video: YoutubeVideo) {
  const title = video.title.trim().slice(0, YOUTUBE_TITLE_MAX) || video.videoId
  const channel = video.channel?.trim().slice(0, YOUTUBE_CHANNEL_MAX) || null
  const duration = typeof video.durationSeconds === 'number' && Number.isFinite(video.durationSeconds) && video.durationSeconds >= 0
    ? Math.round(video.durationSeconds)
    : null
  const thumbnail = video.thumbnailUrl?.startsWith('https://') ? video.thumbnailUrl : null
  return { videoId: video.videoId, title, channel, durationSeconds: duration, thumbnailUrl: thumbnail }
}

/**
 * Registra que alguien abrió la ficha (FR-022): `INSERT … ON CONFLICT (video_id) DO UPDATE` que refresca los datos del
 * video y lo sube al inicio del historial. Devuelve la consulta sin ejecutarla, para `db.batch`. La hora es la del
 * servidor (milisegundos), la misma precisión que viaja en el cursor del historial.
 */
export function upsertVideoView(video: YoutubeVideo, profile: Pick<ProfileRow, 'userId'>) {
  const values = cleanVideo(video)
  const now = new Date()
  return useDb()
    .insert(youtubeVideos)
    .values({ ...values, lastViewedAt: now, lastViewedBy: profile.userId })
    .onConflictDoUpdate({
      target: youtubeVideos.videoId,
      set: {
        title: values.title,
        channel: values.channel,
        durationSeconds: values.durationSeconds,
        thumbnailUrl: values.thumbnailUrl,
        lastViewedAt: now,
        lastViewedBy: profile.userId,
        updatedAt: sql`now()`,
      },
    })
}

export async function findStoredVideo(videoId: string): Promise<YoutubeVideoRow | null> {
  const [row] = await useDb().select().from(youtubeVideos).where(eq(youtubeVideos.videoId, videoId)).limit(1)
  return row ?? null
}

export function toYoutubeVideo(row: Pick<YoutubeVideoRow, 'videoId' | 'title' | 'channel' | 'durationSeconds' | 'thumbnailUrl'>): YoutubeVideo {
  return {
    videoId: row.videoId,
    title: row.title,
    channel: row.channel,
    durationSeconds: row.durationSeconds,
    thumbnailUrl: row.thumbnailUrl,
  }
}

export function toYoutubePerson(profile: Pick<ProfileRow, 'userId' | 'name' | 'status'>): YoutubePerson {
  return { userId: profile.userId, name: profile.name, active: profile.status === 'active' }
}

// ---------------------------------------------------------------- historial (US3)

interface HistoryCursorRow { videoId: string, lastViewedAt: Date | null }

/** Orden, condición "después del cursor" y siguiente cursor sobre `(last_viewed_at DESC, video_id DESC)`. */
export function historyKeyset(cursor: string | undefined, limit: number) {
  const after = decodeCursor(cursor)
  const where = after
    ? sql`(${youtubeVideos.lastViewedAt}, ${youtubeVideos.videoId}) < (${after.v}::timestamptz, ${after.id})`
    : undefined
  const orderBy = [desc(youtubeVideos.lastViewedAt), desc(youtubeVideos.videoId)]

  function nextCursor(rows: HistoryCursorRow[]): string | null {
    if (rows.length < limit) return null
    const last = rows[rows.length - 1]!
    return last.lastViewedAt ? encodeCursor({ v: last.lastViewedAt.toISOString(), id: last.videoId }) : null
  }
  return { where, orderBy, nextCursor }
}

/** Página del historial (FR-023) con quién lo abrió en el mismo select (sin N+1). */
export async function listHistory({ cursor, limit, exclude }: { cursor?: string, limit: number, exclude?: string }) {
  const keyset = historyKeyset(cursor, limit)
  const rows = await useDb()
    .select({
      videoId: youtubeVideos.videoId,
      title: youtubeVideos.title,
      channel: youtubeVideos.channel,
      durationSeconds: youtubeVideos.durationSeconds,
      thumbnailUrl: youtubeVideos.thumbnailUrl,
      lastViewedAt: youtubeVideos.lastViewedAt,
      viewerId: profiles.userId,
      viewerName: profiles.name,
      viewerStatus: profiles.status,
    })
    .from(youtubeVideos)
    .leftJoin(profiles, eq(youtubeVideos.lastViewedBy, profiles.userId))
    .where(and(
      sql`${youtubeVideos.lastViewedAt} IS NOT NULL`,
      exclude ? sql`${youtubeVideos.videoId} <> ${exclude}` : undefined,
      keyset.where,
    ))
    .orderBy(...keyset.orderBy)
    .limit(limit)

  const items: YoutubeHistoryItem[] = rows.map(row => ({
    ...toYoutubeVideo(row),
    viewedAt: row.lastViewedAt!.toISOString(),
    viewedBy: row.viewerId && row.viewerName && row.viewerStatus
      ? toYoutubePerson({ userId: row.viewerId, name: row.viewerName, status: row.viewerStatus })
      : null,
  }))
  return { items, nextCursor: keyset.nextCursor(rows) }
}

/** Quita el video del historial (FR-025). No toca las listas; la limpieza diaria borra el video si queda huérfano. */
export function removeFromHistory(videoId: string) {
  return useDb()
    .update(youtubeVideos)
    .set({ lastViewedAt: null, lastViewedBy: null })
    .where(eq(youtubeVideos.videoId, videoId))
}
