# Research: Página Canciones

Decisiones de la Fase 0. Formato: **Decisión · Razón · Alternativas**. Los códigos `D#` se citan desde `plan.md`, `data-model.md` y los contratos.

## Fuentes consultadas y sus límites

- **Documentación de Apify**: el servidor MCP del proyecto `apify-webcrawler` (`.mcp.json`, `@apify/actors-mcp-server --tools apify/rag-web-browser`) **no estaba habilitado ni conectado** en la sesión de
  planificación (`enabledMcpjsonServers` solo lista Neon y chrome-devtools), así que no se pudo consultar. Se usaron en su lugar: (1) el esquema OpenAPI público del actor
  (`apify.com/apify/rag-web-browser/api/openapi.json`) y (2) los tipos instalados de `apify-client@2.25.0` (`ActorClient.call`, `ActorCallOptions.waitSecs`, `ApifyApiError.statusCode/type`, opciones
  `baseUrl`/`maxRetries`/`timeoutSecs`). **Tarea de verificación**: con el MCP habilitado, confirmar los puntos marcados «(verificar)» antes de implementar `lyrics-crawler.ts`.
- **Contrato del servicio de presentaciones**: `frontend-lyrics-pptx.md` y el OpenAPI en ejecución de `localhost:8000` (coinciden en ruta, cuerpo y códigos).
- **Letras.com**: una petición HTTP directa devuelve `403` (425 bytes), por eso el rastreo necesita navegador. **No se pudo ver su HTML**, de modo que la estructura de la página (D4) se confirma con un
  fixture real en la primera tarea.

## D1 — Frontera del rastreo: `server/utils/lyrics-crawler.ts`

**Decisión**: un solo módulo, `lyrics-crawler.ts`, importa `apify-client`, lee `apifyApiKey`/`apifyBaseUrl` y exporta `crawlLetras(url): Promise<CrawledPage>`. Los endpoints nunca tocan el SDK.
`architecture.spec.ts` verifica que ningún otro archivo importe `apify-client` ni lea `apifyApiKey`.

**Razón**: Constitución IV (una frontera por proveedor, en `server/utils/` si cabe en un módulo). Mismo patrón que `cloudy-api.ts`.

**Alternativas**: carpeta `server/crawl/` como `server/ai/` (un proveedor y un archivo: sobra); llamar al SDK desde el endpoint (rompe IV y obliga a simular el SDK en cada prueba de endpoint).

## D2 — Llamada al actor con el SDK

**Decisión**: `new ApifyClient({ token, baseUrl?, maxRetries: 2, timeoutSecs: 30 })` por llamada (sin estado entre peticiones) y

```ts
const run = await client.actor('apify/rag-web-browser').call(
  { query: url, maxResults: 1, outputFormats: ['html'], scrapingTool: 'browser-playwright',
    requestTimeoutSecs: 40, removeCookieWarnings: true, htmlTransformer: 'none' },
  { waitSecs: 55 },
)
const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 1 })
```

- `query` con **una URL** hace que el actor la raspe directamente (ignora `maxResults`; lo dejamos en 1 por claridad).
- `outputFormats: ['html']` trae el HTML de la página; `markdown` y `text` pierden la estructura de estrofas.
- `scrapingTool: 'browser-playwright'` (por defecto) es obligatorio: Letras rechaza HTTP plano. `raw-http` queda descartado.
- `htmlTransformer: 'none'` solo quita los elementos de `removeElementsCssSelector` (navegación, cabecera, pie, modales, scripts); no se usa «Readable text» porque podría descartar la letra como contenido
  secundario.
- `waitSecs: 55` acota la espera; si el run sigue `RUNNING` al vencer, `crawlLetras` lo cancela (`client.run(run.id).abort()`, mejor esfuerzo) para no pagar un run huérfano.
- Los campos del item usados son `crawl.httpStatusCode`, `metadata.title` y `html` (esquema del actor). **(verificar con el MCP)**: nombres exactos de los campos y si `crawl.httpStatusCode` llega como número.

**Clasificación de fallos** (a errores en español, nunca el mensaje del actor ni la clave):

| Situación | Resultado |
|-----------|-----------|
| Sin `apifyApiKey` | `503` `notConfigured` (sin llamar a nada) |
| `ApifyApiError` 401/403 | `502` `misconfigured` («avisa a un administrador») |
| `ApifyApiError` 402, o `type` que indique falta de uso/límite **(verificar)** | `503` `quota` («se agotó el crédito del servicio de rastreo») |
| `ApifyApiError` 429 | `503` `busy` |
| run `FAILED` / `TIMED-OUT` / `ABORTED`, sin items, o `RUNNING` tras `waitSecs` | `502` `crawlFailed` (reintentar) |
| `crawl.httpStatusCode` 404, o HTML sin letra | `404` `no_lyrics` (se decide en el endpoint con el parser; el crawler solo entrega `{ html, status }`) |
| Error de red/DNS | `502` `crawlFailed` |

**Razón**: el usuario pidió llamar a Apify por el SDK; `call()` ya espera y sondea el run, y `listItems` lee el dataset sin HTTP a mano.

**Alternativas**: modo Standby del actor por HTTP (no usa el SDK, como se pidió); `start()` + sondeo desde el navegador (convierte el rastreo en un trabajo con estado: más piezas para un paso de ~15 s, ver D15);
`apify-client` en el navegador (expondría el token).

## D3 — Documentación del SDK y del actor

**Decisión**: registrar en la primera tarea de implementación una pasada de verificación con el MCP `apify-webcrawler` (o `search-apify-docs`) para cerrar los «(verificar)» de D2, y guardar los fragmentos
relevantes en comentarios breves del módulo solo si no se infieren del código.

**Razón**: el MCP no estuvo disponible al planificar; no se inventan nombres de campos ni de errores.

## D4 — Extracción y mapeo de la letra (`lyrics-parser.ts`, puro)

**Decisión**: `parseLetrasHtml(html): ParsedLyrics | null` con `{ title, artist, stanzas: string[][] }`:

1. Localiza el elemento con clase `lyric-original` (el contenedor que el propio servicio de presentaciones espera) con un **recorrido por profundidad de etiquetas** (sin expresiones regulares sobre HTML anidado).
2. Cada `<p>` es una estrofa; cada `<br>` separa líneas; se decodifican entidades, se normalizan espacios y se descartan líneas y estrofas vacías.
3. `title` sale del primer `<h1>`; `artist` de una cascada (el elemento que Letras use bajo el `<h1>`, metadatos Open Graph o el `<title>` de la página); si ninguno aparece, `artist = null`.
4. Devuelve `null` si no hay contenedor o quedan 0 líneas (→ `no_lyrics`).

`lyricsToHtml(stanzas, title?)` reconstruye `<div class="lyric-original"><p>l1<br>l2</p>…</div>` con **texto escapado** (el servicio ya sabe leer ese formato). `countLines` suma líneas.

**Tarea 0 (bloqueante del parser)**: capturar con el actor un fixture real de una canción y otro de una página sin letra (`test/unit/fixtures/`), y ajustar la cascada del artista y la lectura de estrofas a lo que
se vea. Hasta tenerlos, la estructura anterior es una hipótesis basada en el contrato del servicio, no en HTML observado.

**Razón**: es la parte de «mapeo» de la Fase 1; al ser pura, se prueba con fixtures y casos límite sin red. Detectar la estructura por profundidad evita que un `</div>` interior corte el contenedor.

**Alternativas**: `node-html-parser`/`linkedom` (dependencia nueva; se adopta solo si el fixture real demuestra que el recorrido no basta, y se registra en Complexity Tracking); mandar al servicio la página entera
(no da título/artista/estrofas a Cloudy, que debe mostrarlas y guardarlas); `markdown` del actor (pierde estructura).

## D5 — Qué se guarda de la letra

**Decisión**: `songs.lyrics` es `jsonb` con `string[][]` (estrofas → líneas). No se guarda HTML crudo ni la página rastreada (FR-034). Para generar, `lyricsToHtml` arma el HTML en el servidor.

**Razón**: se muestra como texto (sin riesgo de XSS), es compacto, el HTML enviado es determinista y escapado, y el número de líneas (`LYRICS_MAX_LINES = 300`) se calcula sin reparsear.

**Alternativas**: guardar el HTML (hay que sanearlo al mostrar y volver a parsearlo para contar); guardar texto plano (pierde la separación de estrofas).

## D6 — Identidad y enlace normalizado

**Decisión**: `parseLetrasUrl(text)` (en `shared/validation/songs.ts`, usado por cliente y servidor) acepta solo `https`, host exacto `letras.com` o `www.letras.com`, sin usuario/contraseña/puerto, y ruta con **exactamente
dos segmentos** `[a-z0-9-]` (`/artista/cancion/`). Devuelve la URL normalizada `https://letras.com/<artista>/<cancion>` (sin `www.`, parámetros, fragmento ni barra final; ruta en minúsculas). `songs.source_url` es
`UNIQUE` sobre ese valor y el `id` (`uuid`) es el de la ruta `/canciones/<id>`.

Motivos de rechazo: `not_url`, `not_https`, `not_letras` (incluye `letras.com.otro.test` y `letras.com@otro.test`), `credentials`, `not_song` (ruta sin dos segmentos). `not_song` evita gastar un rastreo en páginas de
artista/álbum; el mensaje coincide con «No encontramos una letra en ese enlace» del spec para los enlaces de Letras sin canción.

**Razón**: la validación en el servidor es el SSRF-guard real (el cliente es solo comodidad); la normalización cumple FR-006 y evita duplicados.

**Concurrencia**: dos personas pegando el mismo enlace nuevo a la vez pueden rastrear dos veces; el `INSERT … ON CONFLICT (source_url) DO UPDATE` deja una sola fila. No se agrega un bloqueo (YAGNI): ocurre
raramente y solo cuesta un rastreo.

## D7 — Historial en la misma fila, colecciones aparte

**Decisión**: igual que `youtube_videos` (005 D9): `songs.last_viewed_at`/`last_viewed_by` (`NULL` = fuera del historial) con índice parcial `(last_viewed_at DESC, id DESC)`; `song_collections` y
`song_collection_items` copian la forma de `youtube_playlists`/`youtube_playlist_items`. Quitar del historial no borra la canción ni toca las colecciones.

**Razón**: una fila por canción, sin tabla de vistas; las consultas son las de 005, ya probadas.

**Alternativas**: generalizar las tablas y utilidades de 005 en un «catálogo» común (refactor de una feature entregada, riesgo de regresión; se reconsidera al tercer consumidor); tabla `song_views` (crece sin límite).

## D8 — Endpoints y registro del historial

**Decisión**: 13 endpoints bajo `/api/songs/**` ([contracts/api.md](./contracts/api.md)). `POST /api/songs/fetch` resuelve un enlace (guardada → la abre; nueva → rastrea, parsea, inserta) y registra la vista.
`GET /api/songs/[id]` devuelve la ficha y también registra la vista (como `GET /api/youtube/videos/[videoId]`, FR-027). `POST /api/songs/[id]/refresh` vuelve a rastrear y reemplaza la letra solo si el nuevo
rastreo tuvo éxito (FR-010). Las rutas estáticas (`history`, `collections`, `fetch`) conviven con `[id]` porque Nitro resuelve primero lo estático; el parámetro `id` se valida como UUID con `paramId`.

**Razón**: el registro del historial por `GET` es el patrón vigente (005) y evita un segundo viaje desde la ficha.

## D9 — Presentaciones: frontera ampliada en `cloudy-api.ts`

**Decisión**: `createLyricsPptx({ html, title })` en `cloudy-api.ts` (envía `font_color: SONG_FONT_COLOR`, blanco fijo, D12), reutilizando `config()`, `request()` y `fail()`; devuelve `{ bytes, contentDisposition, slideCount, arrangedBy }` leyendo `Content-Disposition`,
`X-Slide-Count` y `X-Lyrics-Arranged-By`. Plazo `CLOUDY_API_TIMEOUTS.pptx = 90_000`. Mapeo en `fail()` para la nueva llamada `'pptx'`:

| Respuesta del servicio | Resultado hacia el navegador |
|------------------------|------------------------------|
| `422` `no_lyrics` | `422` `{ code: 'no_lyrics' }` — «La letra guardada no tiene contenido. Vuelve a obtenerla.» |
| `422` `lyrics_too_long` | `422` `{ code: 'lyrics_too_long' }` — «Eso no parece una canción: pasa de 300 líneas.» |
| `422` lista (cuerpo mal formado) | `502` `invalid` (error nuestro, se registra) |
| `401`/`403` | `502` `misconfigured` |
| `5xx`, red, plazo | `503` `waking` con **Reintentar** |

El endpoint `POST /api/songs/[id]/pptx` valida antes `LYRICS_MAX_LINES` (sin llamar al servicio), arma el HTML y devuelve los bytes con `Content-Type`, `Content-Disposition`, `X-Slide-Count`,
`X-Lyrics-Arranged-By` y `Cache-Control: no-store`. `Content-Disposition` y `X-Slide-Count` se exponen al cliente (mismo origen, no hace falta CORS).

**Razón**: el archivo es de decenas de KB y la clave no puede salir del servidor; es la única excepción acotada a «no retransmitir binarios» (Assumptions del spec). Una sola frontera por servicio.

**Alternativas**: URL firmada directa del servicio (no existe en este endpoint: responde con el archivo); un módulo `lyrics-pptx.ts` aparte (duplicaría `config`/`request`/`fail`).

## D10 — Cola de presentaciones en el cliente

**Decisión**: `useSongPresentations()` mantiene en `useState` una cola de elementos `{ songId, title, status: 'queued'|'running'|'done'|'failed'|'canceled', slides?, arrangedBy?, error?, blobUrl? }` y la
procesa **de una en una** con un `pump` guiado por el propio estado (patrón de `useYoutubeDriveImport`, para que no se quede colgada ni se filtre entre pruebas). Cada elemento tiene su `AbortController`
(mapa de módulo, no estado). Al terminar, el `Blob` se conserva como `objectURL` para **volver a descargar** sin regenerar (borde del navegador que bloquea descargas múltiples) y se revoca al descartar la fila.
Reintento automático: ninguno; **Reintentar** manual solo para `waking`/errores de red, no para `no_lyrics`/`lyrics_too_long` (FR-017). `SongPresentationTray` (lazy en el layout) muestra avance por canción, nota de
reparto de respaldo y **Cancelar** (aborta el activo o saca de la cola al pendiente).

**Razón**: una canción por petición y una a la vez cumple el contrato del servicio gratuito y el plazo de una función; la bandeja ya es un patrón de 005.

**Alternativas**: reutilizar `YoutubeDownloadTray` (acoplada a trabajos de YouTube); un `.zip` con todas (el servicio no lo hace; spec lo excluye).

## D11 — Qué se reutiliza de 005 y qué se duplica

**Se reutiliza tal cual**: `useYoutubeService` + `/api/youtube/health` + `YoutubeServiceBanner` (mismo `cloudy-api`, FR-018: «el estado del servicio MUST compartir el aviso»), `SkeletonList`, `EmptyState`,
`ErrorState`, `ConfirmDialog`, `ActionMenu`, `useApi`/`useApiFetch`, `useToast`, `useConfirm`, `useRelativeTime`, `useFormSchema`, `encodeCursor`/`decodeCursor`, `requireRole`, `readValid`/`queryValid`/`paramId`.

**Se escribe nuevo** (con la forma de su equivalente `Youtube*`): componentes `Song*`, composables `useSong*`, `songs.ts`/`song-collections.ts`. El keyset y el upsert de historial se repiten (~40 líneas) en lugar de generalizar.

**Razón**: reutilizar lo que ya es neutral; no refactorizar una feature entregada para ahorrar duplicación moderada (regla II). Si aparece un tercer consumidor del patrón catálogo/colección/historial, se extrae entonces.

## D12 — Color de letra: blanco fijo

**Decisión** (clarificación 2026-11-05): no hay selector de color. `SONG_FONT_COLOR = 'FFFFFF'` en `shared/constants/songs.ts`; el servidor lo envía siempre como `font_color` y `POST /api/songs/[id]/pptx` no lleva cuerpo.
Junto a **Generar presentación** se muestra el texto `present.whiteHint` («La letra va en blanco: proyecta sobre un fondo oscuro.»).

**Razón**: el equipo siempre proyecta sobre fondo oscuro; un selector era configuración no pedida (YAGNI, Constitución II). `FFFFFF` es dato de la presentación, no un color de la interfaz (VI no aplica).

**Alternativas**: selector Negro/Blanco/`<input type="color">` recordado con `useLocalStorage` (descartado por la persona); negro por defecto del servicio (invisible sobre fondo oscuro).

## D13 — Limpieza diaria

**Decisión**: un paso nuevo en `cron.ts` borra las canciones con `last_viewed_at IS NULL`, sin filas en `song_collection_items` y con `updated_at` de hace más de **30 días**.

**Razón**: la letra guardada ahorra rastreos de pago; 30 días (frente a 24 h de los videos en 005) conserva ese ahorro sin acumular filas muertas. Es código de aplicación (no una acción ad hoc de un agente).

## D14 — Stubs de e2e

**Decisión**:

- `apify-stub.ts`: servidor local que implementa las rutas que usa el SDK para `call()` + `listItems()` (crear run del actor, consultar el run con `waitForFinish`, leer el dataset), con escenarios por URL
  (canción normal, `sin-letra`, `muy-larga`, `fallo-del-run`, `sin-credito`). Las rutas exactas se toman del código del SDK en la tarea de implementación. Se activa con `NUXT_APIFY_BASE_URL`.
- `cloudy-api-stub.ts`: se agrega `POST /v1/lyrics/pptx` (devuelve un `.pptx` mínimo válido con `X-Slide-Count` y `X-Lyrics-Arranged-By`; escenarios `no_lyrics`, `lyrics_too_long`, `fallback`).
- `global-setup.ts` inyecta `NUXT_APIFY_API_KEY=e2e-stub` y `NUXT_APIFY_BASE_URL`.

**Razón**: mismo patrón que OpenRouter y `cloudy-api`; los e2e jamás llaman a Apify, Letras ni Render. `apifyBaseUrl` vacío = Apify real.

## D15 — Duración de las funciones en Vercel

**Decisión**: el rastreo espera hasta 55 s y la generación hasta 90 s. **Confirmado por la persona (2026-11-05)**: el máximo de una función en el proyecto de Vercel es **5 minutos (300 s)**; pasado ese plazo la
plataforma responde `504` con `FUNCTION_INVOCATION_TIMEOUT`. Se fija explícitamente `maxDuration = 120` s (`nitro.vercel.functions.maxDuration` o el equivalente del preset) para que `/api/songs/fetch`, `/refresh` y `/pptx`
no dependan del valor por defecto; T005 lo aplica y lo anota en [quickstart § 6](./quickstart.md). El cliente trata un `504` como fallo transitorio (**Reintentar**), igual que `503 waking`.

**Razón**: 120 s cubre 55 s de rastreo y 90 s de generación con margen y queda muy por debajo del tope de 300 s; una función colgada no corre hasta el máximo. No hay endpoint de sondeo: se evita estado en el servidor.

**Alternativas**: convertir el rastreo en trabajo asíncrono con sondeo (más piezas, más estados); cambiar de plataforma (fuera de alcance).

## D16 — Estrategia de calidad (meta ≥ 92 % por archivo nuevo)

- **Lógica pura y E/S separadas**: `lyrics-parser.ts`, `parseLetrasUrl`, mappers y keyset son funciones puras (cobertura completa con tablas de casos); `lyrics-crawler.ts` y `cloudy-api.ts` se prueban con SDK y
  `fetch` simulados.
- **Ramas de error primero**: cada fila de las tablas de D2 y D9 es un caso de prueba.
- **Endpoints delgados**: validan, llaman a `songs.ts`/frontera y responden; la lógica no vive en el handler.
- **Medición**: `bun run test:coverage` y revisión por archivo de los módulos nuevos (quickstart § 5); el gate global de 92 % no se baja.
- **Convenciones**: `<script setup lang="ts">`, sin `any`, mensajes por `serverMessage()` y `messages.ts`, formularios por `useFormSchema`, solo tokens daisyUI, copy en español, `getByRole`/`getByLabel`.

## D17 — Permisos y terminología

**Decisión**: acción `songs.moderate` (solo `admin`) en `shared/permissions.ts` para renombrar/eliminar colecciones ajenas, igual que `youtube.moderate`. Términos de interfaz: **Canciones**, **Colección(es)**,
**Historial**, **Presentación**, **Letra**. «Lista» solo aparece en 005.

## D18 — Límite de rastreos por persona (fuera de alcance)

**Decisión**: no hay límite por persona ni por red en esta versión (spec: *Outstanding*, bajo impacto: solo el equipo rastrea y las letras guardadas no se rastrean de nuevo). El cliente evita el doble clic con el estado
de espera del campo; el servidor no añade tabla de límites. Si el costo de Apify crece, se agrega un contador en Postgres como el de `rate-limit.ts`.
