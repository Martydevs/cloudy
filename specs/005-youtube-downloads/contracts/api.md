# Contrato de API: Página YouTube

**Feature**: [spec.md](../spec.md) · **Modelo**: [data-model.md](../data-model.md) · **Research**: [research.md](../research.md)

Convenciones existentes: validación con `readValid`/`queryValid` (`server/utils/validation.ts`), errores `createError` con `message` en español (el cliente siempre usa
`serverMessage()`), 429 con `Retry-After`, `Cache-Control: no-store` en lecturas en vivo. Todos los endpoints viven bajo `/api/youtube/**`, **no** están en la lista
`SKIP` de `server/middleware/session.ts` (resuelven sesión y perfil) y llaman `requireRole(event, 'editor')` (el administrador también pasa). Sin sesión → 401; con
rol sin acceso → 403. DTOs: [data-model.md § DTOs](../data-model.md).

El servicio de descargas (`cloudy-api`) se llama **solo** desde `server/utils/cloudy-api.ts` (D1). Tabla de errores del servicio: research D6.

## Servicio de descargas

### `GET /api/youtube/health` — despertar y estado (FR-010)

- Sin parámetros. Llama a `/healthz` del servicio con plazo de 5 s (no usa la clave).
- **200** → `YoutubeServiceHealth`: `up` (responde `status: "ok"`), `down` (responde `503`/degradado) o `waking` (sin respuesta a tiempo o error de red).
- Con `cloudyApiUrl` vacío responde **503** `{ message: "El servicio de descargas no está configurado." }`.

### `GET /api/youtube/videos/:videoId` — ficha y registro en el historial (FR-006, FR-022)

- `:videoId` debe cumplir `^[A-Za-z0-9_-]{11}$`; si no, **404** (como `paramId`).
- **Flujo** (research D10): `probeVideo` → `db.batch([upsert de youtube_videos con last_viewed_*])` → responde.
- **200** → `YoutubeVideoDetail`. Con `downloadable: false`, `reason` explica por qué y la ficha igual se registra.
- Error de video (privado, no encontrado) con fila previa → **200** con los datos guardados, `downloadable: false`, `reason` (`private`, `unavailable`, …).
  Sin fila previa → **404** "No encontramos ese video. Revisa el enlace." y no se registra nada.
- **503** servicio dormido/caído · **502** clave mal configurada (D6).

### `POST /api/youtube/jobs` — crear una descarga o copia de reproducción (FR-007, FR-008, FR-020)

- **Body**: `{ videoIds: string[1..10], format: 'mp4_720' | 'mp4_1080' | 'mp3' }` (`youtubeJobInput`). IDs con el patrón de 11 caracteres; se quitan los repetidos
  conservando el orden. Más de 10 → **422** (el cliente ya parte en lotes).
- Llama a `POST /v1/jobs`; el servicio sondea todos los videos antes de encolar (puede tardar; plazo 45 s).
- **202** → `YoutubeJob` con `status: 'queued'` y el resto vacío (`progress: 0`, `items` con un elemento por video, `downloadUrl: null`).
- **422** `{ data: { videos: [{ videoId, code, message }] } }` si algún video se rechaza (privado, muy largo, en vivo…): no se crea nada.
- **429** cola llena + `Retry-After: 30` · **503** servicio dormido/caído · **502** clave mal configurada.

### `GET /api/youtube/jobs/:jobId` — avance y enlace (FR-008)

- `:jobId` debe ser 32 hex (`^[0-9a-f]{32}$`; es el `uuid4().hex` del servicio); si no, **404**.
- **200** → `YoutubeJob` actualizado. Cuando `status = 'done'` trae `downloadUrl` firmado (~10 min), `filename`, `sizeBytes` y `expiresAt`
  (ISO del vencimiento del archivo). Cada consulta con `done` renueva la firma (D4, D5).
- **404** `{ data: { code: 'expired' } }` si el servicio ya no conoce el trabajo o responde `404`/`410` → el cliente ofrece "Preparar de nuevo".
- `Cache-Control: no-store`. Sin limitador propio (el servicio responde en milisegundos y solo la UI sondea cada 2,5 s).

### `DELETE /api/youtube/jobs/:jobId` — cancelar (FR-009)

- **204**. Si el servicio ya lo olvidó (`404`), también **204** (el resultado buscado ya se cumple).

## Historial

### `GET /api/youtube/history` — historial compartido (FR-023, FR-026)

- **Query**: `cursor?` (keyset, 422 si no es válido), `limit?` (1–48, por defecto 24), `exclude?` (`videoId`; lo usa la fila de la ficha).
- **200** → `YoutubeHistoryPage`, del más reciente al más antiguo, con `viewedBy` resuelto por `LEFT JOIN profiles` (sin N+1).

### `DELETE /api/youtube/history/:videoId` — quitar del historial (FR-025)

- `UPDATE … SET last_viewed_at = NULL, last_viewed_by = NULL` si el video existe. **204**; si no existía o ya estaba fuera, **204** igualmente.
- No toca las listas. La limpieza diaria borra el video si queda huérfano.

## Listas

### `GET /api/youtube/playlists` — fila Listas (FR-016)

- **200** → `{ items: YoutubePlaylist[] }` ordenadas por `updated_at DESC`, con `author`, `itemCount` y hasta 4 `covers` (miniaturas más recientes), en una sola
  sentencia con subconsultas.

### `POST /api/youtube/playlists` — crear (FR-015)

- **Body**: `{ name: string (1–80), videoId?: string }` (`youtubePlaylistInput`). Con `videoId`, la lista nace con ese video en el mismo `db.batch`; si el video no existe en
  `youtube_videos`, **404** y no se crea nada.
- **201** → `YoutubePlaylist`.

### `GET /api/youtube/playlists/:id` — detalle con sus videos (FR-016)

- `paramId` (uuid, 404 si no tiene forma). **200** → `YoutubePlaylistDetail` con `items` por `added_at DESC`, cada uno con `addedBy`. **404** si no existe.

### `PATCH /api/youtube/playlists/:id` — renombrar (FR-017)

- **Body**: `{ name: string (1–80) }`. Solo el autor o `can(role, 'youtube.moderate')`; otro editor → **403** "Solo quien la creó o un administrador puede cambiar esta lista."
- **200** → `YoutubePlaylist`; refresca `updated_at`.

### `DELETE /api/youtube/playlists/:id` — eliminar (FR-017)

- Misma regla de autor o administrador. **204**; la cascada borra sus elementos. No borra videos ni historial.

### `POST /api/youtube/playlists/:id/items` — agregar un video (FR-015, FR-018)

- **Body**: `{ videoId: string }`. **200** → `{ added: boolean }` (`false` si ya estaba, sin duplicar); **404** si la lista o el video no existen. Refresca `updated_at` solo si agregó.
- Cualquier editor o administrador (no exige ser el autor).

### `DELETE /api/youtube/playlists/:id/items/:videoId` — quitar un video (FR-015)

- **204** (idempotente). Refresca `updated_at` si quitó. Cualquier editor o administrador.

## Validadores (`shared/validation/youtube.ts`)

| Validador | Reglas |
|-----------|--------|
| `youtubeVideoId` | `^[A-Za-z0-9_-]{11}$` |
| `youtubeJobInput` | `videoIds`: 1–`MAX_BATCH` (10) IDs válidos, sin repetidos; `format` ∈ `YOUTUBE_FORMATS` |
| `youtubePlaylistInput` | `name` 1–80 recortado; `videoId` opcional válido |
| `youtubePlaylistRename` | `name` 1–80 recortado |
| `youtubeHistoryQuery` | `limit` 1–48 entero, `cursor` opcional, `exclude` opcional válido |
| `parseYoutubeUrl` | texto → `{ ok: true, videoId }` o `{ ok: false, reason }` (research D13); no es un validador de endpoint, lo usa el campo |

## Matriz de acceso

| Endpoint | Sin sesión | `pending` | `editor` | `admin` |
|----------|-----------|-----------|----------|---------|
| Todos los de arriba salvo los marcados | 401 | 403 | ✅ | ✅ |
| `PATCH`/`DELETE /playlists/:id` | 401 | 403 | solo si es autor (si no, 403) | ✅ |

`test/unit/endpoint-guards.spec.ts` incorpora los endpoints nuevos al barrido de "sin sesión y rol incorrecto".
