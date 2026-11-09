// Canciones conocidas y el historial compartido del equipo (feature 006, data-model.md, research D5–D8). El historial
// vive en la misma fila de la canción (`last_viewed_at` `NULL` = fuera del historial). Las lecturas de listas nunca
// seleccionan `lyrics`.
import { and, desc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { Song, SongDetail, SongHistoryItem, SongHistoryPage, SongPerson } from '#shared/types/api'
import type { SongErrorCode } from '#shared/constants/songs'
import { LYRICS_MAX_CHARS, LYRICS_MAX_LINES, SONG_ARTIST_MAX, SONG_ERROR_MESSAGES, SONG_SERVICE_MESSAGES, SONG_TITLE_MAX } from '#shared/constants/songs'
import { parseLetrasUrl } from '#shared/validation/songs'
import { profiles, songs } from '../db/schema'
import type { CrawledPage } from './lyrics-crawler'
import { countLines, lyricsToHtml, parseLetrasHtml } from './lyrics-parser'
import { decodeCursor, encodeCursor } from './pagination'
import type { ProfileRow } from './session'

export type SongRow = typeof songs.$inferSelect

const STATUS: Record<SongErrorCode, [number, string]> = {
  not_configured: [503, 'Service Unavailable'],
  misconfigured: [502, 'Bad Gateway'],
  quota: [503, 'Service Unavailable'],
  busy: [503, 'Service Unavailable'],
  crawl_failed: [502, 'Bad Gateway'],
  no_lyrics: [404, 'Not Found'],
  lyrics_too_long: [422, 'Unprocessable Entity'],
  waking: [503, 'Service Unavailable'],
  invalid: [502, 'Bad Gateway'],
}

/**
 * Error de Canciones con su código (`data.code`) y el texto en español; `message` reemplaza el texto por defecto y `status`
 * el estado (p. ej. `no_lyrics` es 404 al rastrear y 422 al generar la presentación).
 */
export function songError(code: SongErrorCode, message: string = SONG_ERROR_MESSAGES[code], status?: 422) {
  const [defaultStatus, defaultMessage] = STATUS[code]
  const statusCode = status ?? defaultStatus
  return createError({ statusCode, statusMessage: status ? 'Unprocessable Entity' : defaultMessage, message, data: { code } })
}

export function songNotFound() {
  return createError({ statusCode: 404, statusMessage: 'No encontrado', message: SONG_SERVICE_MESSAGES.songNotFound })
}

// ---------------------------------------------------------------- letra rastreada

export interface SongContent {
  title: string
  artist: string | null
  stanzas: string[][]
}

/** «de-buenas-part-josh-gamez» → «De buenas part josh gamez»: título de respaldo si la página no trae uno. */
export function titleFromUrl(url: string): string {
  const slug = url.split('/').pop() ?? ''
  const words = slug.replace(/-+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Canción'
}

/** ≤ 300 líneas y ≤ 500 000 caracteres de HTML (FR-035): la única regla, para rastrear y para generar, suelta o en lote. */
export function lyricsWithinLimits(stanzas: string[][]): boolean {
  return countLines(stanzas) <= LYRICS_MAX_LINES && lyricsToHtml(stanzas).length <= LYRICS_MAX_CHARS
}

/** Lanza 422 `lyrics_too_long` si la letra pasa de `lyricsWithinLimits`. */
export function assertLyricsWithinLimits(stanzas: string[][]): void {
  if (!lyricsWithinLimits(stanzas)) throw songError('lyrics_too_long')
}

/**
 * Lo rastreado → contenido guardable, o `no_lyrics` (FR-009: nada se escribe sin una letra completa). Letras.com redirige un
 * enlace de canción inexistente a **otra** canción con `200` (research D2, T003): si la dirección final no es la pedida,
 * tampoco hay letra.
 */
export function readCrawledSong(page: CrawledPage, url: string): SongContent {
  if (page.status === 404 || page.status === 410) throw songError('no_lyrics')
  if (page.status !== null && page.status >= 400) throw songError('crawl_failed')
  if (page.finalUrl) {
    const final = parseLetrasUrl(page.finalUrl)
    if (!final.ok || final.url !== url) throw songError('no_lyrics')
  }
  const parsed = page.html ? parseLetrasHtml(page.html) : null
  if (!parsed) throw songError('no_lyrics')
  assertLyricsWithinLimits(parsed.stanzas)
  return {
    title: parsed.title?.slice(0, SONG_TITLE_MAX).trim() || titleFromUrl(url).slice(0, SONG_TITLE_MAX),
    artist: parsed.artist?.slice(0, SONG_ARTIST_MAX).trim() || null,
    stanzas: parsed.stanzas,
  }
}

// ---------------------------------------------------------------- escrituras

/**
 * Guarda una canción recién rastreada y la sube al inicio del historial en la misma sentencia (`INSERT … ON CONFLICT
 * (source_url) DO UPDATE`): si otra persona la guardó mientras tanto, queda una sola fila (research D6). La hora es la
 * del servidor (milisegundos), la misma precisión que viaja en el cursor del historial.
 */
export async function saveCrawledSong(url: string, content: SongContent, profile: Pick<ProfileRow, 'userId'>): Promise<SongRow> {
  const now = new Date()
  const db = useDb()
  const [[row]] = await db.batch([
    db.insert(songs)
      .values({ sourceUrl: url, title: content.title, artist: content.artist, lyrics: content.stanzas, lastViewedAt: now, lastViewedBy: profile.userId })
      .onConflictDoUpdate({
        target: songs.sourceUrl,
        set: { title: content.title, artist: content.artist, lyrics: content.stanzas, lastViewedAt: now, lastViewedBy: profile.userId, updatedAt: sql`now()` },
      })
      .returning(),
  ])
  if (!row) throw songError('crawl_failed')
  return row
}

/** Registra la vista (FR-027) y devuelve la canción, buscándola por id o por enlace; `undefined` si no existe. */
export async function markSongViewed(by: { id: string } | { url: string }, profile: Pick<ProfileRow, 'userId'>): Promise<SongRow | undefined> {
  const [row] = await useDb()
    .update(songs)
    .set({ lastViewedAt: new Date(), lastViewedBy: profile.userId })
    .where('id' in by ? eq(songs.id, by.id) : eq(songs.sourceUrl, by.url))
    .returning()
  return row
}

export async function findSong(id: string): Promise<SongRow | undefined> {
  const [row] = await useDb().select().from(songs).where(eq(songs.id, id)).limit(1)
  return row
}

/** **Volver a obtener la letra** (FR-010): solo se llama con una letra válida; si el rastreo falló, la fila no cambia. */
export async function replaceLyrics(id: string, content: SongContent): Promise<SongRow | undefined> {
  const [row] = await useDb()
    .update(songs)
    .set({ title: content.title, artist: content.artist, lyrics: content.stanzas, updatedAt: sql`now()` })
    .where(eq(songs.id, id))
    .returning()
  return row
}

// ---------------------------------------------------------------- historial (US4)

/** Orden, condición «después del cursor» y siguiente cursor sobre `(last_viewed_at DESC, id DESC)` (índice `songs_history_idx`). */
export function songHistoryKeyset(cursor: string | undefined, limit: number) {
  const after = decodeCursor(cursor)
  const where = after
    ? sql`(${songs.lastViewedAt}, ${songs.id}) < (${after.v}::timestamptz, ${after.id}::uuid)`
    : undefined
  const orderBy = [desc(songs.lastViewedAt), desc(songs.id)]

  function nextCursor(rows: { id: string, lastViewedAt: Date | null }[]): string | null {
    if (rows.length < limit) return null
    const last = rows[rows.length - 1]!
    return last.lastViewedAt ? encodeCursor({ v: last.lastViewedAt.toISOString(), id: last.id }) : null
  }
  return { where, orderBy, nextCursor }
}

/** Página del historial (FR-027, FR-028) con quién la abrió en el mismo select (sin N+1) y sin la letra. */
export async function listSongHistory({ cursor, limit, exclude }: { cursor?: string, limit: number, exclude?: string }): Promise<SongHistoryPage> {
  const keyset = songHistoryKeyset(cursor, limit)
  const rows = await useDb()
    .select({
      id: songs.id,
      title: songs.title,
      artist: songs.artist,
      sourceUrl: songs.sourceUrl,
      lastViewedAt: songs.lastViewedAt,
      viewerId: profiles.userId,
      viewerName: profiles.name,
      viewerStatus: profiles.status,
    })
    .from(songs)
    .leftJoin(profiles, eq(songs.lastViewedBy, profiles.userId))
    .where(and(
      sql`${songs.lastViewedAt} IS NOT NULL`,
      exclude ? sql`${songs.id} <> ${exclude}::uuid` : undefined,
      keyset.where,
    ))
    .orderBy(...keyset.orderBy)
    .limit(limit)

  const items: SongHistoryItem[] = rows.map(row => ({
    ...toSong(row),
    viewedAt: row.lastViewedAt!.toISOString(),
    viewedBy: row.viewerId ? toSongPerson(row.viewerId, row.viewerName, row.viewerStatus) : null,
  }))
  return { items, nextCursor: keyset.nextCursor(rows) }
}

/** Quita la canción del historial (FR-029). No toca las colecciones; la limpieza diaria la borra si queda huérfana. */
export async function removeSongFromHistory(id: string): Promise<boolean> {
  const rows = await useDb()
    .update(songs)
    .set({ lastViewedAt: null, lastViewedBy: null })
    .where(eq(songs.id, id))
    .returning({ id: songs.id })
  return rows.length > 0
}

// ---------------------------------------------------------------- presentación

/** Nombre de archivo seguro con tildes y eñes: sin / \\ : * ? " < > | ni caracteres de control. */
export function presentationFilename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SONG_TITLE_MAX)
  return `${base || 'cancion'}.pptx`
}

/** `Content-Disposition` propio cuando el servicio no envía uno: ASCII de respaldo y `filename*` en UTF-8. */
export function presentationDisposition(title: string): string {
  const name = presentationFilename(title)
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036F]/g, '').replace(/[^\x20-\x7E]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

// ---------------------------------------------------------------- DTOs

export function toSong(row: Pick<SongRow, 'id' | 'title' | 'artist' | 'sourceUrl'>): Song {
  return { id: row.id, title: row.title, artist: row.artist, sourceUrl: row.sourceUrl }
}

export function toSongDetail(row: SongRow): SongDetail {
  const lyrics = Array.isArray(row.lyrics) ? row.lyrics : []
  return {
    ...toSong(row),
    lyrics,
    lineCount: countLines(lyrics),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toSongPerson(userId: string, name: string | null, status: string | null): SongPerson {
  return { userId, name: name ?? 'Usuario', active: status === 'active' }
}
