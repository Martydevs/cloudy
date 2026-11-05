# Data Model: Página Canciones

Migración Drizzle `0007_*` (generada con `bun run db:generate` desde `server/db/schema.ts`; la persona la aplica a cada rama). Tres tablas, dos índices, sin enums nuevos. Mismas convenciones que `youtube_*`
(`...timestamps` = `created_at`/`updated_at` con `now()`).

## Tablas

### `songs` — canción conocida + historial compartido (D5–D7)

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `uuid` PK `defaultRandom()` | Es el `<id>` de `/canciones/<id>`. |
| `source_url` | `text` NOT NULL **UNIQUE** | URL normalizada: `https://letras.com/<artista>/<cancion>` (D6). |
| `title` | `text` NOT NULL | 1–300 caracteres (se recorta al guardar). |
| `artist` | `text` | `NULL` si la página no lo indica; ≤ 200. |
| `lyrics` | `jsonb` NOT NULL | `string[][]`: estrofas → líneas, sin vacías. Nunca HTML (D5). |
| `last_viewed_at` | `timestamptz` | `NULL` = fuera del historial. |
| `last_viewed_by` | `text` → `profiles.user_id` | Presente si y solo si `last_viewed_at` lo está. |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` cambia al **Volver a obtener la letra**. |

**Índices / restricciones**

- `songs_history_idx` sobre `(last_viewed_at DESC, id DESC) WHERE last_viewed_at IS NOT NULL` — keyset del historial.
- `songs_source_url_key` (UNIQUE) — identidad natural y `ON CONFLICT`.
- CHECK `songs_source_url_format`: `source_url ~ '^https://letras\.com/[a-z0-9-]+/[a-z0-9-]+$'`.
- CHECK `songs_title_length`: `char_length(title) BETWEEN 1 AND 300`.
- CHECK `songs_artist_length`: `artist IS NULL OR char_length(artist) <= 200`.
- CHECK `songs_lyrics_array`: `jsonb_typeof(lyrics) = 'array' AND jsonb_array_length(lyrics) >= 1`.
- CHECK `songs_last_viewed_pair`: `(last_viewed_at IS NULL) = (last_viewed_by IS NULL)`.

Las lecturas de listas (historial, colecciones, recientes) **no seleccionan `lyrics`**; solo `GET /api/songs/[id]`, `refresh` y `pptx` la leen.

### `song_collections` — colección global del equipo

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `uuid` PK `defaultRandom()` | |
| `name` | `text` NOT NULL | 1–80, sin espacios al borde; puede repetirse. |
| `created_by` | `text` NOT NULL → `profiles.user_id` | Autor. |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` sube al renombrar o cambiar canciones. |

- Índice `song_collections_updated_idx` sobre `(updated_at DESC, id)`.
- CHECK `song_collections_name_length`: `char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)`.

### `song_collection_items` — pertenencia (FR-023)

| Columna | Tipo | Notas |
|---------|------|-------|
| `collection_id` | `uuid` NOT NULL → `song_collections.id` `ON DELETE CASCADE` | |
| `song_id` | `uuid` NOT NULL → `songs.id` | Sin cascada: una canción en una colección no se borra. |
| `added_by` | `text` NOT NULL → `profiles.user_id` | |
| `added_at` | `timestamptz` NOT NULL `defaultNow()` | |

- PK `(collection_id, song_id)` — una canción una sola vez por colección.
- Índice `song_collection_items_song_idx` sobre `(song_id)` — limpieza y «¿está en alguna colección?».

## Relaciones

```text
profiles 1──* song_collections (created_by)         profiles 1──* songs (last_viewed_by)
song_collections 1──* song_collection_items *──1 songs
```

## Reglas de negocio → dónde viven

| Regla | Lugar |
|-------|-------|
| Enlace aceptado y normalizado (FR-005, FR-006) | `shared/validation/songs.ts › parseLetrasUrl` (cliente y servidor) |
| Una canción por enlace normalizado (FR-006) | `UNIQUE(source_url)` + `INSERT … ON CONFLICT (source_url) DO UPDATE` |
| Guardar solo con letra completa (FR-009) | Se parsea **antes** del `INSERT`; sin letra → 404 y ninguna escritura |
| ≤ 300 líneas, ≤ 500 000 caracteres (FR-035) | `shared/constants/songs.ts` (`LYRICS_MAX_LINES`, `LYRICS_MAX_CHARS`); el rastreo y `pptx` lo verifican |
| Historial: una entrada por canción, la reciente primero (FR-027, FR-028) | `last_viewed_at/by` + keyset en `songs.ts` |
| Una canción por colección (FR-023) | PK compuesta + `ON CONFLICT DO NOTHING RETURNING` |
| Renombrar/eliminar: autor o `songs.moderate` (FR-022) | `canManageCollection` en `song-collections.ts`; el cliente espeja con `can()` |
| Eliminar colección no elimina canciones (FR-022) | `ON DELETE CASCADE` solo sobre `song_collection_items` |
| Limpieza (D13) | `cron.ts`: canciones sin historial ni colección y con `updated_at` > 30 días |

## Transiciones

**Canción**

```text
(inexistente) ──fetch + rastreo OK──▶ guardada, en historial
guardada ──abrir/fetch──▶ guardada, sube al inicio del historial
guardada ──refresh OK──▶ letra y updated_at reemplazadas (si falla: sin cambios)
en historial ──quitar del historial──▶ guardada, fuera del historial
fuera del historial, sin colección, > 30 días ──limpieza──▶ (borrada)
```

**Elemento de la cola de presentaciones** (solo cliente, D10)

```text
queued ──inicia──▶ running ──OK──▶ done        (conserva blob para volver a descargar)
queued/running ──cancelar──▶ canceled
running ──fallo transitorio──▶ failed ──Reintentar──▶ queued
running ──no_lyrics / lyrics_too_long──▶ failed (definitivo, sin Reintentar)
```

## DTOs (`shared/types/api.ts`)

```ts
export interface SongPerson { userId: string; name: string; active: boolean }

/** Lo que muestran tarjetas e historial (sin letra). */
export interface Song {
  id: string
  title: string
  artist: string | null
  sourceUrl: string
}

export interface SongHistoryItem extends Song {
  viewedAt: string                // ISO
  viewedBy: SongPerson | null
}
export interface SongHistoryPage { items: SongHistoryItem[]; nextCursor: string | null }

/** Ficha: la canción más la letra y fechas. */
export interface SongDetail extends Song {
  lyrics: string[][]              // estrofas → líneas
  lineCount: number
  createdAt: string
  updatedAt: string
}
export interface SongFetchResult { song: SongDetail; crawled: boolean }

export interface SongCollection {
  id: string
  name: string
  author: SongPerson
  itemCount: number               // conteo por subconsulta en el mismo select (sin N+1)
  createdAt: string
  updatedAt: string
}
export interface SongCollectionItem extends Song { addedAt: string; addedBy: SongPerson }
export interface SongCollectionDetail extends SongCollection { items: SongCollectionItem[] }

export type SongFontColor = string  // 'RRGGBB' normalizado
export interface SongPresentationMeta { slideCount: number | null; arrangedBy: 'llm' | 'fallback' | null; filename: string }
export type SongErrorCode =
  | 'not_configured' | 'misconfigured' | 'quota' | 'busy' | 'crawl_failed'
  | 'no_lyrics' | 'lyrics_too_long' | 'waking' | 'invalid'
```

Las colecciones no tienen portada (no hay imágenes: no se rastrean medios); la tarjeta muestra un ícono, el nombre, el conteo y el autor.

## Validadores (`shared/validation/songs.ts`, sobre `validation/core.ts`)

| Validador | Reglas |
|-----------|--------|
| `parseLetrasUrl(text)` | Ver D6; devuelve `{ ok: true, url, artist, slug }` o `{ ok: false, reason }` |
| `songUrlInput` | `{ url }` → `parseLetrasUrl` en el servidor |
| `songFontColor()` | `#?RRGGBB` → `RRGGBB` mayúsculas; opcional, por defecto `000000` |
| `songPresentationInput` | `{ fontColor? }` |
| `songCollectionInput` | `{ name, songId? }` — `name` 1–80 sin espacios al borde; `songId` UUID opcional |
| `songCollectionRename` | `{ name }` |
| `songCollectionItemInput` | `{ songId }` UUID |
| `songHistoryQuery` | `limit` 1–48 (24 por defecto), `cursor` ≤ 500, `exclude` UUID opcional |

Constantes (`shared/constants/songs.ts`): `LYRICS_MAX_LINES = 300`, `LYRICS_MAX_CHARS = 500_000`, `SONG_TITLE_MAX = 300`, `SONG_ARTIST_MAX = 200`, `SONG_COLLECTION_NAME_MAX = 80`, `SONG_HISTORY_PAGE = 24`,
`SONG_HISTORY_MAX_LIMIT = 48`, `SONG_RECENT_LIMIT = 12`, `SONG_DEFAULT_FONT_COLOR = '000000'`, `SONG_PRESENTATION_TIMEOUT_MS = 90_000`, `SONG_SERVICE_MESSAGES`, `SONG_ERROR_MESSAGES`.
