# Contrato de API: `/api/songs/**` y fronteras externas

Todos los endpoints: `requireRole(event, 'editor')` (editores y administradores), entrada validada con `readValid`/`queryValid`/`paramId`, `Cache-Control: no-store` en lecturas. Errores con el cuerpo habitual de Nitro
(`statusCode`, `message` en español, `data` opcional); el navegador solo muestra `serverMessage()`. Ningún cuerpo ni registro lleva `NUXT_APIFY_API_KEY` ni `NUXT_CLOUDY_API_KEY`.

Estado del servicio (despertar y aviso): **se reutiliza** `GET /api/youtube/health` (mismo `cloudy-api`, D11); no hay endpoint nuevo.

## Resumen

| # | Método y ruta | Historia | Qué hace |
|---|---------------|----------|----------|
| 1 | `POST /api/songs/fetch` | US1 | Resuelve un enlace: guardada → abre; nueva → rastrea, parsea, guarda. Registra la vista |
| 2 | `GET /api/songs/[id]` | US1 | Ficha con letra; registra la vista (FR-027) |
| 3 | `POST /api/songs/[id]/refresh` | US1 | Vuelve a rastrear y reemplaza la letra si el rastreo tuvo éxito |
| 4 | `POST /api/songs/[id]/pptx` | US2 | Genera y devuelve el `.pptx` |
| 5 | `GET /api/songs/history` | US4 | Página del historial (keyset) |
| 6 | `DELETE /api/songs/history/[id]` | US4 | Quita del historial |
| 7 | `GET /api/songs/collections` | US3 | Todas las colecciones |
| 8 | `POST /api/songs/collections` | US3 | Crea (con canción opcional, un solo `db.batch`) |
| 9 | `GET /api/songs/collections/[id]` | US3 | Colección con sus canciones |
| 10 | `PATCH /api/songs/collections/[id]` | US3 | Renombra (autor o `songs.moderate`) |
| 11 | `DELETE /api/songs/collections/[id]` | US3 | Elimina (autor o `songs.moderate`) |
| 12 | `POST /api/songs/collections/[id]/items` | US3 | Agrega una canción sin duplicar |
| 13 | `DELETE /api/songs/collections/[id]/items/[songId]` | US3 | Quita una canción |

`[id]`/`[songId]` son UUID; si no lo son, `404` sin consultar nada (`paramId`).

## 1. `POST /api/songs/fetch`

Cuerpo: `{ "url": string }` → `songUrlInput` (`parseLetrasUrl`; D6).

Flujo: normalizar → si `songs.source_url` existe: `upsertSongView` y responder `{ song, crawled: false }` **sin llamar a Apify** → si no: `crawlLetras(url)` → `parseLetrasHtml` → verificar límites →
`INSERT … ON CONFLICT (source_url) DO UPDATE` + vista en un `db.batch` → `201 { song, crawled: true }`.

| Estado | Condición | `data.code` |
|--------|-----------|-------------|
| `200` / `201` | Guardada / rastreada | — |
| `400` | Enlace no válido (revalida en servidor) | `data.reason` ∈ `not_url`, `not_https`, `not_letras`, `credentials`, `not_song` |
| `404` | Sin letra (página 404, sin `lyric-original`, 0 líneas) | `no_lyrics` |
| `422` | Más de 300 líneas / 500 000 caracteres | `lyrics_too_long` |
| `502` | Clave de Apify inválida / run fallido, vencido o sin items | `misconfigured` / `crawl_failed` |
| `503` | Sin configurar / sin crédito / ocupado | `not_configured` / `quota` / `busy` |

Un fallo **no escribe nada** (FR-009).

## 2. `GET /api/songs/[id]`

`200 SongDetail` y registra la vista en el mismo `db.batch`. `404` si no existe.

## 3. `POST /api/songs/[id]/refresh`

Sin cuerpo. Rastrea `source_url`, parsea y **solo si hay letra válida** actualiza `lyrics`, `title`, `artist`, `updated_at`; responde `200 SongDetail`. Errores como el # 1 (`no_lyrics` deja la letra anterior intacta).

## 4. `POST /api/songs/[id]/pptx`

Sin cuerpo. El color de letra es fijo: blanco (`SONG_FONT_COLOR = 'FFFFFF'`, D12).

Flujo: leer canción → `countLines > 300` → `422 lyrics_too_long` sin llamar al servicio → `lyricsToHtml(stanzas)` → `createLyricsPptx({ html, title })` (frontera `cloudy-api.ts`, plazo 90 s) →
responder los bytes.

Éxito `200`, cuerpo binario, cabeceras:

| Cabecera | Valor |
|----------|-------|
| `Content-Type` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| `Content-Disposition` | la del servicio (`attachment; filename="Canción.pptx"; filename*=UTF-8''Canci%C3%B3n.pptx`); si falta, una propia con el título saneado |
| `X-Slide-Count` | número de diapositivas |
| `X-Lyrics-Arranged-By` | `llm` o `fallback` |
| `Cache-Control` | `no-store` |

Errores (D9):

| Estado | `data.code` | Texto |
|--------|-------------|-------|
| `404` | — | La canción ya no existe |
| `422` | `no_lyrics` | La letra guardada no tiene contenido. Vuelve a obtenerla. |
| `422` | `lyrics_too_long` | Eso no parece una canción: pasa de 300 líneas. |
| `502` | `misconfigured` / `invalid` | Servicio mal configurado / petición rechazada (error nuestro, se registra) |
| `503` | `waking` / `not_configured` | Servicio despertando o caído; **Reintentar** / no configurado |

El cliente **no reintenta** `422`; reintenta (manual) solo `503`, `504` (`FUNCTION_INVOCATION_TIMEOUT` de Vercel, D15) y red.

## 5–6. Historial

`GET /api/songs/history?limit&cursor&exclude` → `SongHistoryPage` (`limit` 1–48, 24 por defecto; `exclude` = canción actual en la ficha). Orden `(last_viewed_at DESC, id DESC)`, keyset con `encodeCursor/decodeCursor`;
**sin `lyrics`**. `DELETE /api/songs/history/[id]` → `204`; no toca las colecciones; `404` si no existe.

## 7–13. Colecciones

| Ruta | Cuerpo | Respuesta |
|------|--------|-----------|
| `GET /collections` | — | `{ items: SongCollection[] }` (más reciente primero; conteo por subconsulta) |
| `POST /collections` | `{ name, songId? }` | `201 SongCollection`; con `songId` la colección nace con esa canción en un `db.batch`; si la canción no existe, `404` y no se crea nada |
| `GET /collections/[id]` | — | `SongCollectionDetail` |
| `PATCH /collections/[id]` | `{ name }` | `200 SongCollection`; `403` si no es el autor ni `songs.moderate` |
| `DELETE /collections/[id]` | — | `204`; `403` igual; las canciones siguen en el historial |
| `POST /collections/[id]/items` | `{ songId }` | `200 { added: boolean }` (`false` = ya estaba); sube la colección al inicio |
| `DELETE /collections/[id]/items/[songId]` | — | `204` |

Agregar o quitar canciones lo puede hacer cualquier editor o admin (FR-021).

## Frontera 1 — Apify (`server/utils/lyrics-crawler.ts`)

```ts
export interface CrawledPage { html: string | null; status: number | null; finalUrl: string | null }   // status = crawl.httpStatusCode; finalUrl = metadata.redirectedUrl ?? metadata.url
export async function crawlLetras(url: string): Promise<CrawledPage>           // lanza createError ya traducido (D2)
```

- Lee `apifyApiKey` y `apifyBaseUrl` de `useRuntimeConfig()`; sin clave: `503 not_configured` sin llamar.
- Letras.com redirige un enlace de canción inexistente a **otra** canción con `200` (research D2, hallazgo de T003): el endpoint compara `parseLetrasUrl(finalUrl).url` con el enlace pedido y, si difieren, responde `404 no_lyrics` sin escribir nada.
- Llamada, opciones y tabla de fallos: [research D2](../research.md). Nunca se devuelven ni se registran el mensaje del actor, la URL del run ni el token; el registro lleva solo estado/tipo (`[lyrics-crawler] call → 402`).
- El SDK se instancia por llamada (funciones sin estado) y solo aquí se importa `apify-client`.

## Frontera 2 — `cloudy-api.ts` (ampliación)

```ts
export interface LyricsPptx { bytes: Uint8Array; contentDisposition: string | null; slideCount: number | null; arrangedBy: 'llm' | 'fallback' | null }
export async function createLyricsPptx(input: { html: string; title: string }): Promise<LyricsPptx>
```

- `POST {cloudyApiUrl}/v1/lyrics/pptx`, `X-API-Key`, cuerpo `{ html, title, font_color: SONG_FONT_COLOR }` (`'FFFFFF'`, D12), plazo `CLOUDY_API_TIMEOUTS.pptx = 90_000`.
- Lee los bytes con `arrayBuffer()` y las cabeceras `content-disposition`, `x-slide-count`, `x-lyrics-arranged-by` (valores desconocidos → `null`).
- Errores y mapeo: [research D9](../research.md). `fail()` gana el caso `'pptx'` sin cambiar los existentes.

## Validadores y reglas compartidas

[data-model.md § Validadores](../data-model.md). El cliente usa los mismos (`songUrlSchema`, `songCollectionSchema` en `app/utils/form-schemas.ts`); `test/nuxt/form-schemas.spec.ts` vigila la paridad.

## Pruebas que ejercen este contrato

- `endpoint-guards.spec.ts`: los 13 archivos existen, usan `requireRole(event, 'editor')` y ninguno es público ni de cron.
- `api-songs-*.spec.ts` (unit, `useDb` y fronteras simulados): éxito y cada código de error de las tablas; sin escrituras ante fallo; `pptx` sin llamar al servicio cuando la letra pasa de 300 líneas.
- `architecture.spec.ts`: `apify-client` solo en `lyrics-crawler.ts`; `apifyApiKey` solo ahí; `cloudyApiKey` solo en `cloudy-api.ts`.
