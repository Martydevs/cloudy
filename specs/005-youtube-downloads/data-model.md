# Modelo de datos: Página YouTube

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md) (D9–D11)

Migración Drizzle **`0005`** (`bun run db:generate` desde `server/db/schema.ts`; sin edición manual de la base). Sin enums nuevos y sin cambios en
tablas existentes. Los trabajos de descarga **no** se guardan (viven en el servicio, ver D2).

## `youtube_videos` — video conocido + historial compartido

| Columna | Tipo | Reglas |
|---------|------|--------|
| `video_id` | `text` PK | CHECK `video_id ~ '^[A-Za-z0-9_-]{11}$'` (mismo patrón que el servicio) |
| `title` | `text` NOT NULL | 1–300 caracteres (se recorta al guardar) |
| `channel` | `text` | nulo si el servicio no lo da; ≤ 200 |
| `duration_seconds` | `integer` | nulo en vivo / desconocido; ≥ 0 |
| `thumbnail_url` | `text` | nulo si el servicio no lo da; solo `https://` (se descarta otro esquema) |
| `last_viewed_at` | `timestamptz` | **`NULL` = fuera del historial** |
| `last_viewed_by` | `text` FK → `profiles.user_id` | `NULL` junto con `last_viewed_at` (CHECK: ambos nulos o ambos presentes) |
| `created_at` / `updated_at` | `timestamptz` NOT NULL | `defaultNow()` |

**Índices**:

- `youtube_videos_history_idx` sobre `(last_viewed_at DESC, video_id DESC) WHERE last_viewed_at IS NOT NULL`: paginación del historial (FR-023).
- Ninguno más: el resto de las consultas es por PK.

**Transiciones**:

- Abrir la ficha: `UPSERT` (refresca título/canal/duración/miniatura) y fija `last_viewed_*` (FR-022).
- Quitar del historial (FR-025): `UPDATE … SET last_viewed_at = NULL, last_viewed_by = NULL`. La fila queda si una lista la usa.
- Limpieza diaria: `DELETE` de videos con `last_viewed_at IS NULL`, sin filas en `youtube_playlist_items` y `updated_at` de hace > 24 h.

## `youtube_playlists` — lista global

| Columna | Tipo | Reglas |
|---------|------|--------|
| `id` | `uuid` PK | `defaultRandom()` |
| `name` | `text` NOT NULL | 1–80 caracteres, sin espacios al borde; se permiten repetidos (spec, edge cases) |
| `created_by` | `text` NOT NULL FK → `profiles.user_id` | el autor; `profiles` nunca se borra (estado `removed`), así que la FK siempre resuelve |
| `created_at` / `updated_at` | `timestamptz` NOT NULL | `updated_at` se refresca al renombrar y al agregar/quitar videos |

**Índice**: `youtube_playlists_updated_idx` sobre `(updated_at DESC, id)`: orden de la fila Listas.

## `youtube_playlist_items` — pertenencia

| Columna | Tipo | Reglas |
|---------|------|--------|
| `playlist_id` | `uuid` FK → `youtube_playlists.id` `ON DELETE CASCADE` | |
| `video_id` | `text` FK → `youtube_videos.video_id` | sin cascada: un video no se borra mientras una lista lo use |
| `added_by` | `text` NOT NULL FK → `profiles.user_id` | |
| `added_at` | `timestamptz` NOT NULL | `defaultNow()`; fija el orden dentro de la lista |
| PK | `(playlist_id, video_id)` | **FR-018**: un video una sola vez por lista |

**Índice**: `youtube_playlist_items_video_idx` sobre `video_id` (la limpieza y el borrado de huérfanos comprueban "¿lo usa alguna lista?").

**Agregar un video repetido**: `INSERT … ON CONFLICT DO NOTHING RETURNING` → si no devuelve fila, el endpoint responde `200 { added: false }` y la UI dice
"Ya estaba en la lista" (FR-018).

## `youtube_downloads` — última descarga de cada video

| Columna | Tipo | Reglas |
|---------|------|--------|
| `video_id` | `text` PK, FK → `youtube_videos.video_id` | sin cascada: la limpieza diaria no borra un video mientras tenga aquí su fila |
| `format` | `text` NOT NULL | CHECK `mp4_720` \| `mp4_1080` \| `mp3` |
| `downloaded_by` | `text` NOT NULL FK → `profiles.user_id` | |
| `downloaded_at` | `timestamptz` NOT NULL | `defaultNow()`; la hora del servidor al registrar |

**Una fila por video**: descargarlo otra vez la actualiza, así la tabla no se acumula con repeticiones. **Índice**: `youtube_downloads_recent_idx` sobre
`(downloaded_at DESC, video_id DESC)` para el listado keyset de la sección «Descargas».

## Relaciones y reglas

```text
profiles 1 ─── * youtube_playlists 1 ─── * youtube_playlist_items * ─── 1 youtube_videos
profiles 1 ─── * youtube_videos (last_viewed_by)
```

- Eliminar una lista borra sus elementos (cascada) pero no los videos ni el historial (FR-017).
- Quitar del historial no toca las listas (FR-025).
- Un autor desactivado o eliminado conserva sus listas; el DTO marca `author.active = false` y la UI muestra "Usuario que ya no está activo".
- Agregar a una lista exige que el video exista en `youtube_videos` (si no, `404`): siempre existe porque la ficha lo registró.
- Consultas de la fila Listas sin N+1: el conteo y hasta 4 miniaturas salen de subconsultas en la misma sentencia (research D11).

## DTOs (en `shared/types/api.ts`)

```ts
export type YoutubeFormat = 'mp4_720' | 'mp4_1080' | 'mp3'
export type YoutubeBlockReason = 'too_long' | 'live' | 'unknown_duration' | 'private' | 'unavailable' | 'age_restricted' | 'members_only' | 'geo_restricted'

export interface YoutubePerson { userId: string, name: string, active: boolean }
export interface YoutubeVideo { videoId: string, title: string, channel: string | null, durationSeconds: number | null, thumbnailUrl: string | null }
export interface YoutubeVideoDetail extends YoutubeVideo {
  availableHeights: number[]
  downloadable: boolean
  reason: YoutubeBlockReason | null
}
export interface YoutubeHistoryItem extends YoutubeVideo { viewedAt: string, viewedBy: YoutubePerson | null }
export interface YoutubeHistoryPage { items: YoutubeHistoryItem[], nextCursor: string | null }
export interface YoutubePlaylist { id: string, name: string, author: YoutubePerson, itemCount: number, covers: string[], createdAt: string, updatedAt: string }
export interface YoutubePlaylistItem extends YoutubeVideo { addedAt: string, addedBy: YoutubePerson }
export interface YoutubePlaylistDetail extends YoutubePlaylist { items: YoutubePlaylistItem[] }

export type YoutubeJobStatus = 'queued' | 'running' | 'zipping' | 'done' | 'failed' | 'expired'
export interface YoutubeJobItem { videoId: string, title: string | null, status: 'queued' | 'running' | 'done' | 'failed', progress: number, error: { code: string, message: string } | null, actualHeight: number | null }
export interface YoutubeJob {
  jobId: string
  status: YoutubeJobStatus
  format: YoutubeFormat
  progress: number
  items: YoutubeJobItem[]
  downloadUrl: string | null
  filename: string | null
  sizeBytes: number | null
  expiresAt: string | null
}
export interface YoutubeServiceHealth { state: 'up' | 'waking' | 'down' }
```

`YoutubeBlockReason` junta los motivos de `downloadable: false` del servicio (`too_long`, `live`, `unknown_duration`) con los códigos de error de video de
la sonda (research D10).
