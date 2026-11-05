---
description: "Task list for Cloudy — Página Canciones: letras de Letras.com a presentaciones PowerPoint (feature 006)"
---

# Tasks: Página Canciones — letras de Letras.com a presentaciones PowerPoint

**Input**: Documentos de diseño en `specs/006-canciones-lyrics-pptx/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D18), data-model.md, contracts/api.md, contracts/ui.md, quickstart.md · Constitución v1.1.1 · Base: features 001–005 (sobre todo 005: `cloudy-api.ts`, `useYoutubeService`, `YoutubeServiceBanner` y la forma de los componentes `Youtube*`)

**Tests**: **Requeridos** por la Constitución V y por el plan ("V. Pruebas"). Cada historia tiene tests unitarios (`test/unit`), de componente (`test/nuxt`) y e2e (`test/e2e`, contra los stubs de Apify y `cloudy-api`). Dentro de cada historia los tests se escriben antes que la implementación y deben fallar primero. Meta de la feature: **≥ 92 % en sentencias, ramas, funciones y líneas por archivo nuevo** (research D16).

**Organization**: Las tareas se agrupan por historia de usuario en orden de prioridad (US1 P1 → US2 P2 → US3 P3 → US4 P4) y **cada historia se puede desplegar sola** una vez terminadas las anteriores (Constitución II). US1 es el MVP y corresponde a la **Fase 1** del spec (enlace → rastreo → letra guardada y visible). US2 es la **Fase 2** (presentación `.pptx` desde el servicio ya implementado). US3 agrega colecciones y su generación por lotes. US4 agrega el historial, la selección múltiple y la limpieza diaria. Lo compartido (constantes, validadores, permiso, DTOs, tablas, mensajes, esquemas de formulario, configuración) es fundacional.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede ejecutar en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: la historia de usuario de spec.md a la que pertenece la tarea (US1…US4).

## Convenciones obligatorias para quien implemente (de AGENTS.md, la constitución y el plan)

- **Fronteras con proveedores** (research D1, D9): solo `server/utils/lyrics-crawler.ts` importa `apify-client` y lee `apifyApiKey`/`apifyBaseUrl`; solo `server/utils/cloudy-api.ts` lee `cloudyApiUrl`/`cloudyApiKey` y hace `fetch` al servicio de presentaciones. Los endpoints `/api/songs/**` llaman a `crawlLetras` y `createLyricsPptx`, nunca al SDK ni al servicio directo. Ninguna clave aparece en respuestas, logs ni el cliente (SC-010); los logs llevan solo estado/tipo (`[lyrics-crawler] call → 402`).
- **Parser puro** (D4–D5): `server/utils/lyrics-parser.ts` no importa nada de red ni del SDK; la letra se guarda como `string[][]` (`jsonb`), **nunca HTML**; el HTML que va al servicio se reconstruye con texto escapado en cada generación. La letra se muestra como texto (sin `v-html`).
- **Endpoints**: los 13 llaman `requireRole(event, 'editor')` (deja pasar a admins) y validan con `readValid`/`queryValid`/`paramId` de `server/utils/validation.ts`. No están en la lista `SKIP` de `server/middleware/session.ts`. Errores con `createError`, `message` en español y `data.code`/`data.reason` según `contracts/api.md`; el cliente los muestra solo con `serverMessage(error, fallback, byStatus)` (y nombra explícitamente los `503`: `waking`/`busy`/`quota`/`not_configured`).
- **Sin huérfanos** (FR-009): se parsea y se validan límites **antes** de cualquier `INSERT`; un rastreo fallido o sin letra no escribe nada. `refresh` reemplaza la letra solo si el nuevo rastreo tuvo éxito. Crear colección con canción va en un solo `db.batch`.
- **Binarios** (Principio I, D9): el `.pptx` (decenas de KB) es la única excepción acotada a "no retransmitir binarios": pasa por `POST /api/songs/[id]/pptx` porque la clave no puede salir del servidor. Las presentaciones no se guardan en el bucket ni en la base (FR-034).
- **Reglas compartidas una sola vez**: límites y textos por código en `shared/constants/songs.ts`; `parseLetrasUrl` y validadores en `shared/validation/songs.ts` (validadores propios del proyecto sobre `validation/core.ts`, no Zod); DTOs en `shared/types/api.ts`; el permiso `songs.moderate` en `shared/permissions.ts`.
- **Datos** (data-model.md): tablas solo con migración Drizzle generada (`bun run db:generate` → `drizzle/0007_*.sql`). Las listas (historial, colecciones, recientes) **no seleccionan `lyrics`**; el conteo de colecciones va por subconsulta (sin N+1); el historial usa keyset `(last_viewed_at DESC, id DESC)` con `encodeCursor`/`decodeCursor` de `server/utils/pagination.ts`.
- **Estado del cliente**: la cola de presentaciones vive en `useState` (`songs-presentations`), se procesa **de una en una** con un `pump` guiado por el propio estado (patrón de `useYoutubeDriveImport`); los `AbortController` y `objectURL` en un mapa de módulo, no en el estado. La bandeja es `Lazy*` con `v-if`. Un doble clic lanza una sola generación (FR-019).
- **Formularios**: `songUrlSchema` y `songCollectionSchema` en `app/utils/form-schemas.ts`, siempre por `useFormSchema`; nunca `useRegle`/`useRegleSchema` directo.
- **Interfaz**: forma de la página YouTube (contracts/ui.md, columna "Equivale a"); textos en español en `app/utils/messages.ts` (bloque `songs`) y `shared/constants/songs.ts`; clases semánticas de daisyUI; iconos `lucide:*`; `btn` base (como máximo `lg:btn-sm`); cuatro estados (`SkeletonList`, `EmptyState`, `ErrorState`, contenido); `ConfirmDialog` antes de eliminar, quitar o **Volver a obtener la letra**; toast al terminar acciones; nada depende de `hover`; 360 px sin scroll horizontal; objetivos táctiles ≥ 44 px; sin `text-warning` sobre `base-100` claro. Los colores `000000`/`FFFFFF` de la presentación son dato, no colores de interfaz.
- **Tests**: seleccionan con `getByRole`/`getByLabel`. Los e2e usan `signedInAs`/`ensureAccount`/`login` de `test/e2e/setup/fixtures.ts` y **nunca** llaman a Apify, Letras.com ni Render: van contra `test/e2e/setup/apify-stub.ts` y `test/e2e/setup/cloudy-api-stub.ts`. Un rastreo real cuesta crédito: las pruebas manuales usan pocas canciones.
- **Agentes**: nada destructivo contra ninguna base ni bucket (AGENTS.md, "No destructive actions"). Las migraciones las aplica la persona (`bun run db:migrate`, `bun run db:migrate:test`); el agente pide permiso antes de cualquier comando de base de datos. El agente no borra ni descarta archivos sin versionar.
- **Definición de hecho por tarea y por fase**: la de AGENTS.md ("Workflow"): typecheck → tests → verificación en navegador al final (360 px y ≥ 1280 px, tema oscuro y claro, cuatro estados, foco y consola) → reporte antes de marcar la tarea.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirmar el punto de partida, cerrar las verificaciones abiertas del research (D2, D3, D4, D15) y dejar la configuración lista.

- [ ] T001 Confirmar la rama activa con `git branch --show-current`: debe ser `006-canciones-lyrics-pptx` (al generar estas tareas la rama activa era `main`). Si no coincide, detenerse y pedir a la persona que cree/cambie de rama; el agente no crea ni cambia de rama. Confirmar que `.specify/feature.json` (si existe) apunta a `specs/006-canciones-lyrics-pptx`.
- [ ] T002 Agregar `apifyBaseUrl: ''` junto a `apifyApiKey: ''` en `runtimeConfig` (privado, no en `public`) de `nuxt.config.ts`, y `NUXT_APIFY_BASE_URL=` (vacío = Apify real) en `.env.example` junto a `NUXT_APIFY_API_KEY`. Verificar que `apify-client@2.25.0` ya está en `package.json` (sin dependencias nuevas). La persona añade los valores a `.env.development`, `.env.test` y `.env`; el agente no imprime ni escribe valores.
- [ ] T003 Verificación del SDK y del actor (research D2–D3): con el MCP `apify-webcrawler` (o `search-apify-docs`) habilitado — si no lo está, pedir a la persona que lo habilite en `.mcp.json`/ajustes — confirmar los puntos «(verificar)»: nombres exactos de los campos del item (`crawl.httpStatusCode` numérico, `metadata.title`, `html`), el `type`/`statusCode` de `ApifyApiError` para falta de crédito o límite de uso, y las rutas HTTP que usan `client.actor(id).call()` + `client.run(id).abort()` + `client.dataset(id).listItems()` (necesarias para el stub de T024). Anotar el resultado en `specs/006-canciones-lyrics-pptx/research.md` (D2, sustituyendo cada «(verificar)» por lo confirmado).
- [ ] T004 Tarea 0 — fixtures reales (bloquea el parser, research D4, quickstart §1): con el actor y las opciones de D2, rastrear `https://www.letras.com/musiko/de-buenas-part-josh-gamez/` y guardar el `html` del item en `test/unit/fixtures/letras-song.html`; rastrear una página de Letras sin letra (página de artista) y guardarla en `test/unit/fixtures/letras-no-lyrics.html`. Confirmar en el fixture: contenedor `lyric-original`, estrofas en `<p>` con líneas por `<br>`, `<h1>` del título y dónde aparece el artista. Si la estructura difiere, actualizar D4 en `research.md` antes de T020; si el recorrido sin dependencias no basta, registrar la dependencia nueva en Complexity Tracking de `plan.md` y pedir aprobación.
- [ ] T005 Duración de funciones en Vercel (research D15): confirmar el plazo máximo vigente del proyecto (Fluid Compute y plan) y fijar en `nuxt.config.ts` (`nitro.vercel.functions.maxDuration` o el equivalente del preset) un valor ≥ 120 s que cubra `/api/songs/fetch`, `/api/songs/[id]/refresh` y `/api/songs/[id]/pptx`. Anotar el valor confirmado y la fecha en `specs/006-canciones-lyrics-pptx/quickstart.md` § 6 (reemplaza "_pendiente de la primera tarea_"). Si no se puede superar 60 s, bajar `waitSecs` (D2) y `SONG_PRESENTATION_TIMEOUT_MS`, y anotarlo.

**Checkpoint**: rama confirmada, configuración lista, SDK verificado, fixtures reales en el repo y plazo de funciones fijado.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Constantes, validadores, permiso, DTOs, tablas, mensajes y esquemas de formulario. Ninguna historia empieza antes de terminar esta fase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests fundacionales (escribir primero, deben fallar)

- [ ] T006 [P] Tests unitarios de `parseLetrasUrl` en `test/unit/songs-url.spec.ts` (research D6): acepta `https://www.letras.com/musiko/de-buenas-part-josh-gamez/`, la misma sin `www.`, sin barra final, con `?utm_source=x`, con `#letra` y con espacios al borde, y **todas** devuelven `{ ok: true, url: 'https://letras.com/musiko/de-buenas-part-josh-gamez', artist: 'musiko', slug: 'de-buenas-part-josh-gamez' }`; la ruta se pasa a minúsculas. Rechaza con `reason` exacto: `''` y texto libre (`not_url`), `http://www.letras.com/a/b/` (`not_https`), `https://example.com/a/b`, `https://letras.com.otro.test/a/b/` y `https://evil-letras.com/a/b` (`not_letras`), `https://letras.com@otro.test/a/b/` y `https://user:pass@letras.com/a/b/` (`credentials` o `not_letras` según el host real; el host `otro.test` debe dar `not_letras`), `https://letras.com:8443/a/b/` (`not_letras`), `https://www.letras.com/`, `https://www.letras.com/musiko/` y `https://www.letras.com/a/b/c/` (`not_song`, ruta que no tiene exactamente dos segmentos `[a-z0-9-]`).
- [ ] T007 [P] Tests unitarios de `shared/constants/songs.ts` y `shared/validation/songs.ts` en `test/unit/songs-validation.spec.ts`: `LYRICS_MAX_LINES === 300`, `LYRICS_MAX_CHARS === 500_000`, `SONG_TITLE_MAX === 300`, `SONG_ARTIST_MAX === 200`, `SONG_COLLECTION_NAME_MAX === 80`, `SONG_HISTORY_PAGE === 24`, `SONG_HISTORY_MAX_LIMIT === 48`, `SONG_RECENT_LIMIT === 12`, `SONG_DEFAULT_FONT_COLOR === '000000'`, `SONG_PRESENTATION_TIMEOUT_MS === 90_000`; `songFontColor()` acepta `#ffffff`, `FFFFFF`, `#1a2B3c` y devuelve `FFFFFF`/`1A2B3C` (mayúsculas sin `#`), usa `000000` si falta, y rechaza `#fff`, `GGGGGG`, `#1234567`; `songPresentationInput` acepta `{}` y `{ fontColor }`; `songCollectionInput` acepta `name` de 1–80 caracteres recortado y `songId` UUID opcional, rechaza vacío, solo espacios, 81 caracteres y `songId` no UUID; `songCollectionRename` igual para `name`; `songCollectionItemInput` exige `songId` UUID; `songHistoryQuery` acepta `limit` 1–48 entero (24 por defecto), `cursor` ≤ 500 caracteres y `exclude` UUID opcional, rechaza `limit` 0 y 49. `SONG_ERROR_MESSAGES` tiene texto no vacío en español para cada `SongErrorCode` (`not_configured`, `misconfigured`, `quota`, `busy`, `crawl_failed`, `no_lyrics`, `lyrics_too_long`, `waking`, `invalid`) y para cada `reason` de URL (`not_url`, `not_https`, `not_letras`, `credentials`, `not_song`) con los textos de contracts/ui.md § Textos.
- [ ] T008 [P] Ampliar `test/unit/permissions.spec.ts`: `can('admin', 'songs.moderate')` es `true`; `can('editor', 'songs.moderate')`, `can(null, …)` y `can(undefined, …)` son `false`; el resto de la matriz no cambia.
- [ ] T009 [P] Ampliar `test/unit/architecture.spec.ts` con las reglas de frontera (research D1, contracts/api.md): ningún archivo de `server/`, `app/` ni `shared/` fuera de `server/utils/lyrics-crawler.ts` importa `apify-client` ni contiene `apifyApiKey`/`apifyBaseUrl`; ningún archivo de `app/` ni `shared/` importa `server/utils/lyrics-crawler`; `server/utils/lyrics-parser.ts` no importa `apify-client`, `#imports`, `useRuntimeConfig` ni hace `fetch(`; la regla existente de `cloudyApiKey`/`cloudyApiUrl` solo en `cloudy-api.ts` sigue igual. La prueba lee los fuentes reales, como las demás reglas del archivo.
- [ ] T010 [P] Ampliar `test/nuxt/form-schemas.spec.ts` con la paridad de `songUrlSchema` (mismos aceptados/rechazados y mismos mensajes que `parseLetrasUrl` + `SONG_ERROR_MESSAGES`) y `songCollectionSchema` (mismos límites y mensajes que `songCollectionInput`).

### Implementación fundacional

- [ ] T011 [P] Crear `shared/constants/songs.ts` con las constantes de T007 (data-model.md § Constantes), el tipo `SongErrorCode`, `SONG_ERROR_MESSAGES` (textos de contracts/ui.md: `fetch.*`, `present.*`, `url.*`) y `SONG_SERVICE_MESSAGES`, más los presets de color `{ black: '000000', white: 'FFFFFF' }`.
- [ ] T012 [P] Crear `shared/validation/songs.ts` sobre `shared/validation/core.ts`: `parseLetrasUrl(text)` → `{ ok: true, url, artist, slug } | { ok: false, reason }` (solo `https`, host exacto `letras.com`/`www.letras.com`, sin usuario/contraseña/puerto, exactamente dos segmentos `[a-z0-9-]`, salida `https://letras.com/<artista>/<cancion>` sin `www.`, parámetros, fragmento ni barra final), `songUrlInput`, `songFontColor`, `songPresentationInput`, `songCollectionInput` (`name` 1–80 "sin espacios al borde", `songId?` UUID), `songCollectionRename`, `songCollectionItemInput`, `songHistoryQuery` (`limit` 1–48, 24 por defecto; `cursor` ≤ 500; `exclude` UUID opcional). Hace pasar T006–T007.
- [ ] T013 [P] Agregar la acción `songs.moderate` (solo `admin`) en `shared/permissions.ts`, igual que `youtube.moderate`. Hace pasar T008.
- [ ] T014 [P] Agregar a `shared/types/api.ts` los DTOs de data-model.md § DTOs tal cual: `SongPerson`, `Song`, `SongHistoryItem`, `SongHistoryPage`, `SongDetail`, `SongFetchResult`, `SongCollection`, `SongCollectionItem`, `SongCollectionDetail`, `SongFontColor`, `SongPresentationMeta` (`arrangedBy: 'llm' | 'fallback' | null`) y `SongErrorCode` (reexportado desde `shared/constants/songs.ts` si ya vive ahí, sin duplicar).
- [ ] T015 Agregar a `server/db/schema.ts` las tablas de data-model.md: `songs` (`id` uuid PK `defaultRandom()`; `source_url` text NOT NULL UNIQUE `songs_source_url_key`; `title` text NOT NULL; `artist` text; `lyrics` jsonb NOT NULL tipado `string[][]`; `last_viewed_at` timestamptz; `last_viewed_by` text → `profiles.user_id`; `...timestamps`), con índice parcial `songs_history_idx` sobre `(last_viewed_at DESC, id DESC) WHERE last_viewed_at IS NOT NULL` y CHECKs `songs_source_url_format` (`source_url ~ '^https://letras\.com/[a-z0-9-]+/[a-z0-9-]+$'`), `songs_title_length` (`char_length(title) BETWEEN 1 AND 300`), `songs_artist_length` (`artist IS NULL OR char_length(artist) <= 200`), `songs_lyrics_array` (`jsonb_typeof(lyrics) = 'array' AND jsonb_array_length(lyrics) >= 1`), `songs_last_viewed_pair` (`(last_viewed_at IS NULL) = (last_viewed_by IS NULL)`); `song_collections` (`id` uuid PK; `name` text NOT NULL; `created_by` text NOT NULL → `profiles.user_id`; `...timestamps`; índice `song_collections_updated_idx` sobre `(updated_at DESC, id)`; CHECK `song_collections_name_length`: `char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)`); `song_collection_items` (`collection_id` uuid NOT NULL → `song_collections.id` `ON DELETE CASCADE`; `song_id` uuid NOT NULL → `songs.id` **sin cascada**; `added_by` text NOT NULL → `profiles.user_id`; `added_at` timestamptz NOT NULL `defaultNow()`; PK `(collection_id, song_id)`; índice `song_collection_items_song_idx` sobre `(song_id)`). Sin enums nuevos.
- [ ] T016 Generar la migración con `bun run db:generate` y revisar que `drizzle/0007_*.sql` crea exactamente las 3 tablas, los índices y los 6 CHECK, sin `DROP` ni cambios a tablas existentes. **No aplicarla**: pedir a la persona que ejecute `bun run db:migrate` (development) y `bun run db:migrate:test` (test) y esperar su confirmación.
- [ ] T017 [P] Agregar el bloque `songs` a `app/utils/messages.ts` con los textos de contracts/ui.md § Textos (`url.*`, `fetch.*`, `present.*` con `done(n)`/`filesCount(n)` como funciones, `refresh.*`, `collection.*` con las mismas frases que `youtube.playlists` cambiando "lista" por "colección", toasts de cada acción completada de FR-032, copia de `ErrorState`), reutilizando `messages.youtube.inactiveUser` para el usuario inactivo. Ampliar `test/unit/messages.spec.ts` si cubre la forma del bloque.
- [ ] T018 [P] Agregar `songUrlSchema` y `songCollectionSchema` (zod `zod/mini`, mensajes y límites tomados de `shared/constants/songs.ts`/`shared/validation/songs.ts`) en `app/utils/form-schemas.ts`. Hace pasar T010.
- [ ] T019 Ejecutar `bun run typecheck`, `bun run test:unit` y `bun run test:nuxt`; los tests T006–T010 deben pasar.

**Checkpoint**: reglas compartidas, tablas migradas (por la persona), mensajes y esquemas listos. Las historias pueden empezar.

---

## Phase 3: User Story 1 - Pegar un enlace de Letras.com y obtener la letra (Priority: P1) 🎯 MVP (Fase 1)

**Goal**: Un administrador o editor pega un enlace de Letras.com en `/canciones`; Cloudy lo valida (cliente y servidor), lo rastrea con `apify/rag-web-browser` solo si es nuevo, extrae título/artista/estrofas, guarda la canción y navega a `/canciones/<id>`, que muestra metadatos → acciones → letra. **Volver a obtener la letra** reemplaza la letra solo si el nuevo rastreo tiene éxito.

**Independent Test**: pegar `https://www.letras.com/musiko/de-buenas-part-josh-gamez/`, llegar a la ficha con título y letra por estrofas; volver a pegar el mismo enlace con `?utm_source=x` y sin `www.` y comprobar que abre la misma canción sin un nuevo rastreo (quickstart §2).

### Tests for User Story 1 (escribir primero, deben fallar) ⚠️

- [ ] T020 [P] [US1] Tests unitarios del parser en `test/unit/lyrics-parser.spec.ts` con los fixtures de T004: `parseLetrasHtml(letras-song.html)` devuelve el título del `<h1>`, el artista esperado y estrofas no vacías en el orden de la página; `parseLetrasHtml(letras-no-lyrics.html)` devuelve `null`. Casos sintéticos: un `</div>` interior no corta el contenedor `lyric-original` (recorrido por profundidad); `<br>`, `<br/>`, `<br />` separan líneas; entidades (`&amp;`, `&#39;`, `&ntilde;`, `&aacute;`, `&nbsp;`) se decodifican; espacios se normalizan; líneas y estrofas vacías se descartan; sin contenedor o con 0 líneas → `null`; sin `<h1>` usa la cascada (Open Graph / `<title>`); sin artista → `artist: null`; indicaciones como «(Coro)» y «x2» se conservan. `lyricsToHtml(stanzas)` produce `<div class="lyric-original"><p>l1<br>l2</p>…</div>` y escapa `<`, `>`, `&`, `"` (un `<script>` en la letra sale escapado); `countLines` suma las líneas de todas las estrofas.
- [ ] T021 [P] [US1] Tests unitarios de la frontera de rastreo en `test/unit/lyrics-crawler.spec.ts` con `vi.mock('apify-client')` (sin red): sin `apifyApiKey` → 503 `data.code = 'not_configured'` sin instanciar el cliente; éxito → instancia `ApifyClient` con `{ token, baseUrl (si apifyBaseUrl no está vacío), maxRetries: 2, timeoutSecs: 30 }`, llama `actor('apify/rag-web-browser').call({ query: url, maxResults: 1, outputFormats: ['html'], scrapingTool: 'browser-playwright', requestTimeoutSecs: 40, removeCookieWarnings: true, htmlTransformer: 'none' }, { waitSecs: 55 })` y `dataset(defaultDatasetId).listItems({ limit: 1 })`, y devuelve `{ html, status }` con `status` = `crawl.httpStatusCode`; tabla de research D2: `ApifyApiError` 401/403 → 502 `misconfigured`; 402 o el `type` de crédito agotado confirmado en T003 → 503 `quota`; 429 → 503 `busy`; run `FAILED`/`TIMED-OUT`/`ABORTED` o 0 items → 502 `crawl_failed`; run `RUNNING` tras `waitSecs` → llama `run(id).abort()` (mejor esfuerzo: si `abort` falla igual responde) y 502 `crawl_failed`; error de red → 502 `crawl_failed`. Ningún error ni log contiene el token, la URL del run ni el mensaje del actor.
- [ ] T022 [P] [US1] Tests unitarios de endpoints en `test/unit/api-songs-fetch.spec.ts` (`useDb` y `crawlLetras` simulados, como `api-youtube-videos.spec.ts`): `POST /api/songs/fetch` con enlace inválido → 400 con `data.reason` y **sin** llamar a `crawlLetras`; canción ya guardada (mismo `source_url` normalizado) → 200 `{ song, crawled: false }`, registra la vista y no llama a `crawlLetras`; nueva con letra → 201 `{ song, crawled: true }` con `INSERT … ON CONFLICT (source_url) DO UPDATE` + vista en un `db.batch`; `status` 404 o HTML sin letra → 404 `no_lyrics` sin escrituras; más de 300 líneas o más de 500 000 caracteres → 422 `lyrics_too_long` sin escrituras; cada error del crawler se propaga sin escrituras. `GET /api/songs/[id]`: id no UUID → 404 sin consultar; inexistente → 404; existente → `SongDetail` (con `lineCount`) y vista registrada en el mismo `db.batch`. `POST /api/songs/[id]/refresh`: con letra válida actualiza `lyrics`, `title`, `artist`, `updated_at` y devuelve `SongDetail`; con `no_lyrics` o error del crawler deja la fila intacta.
- [ ] T023 [P] [US1] Ampliar `test/unit/endpoint-guards.spec.ts` y `test/unit/route-access.spec.ts`: `server/api/songs/fetch.post.ts`, `server/api/songs/[id]/index.get.ts` y `server/api/songs/[id]/refresh.post.ts` existen y llaman `requireRole(event, 'editor')`, ninguno es público ni de cron; `/canciones` y `/canciones/<id>` son privadas con roles `editor`/`admin`.
- [ ] T024 [P] [US1] Crear el stub `test/e2e/setup/apify-stub.ts` (research D14, rutas confirmadas en T003): servidor local que implementa lo que usan `call()` (crear run del actor y consultarlo con `waitForFinish`), `run(id).abort()` y `dataset(id).listItems()`, con escenarios por URL: canción normal (sirve un HTML de canción derivado de `test/unit/fixtures/letras-song.html`), `sin-letra` (HTML sin `lyric-original`), `muy-larga` (> 300 líneas), `fallo-del-run` (`FAILED`) y `sin-credito` (402). Registrar en `test/e2e/setup/global-setup.ts` el arranque del stub e inyectar `NUXT_APIFY_API_KEY=e2e-stub` y `NUXT_APIFY_BASE_URL=<url del stub>`; exportar los enlaces de escenario desde `test/e2e/setup/constants.ts`.
- [ ] T025 [P] [US1] Tests de componente: `test/nuxt/SongUrlInput.spec.ts` (rechaza los enlaces inválidos de T006 mostrando el mensaje junto al campo con `role="alert"` sin emitir; con `busy` muestra «Buscando la letra…», `aria-busy` y deshabilita el envío; emite `submit(url)` con Enter y con el botón), `test/nuxt/SongLyrics.spec.ts` (una `<p>` por estrofa, líneas como texto real sin HTML interpretado, contador «N líneas», aviso cuando pasa de 300) y `test/nuxt/SongMeta.spec.ts` (título en `<h1>`, artista opcional, enlace «Ver en Letras.com» con `target="_blank" rel="noopener noreferrer"`, «Obtenida {relativo}»).
- [ ] T026 [P] [US1] Test de página `test/nuxt/pages-canciones.spec.ts` (US1): `/canciones` muestra `<h1>Canciones</h1>`, la descripción y `SongUrlInput`; la ficha `/canciones/<id>` muestra en orden DOM metadatos → acciones (**Volver a obtener la letra**) → letra, con sus estados cargando, no encontrada («Esa canción ya no existe» + «Volver a Canciones»), error con reintento y contenido.
- [ ] T027 [P] [US1] E2E en `test/e2e/songs-fetch.spec.ts` (contra `apify-stub`): editor pega el enlace normal → espera visible → llega a `/canciones/<id>` con título y estrofas; repetir con `?utm_source=x` y sin `www.` abre la misma `id` sin un run nuevo en el stub; los inválidos de quickstart §2.4 se rechazan sin ninguna petición `POST /api/songs/fetch`; `sin-letra` muestra «No encontramos una letra en ese enlace» y conserva el texto del campo; `fallo-del-run` y `sin-credito` muestran su mensaje con acción de reintento; **Volver a obtener la letra** pide confirmación y muestra la letra nueva; a 360 px sin scroll horizontal. Ampliar `test/e2e/routes-guard.spec.ts`: `/canciones` y `/canciones/<id>` sin sesión y con rol no permitido se tratan como las demás rutas protegidas.

### Implementation for User Story 1

- [ ] T028 [P] [US1] Implementar `server/utils/lyrics-parser.ts` (puro, sin dependencias): `parseLetrasHtml(html): { title, artist, stanzas: string[][] } | null` (recorrido por profundidad de etiquetas para localizar `lyric-original`; `<p>` = estrofa, `<br>` = salto de línea; decodificar entidades; normalizar espacios; descartar vacías; título del `<h1>` y artista por la cascada ajustada en T004; recortar `title` a `SONG_TITLE_MAX` y `artist` a `SONG_ARTIST_MAX`), `lyricsToHtml(stanzas)` con texto escapado y `countLines(stanzas)`. Hace pasar T020.
- [ ] T029 [P] [US1] Implementar `server/utils/lyrics-crawler.ts`, la **única** frontera con Apify: `crawlLetras(url): Promise<CrawledPage>` (`{ html: string | null; status: number | null }`) con la llamada, opciones, cancelación de run huérfano y tabla de fallos de research D2 (ya verificada en T003); cliente nuevo por llamada; logs solo con estado/tipo. Hace pasar T021.
- [ ] T030 [US1] Implementar `server/utils/songs.ts`: `findSongByUrl(url)`, `getSongDetail(id)` (incluye `lyrics` y `lineCount`), `saveCrawledSong({ url, parsed, userId })` (`INSERT … ON CONFLICT (source_url) DO UPDATE` + vista en un `db.batch`), `replaceLyrics(id, parsed)` (solo actualiza `lyrics`, `title`, `artist`, `updated_at`), `recordSongView(id, userId)` (`last_viewed_at = now`, `last_viewed_by`), `assertLyricsWithinLimits(stanzas)` (lanza 422 `lyrics_too_long` si `countLines > LYRICS_MAX_LINES` o el HTML supera `LYRICS_MAX_CHARS`) y los mappers fila → `Song`/`SongDetail`. Las consultas de lista nunca seleccionan `lyrics`.
- [ ] T031 [US1] Crear `server/api/songs/fetch.post.ts` según contracts/api.md §1: `requireRole(event, 'editor')`; `readValid(songUrlInput)`; guardada → vista + 200 `{ song, crawled: false }`; nueva → `crawlLetras` → `status === 404` o `parseLetrasHtml` nulo → 404 `no_lyrics` → `assertLyricsWithinLimits` → `saveCrawledSong` → 201 `{ song, crawled: true }`. Un fallo no escribe nada.
- [ ] T032 [P] [US1] Crear `server/api/songs/[id]/index.get.ts` (`paramId`, 404 si no existe, `SongDetail` + `recordSongView` en el mismo `db.batch`, `Cache-Control: no-store`) y `server/api/songs/[id]/refresh.post.ts` (rastrea `source_url`, parsea, valida límites y llama `replaceLyrics` solo con letra válida; responde `SongDetail`). Hace pasar T022–T023.
- [ ] T033 [P] [US1] Agregar la entrada **Canciones** (`lucide:music`, roles `TEAM`, ruta `/canciones`) en `app/utils/navigation.ts`, después de YouTube.
- [ ] T034 [US1] Crear `app/composables/useSongs.ts`: `open(url)` (`POST /api/songs/fetch` vía `useApi`, `navigateTo('/canciones/<id>')`, toast «Letra obtenida» si `crawled`, error por `serverMessage` con los `503` nombrados), `useSong(id)` (ficha con `useApiFetch`, clave `song-<id>`), `refreshLyrics(id)` (con `useConfirm` y `messages.songs.refresh.confirm`, toast al terminar, refresca la ficha).
- [ ] T035 [P] [US1] Crear `app/components/songs/SongUrlInput.vue` con la forma de `YoutubeUrlInput.vue`: campo grande, `useFormSchema(songUrlSchema)`, envío con Enter o botón, `busy` con spinner `motion-reduce:animate-none`, `aria-busy` y «Buscando la letra…» (`role="status"`), error junto al campo con `role="alert"`, conserva el texto tras un fallo; `btn-block` a 360 px. Hace pasar la parte de T025.
- [ ] T036 [P] [US1] Crear `app/components/songs/SongMeta.vue` (forma de `YoutubeVideoMeta.vue`: `<h1>` título, artista, «Ver en Letras.com» externo, «Obtenida {relativo}» con `useRelativeTime`) y `app/components/songs/SongLyrics.vue` (estrofas en `<p>` con `whitespace-pre-line`, ancho de lectura cómodo, «N líneas», aviso si `> LYRICS_MAX_LINES`; nunca `v-html`).
- [ ] T037 [US1] Crear `app/components/songs/SongActions.vue` con **Volver a obtener la letra** (secundario, emite `refresh`; la confirmación vive en `useSongs`) y huecos de diseño para **Generar presentación** y **Crear/Agregar a colección**, que llegan en US2 y US3; a 360 px los botones ocupan el ancho y se acomodan en filas sin scroll horizontal.
- [ ] T038 [US1] Crear `app/pages/canciones/index.vue` (`definePageMeta({ layout: 'dashboard', access: 'private', roles: ['editor', 'admin'] })`; encabezado + descripción de contracts/ui.md; `SongUrlInput` conectado a `useSongs().open`; espacio para las secciones Colecciones e Historial, que se llenan en US3/US4) y `app/pages/canciones/[id].vue` (misma meta; `SongMeta` → `SongActions` → `SongLyrics` en ese orden DOM; cuatro estados con `SkeletonList`, `ErrorState` con reintento y «Esa canción ya no existe» con «Volver a Canciones»). No crear `app/pages/canciones.vue` (se volvería ruta padre, ver 005 D14). Hace pasar T026.
- [ ] T039 [US1] Definición de hecho de la fase: `bun run typecheck`, `bun run test:unit`, `bun run test:nuxt`, `bun run test:e2e` (T027 en verde). Verificación en navegador con `bun run dev` y `agent-browser` según quickstart §2 (pocas canciones reales: el rastreo cuesta crédito) a 360 px y ≥ 1280 px, tema oscuro y claro, foco, consola sin errores; además `NUXT_APIFY_API_KEY` vacía → «El rastreo de letras no está configurado» sin romper el resto. Reportar antes de marcar.

**Checkpoint**: MVP (Fase 1) — enlace → letra guardada y visible, sin duplicados ni rastreos repetidos. Desplegable solo.

---

## Phase 4: User Story 2 - Generar y descargar la presentación PowerPoint (Priority: P2) (Fase 2)

**Goal**: Desde la ficha, **Generar presentación** con color de letra (negro por defecto, blanco rápido, cualquier `#RRGGBB`) envía la letra guardada al servicio `cloudy-api` (`POST /v1/lyrics/pptx`) a través del servidor de Cloudy y descarga el `.pptx` con el título como nombre, informando las diapositivas y la nota de reparto de respaldo. El servicio dormido se despierta al abrir la página.

**Independent Test**: desde una canción ya obtenida, pulsar **Generar presentación**, descargar `<Título>.pptx` (tildes correctas) que abre en PowerPoint y ver «N diapositivas generadas» (quickstart §3).

### Tests for User Story 2 (escribir primero, deben fallar) ⚠️

- [ ] T040 [P] [US2] Ampliar `test/unit/cloudy-api.spec.ts` para `createLyricsPptx` con `fetch` simulado y reloj falso: `POST {cloudyApiUrl}/v1/lyrics/pptx` con `X-API-Key` y cuerpo `{ html, title, font_color }`; plazo `CLOUDY_API_TIMEOUTS.pptx = 90_000`; devuelve `{ bytes, contentDisposition, slideCount, arrangedBy }` leyendo `content-disposition`, `x-slide-count` (número; no numérico → `null`) y `x-lyrics-arranged-by` (`llm`/`fallback`; otro → `null`). Tabla de research D9: `422` con `detail.code = 'no_lyrics'` → 422 `no_lyrics`; `422` `lyrics_too_long` → 422 `lyrics_too_long`; `422` con lista de validación de FastAPI → 502 `invalid` (registrado sin el cuerpo); `401`/`403` → 502 `misconfigured`; `5xx`, error de red y `AbortError` → 503 `waking`; URL o clave vacías → 503 `not_configured` sin llamar a `fetch`. Los casos existentes de `fail()` no cambian; ningún error ni log contiene la clave.
- [ ] T041 [P] [US2] Tests unitarios del endpoint en `test/unit/api-songs-pptx.spec.ts` (`useDb` y `createLyricsPptx` simulados): id no UUID o inexistente → 404; `fontColor` inválido → 400 sin llamar al servicio; letra > 300 líneas → 422 `lyrics_too_long` **sin llamar al servicio**; éxito → envía `lyricsToHtml(stanzas)`, `title` y `fontColor` normalizado (`000000` por defecto) y responde 200 con los bytes y las cabeceras `Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation`, `Content-Disposition` del servicio (o una propia con el título saneado y `filename*=UTF-8''…` si falta), `X-Slide-Count`, `X-Lyrics-Arranged-By` y `Cache-Control: no-store`; los errores de la frontera se propagan con su `data.code`. Ampliar `test/unit/endpoint-guards.spec.ts` con `server/api/songs/[id]/pptx.post.ts`.
- [ ] T042 [P] [US2] Tests unitarios de `app/utils/download-blob.ts` en `test/unit/download-blob.spec.ts` (o `test/nuxt` si necesita DOM): el nombre sale de `filename*` (decodificando `Canci%C3%B3n.pptx` → `Canción.pptx`), si no de `filename`, si no `canciones.pptx`; caracteres no válidos para nombre de archivo se sustituyen conservando tildes y eñes; crea y dispara un `<a download>` y devuelve el `objectURL` para volver a descargar.
- [ ] T043 [P] [US2] Tests de componente y composable: `test/nuxt/useSongPresentations.spec.ts` (`enqueue` de 1 canción hace una sola petición aunque se llame dos veces seguidas con la misma canción; estados `queued → running → done` con `slides`/`arrangedBy`; `cancel` aborta el activo y saca de la cola al pendiente; `failed` por `waking`/red ofrece `retry` y por `no_lyrics`/`lyrics_too_long` no; `redownload` reutiliza el `objectURL` sin nueva petición; `dismiss` revoca el `objectURL`; `filesFor(n)` devuelve el texto «Recibirás n archivos, uno por canción.»; el estado no se filtra entre tests), `test/nuxt/SongColorPicker.spec.ts` (Negro/Blanco/`<input type="color">` con `<label>`, `v-model` en `RRGGBB`, muestra `#RRGGBB` como texto, recuerda la elección con `useLocalStorage('songs-font-color')`), `test/nuxt/SongActions.spec.ts` (**Generar presentación** emite `generate(color)`, queda deshabilitado mientras `generating` y con letra > 300 líneas mostrando el motivo) y `test/nuxt/SongPresentationTray.spec.ts` (fila por canción con avance, «N diapositivas generadas», nota `present.fallback`, **Cancelar**, **Reintentar** solo en transitorios, **Descargar de nuevo**, **Descartar**, `role="status"`).
- [ ] T044 [P] [US2] Ampliar `test/e2e/setup/cloudy-api-stub.ts` con `POST /v1/lyrics/pptx`: devuelve un `.pptx` mínimo válido con `Content-Disposition` UTF-8, `X-Slide-Count` y `X-Lyrics-Arranged-By: llm`; escenarios `no_lyrics`, `lyrics_too_long` y `fallback` (`X-Lyrics-Arranged-By: fallback`) seleccionables por el título o el HTML recibido; respeta `setCloudyStubState('asleep')`.
- [ ] T045 [P] [US2] E2E en `test/e2e/songs-presentation.spec.ts` (stubs de Apify y `cloudy-api`): desde una ficha, **Generar presentación** con Negro → descarga cuyo nombre sugerido es el título con tildes y aviso «N diapositivas generadas»; con Blanco el cuerpo recibido por el stub lleva `font_color: 'FFFFFF'`; doble clic → una sola petición `POST /api/songs/<id>/pptx`; escenario `fallback` → se descarga y aparece la nota; canción `muy-larga` → «Eso no parece una canción» sin **Reintentar**; stub `asleep` → banner de servicio despertando y la generación termina o muestra **Reintentar**; generar de nuevo con otro color no hace un nuevo rastreo.

### Implementation for User Story 2

- [ ] T046 [US2] Ampliar `server/utils/cloudy-api.ts`: `CLOUDY_API_TIMEOUTS.pptx = 90_000`, interfaz `LyricsPptx` y `createLyricsPptx({ html, title, fontColor })` reutilizando `config()`, `request()` y `fail()`; `fail()` gana el caso `'pptx'` con el mapeo de D9 sin cambiar los existentes. Hace pasar T040.
- [ ] T047 [US2] Crear `server/api/songs/[id]/pptx.post.ts` según contracts/api.md §4: `requireRole`, `paramId`, `readValid(songPresentationInput)`, lee la canción (404), `countLines > LYRICS_MAX_LINES` → 422 sin llamar al servicio, `lyricsToHtml`, `createLyricsPptx`, responde los bytes con las cinco cabeceras. Hace pasar T041.
- [ ] T048 [P] [US2] Crear `app/utils/download-blob.ts` (`downloadBlob(blob, headers)` → nombre por `filename*`/`filename`/`canciones.pptx`, descarga y devuelve el `objectURL`; `revokeDownload(url)`). Hace pasar T042.
- [ ] T049 [P] [US2] Crear `app/components/songs/SongColorPicker.vue` (forma de `YoutubeFormatPicker.vue`: Negro, Blanco y `<input type="color">` nativo, `<label>` accesible, valor `#RRGGBB` visible, `v-model` en `RRGGBB`, última elección con `useLocalStorage('songs-font-color', SONG_DEFAULT_FONT_COLOR)` envuelto para tolerar almacenamiento no disponible).
- [ ] T050 [US2] Crear `app/composables/useSongPresentations.ts` (research D10): cola en `useState('songs-presentations')` con elementos `{ songId, title, status: 'queued'|'running'|'done'|'failed'|'canceled', slides?, arrangedBy?, error?, errorCode?, blobUrl? }`, `pump` guiado por el estado (una a la vez), `AbortController` y `objectURL` en un mapa de módulo, petición `POST /api/songs/<id>/pptx` como `blob` leyendo cabeceras, plazo `SONG_PRESENTATION_TIMEOUT_MS`; API `enqueue(songs, color)` (ignora una canción ya `queued`/`running`), `cancel`, `retry` (solo transitorios), `dismiss`, `redownload`, `filesFor(n)`, `hasItems`. Toast «N diapositivas generadas» y nota de respaldo al terminar cada una; `present.blocked` cuando hay varias descargas seguidas. Hace pasar la parte de T043.
- [ ] T051 [US2] Crear `app/components/songs/SongPresentationTray.vue` (forma de `YoutubeDownloadTray.vue`, lee `useSongPresentations`) y montarlo diferido en `app/layouts/dashboard.vue` con `<LazySongPresentationTray v-if="presentations.hasItems" />`; si la bandeja de YouTube también está visible se apoya encima (`bottom: var(--youtube-tray-h, 0px)`) y publica su alto en `--song-tray-h`. Ampliar `test/nuxt/dashboard-layout.spec.ts` para el montaje condicional.
- [ ] T052 [US2] Completar `app/components/songs/SongActions.vue` con `SongColorPicker` + **Generar presentación** (primario, emite `generate(color)`, deshabilitado mientras la canción está `queued`/`running` en la cola y con letra > 300 líneas mostrando el motivo) y conectarlo en `app/pages/canciones/[id].vue` a `useSongPresentations().enqueue([song], color)`; **Generar presentación** visible a 360 px sin recorrer la letra. Hace pasar la parte de T043.
- [ ] T053 [US2] Reutilizar el estado del servicio (FR-018, D11): en `app/pages/canciones/index.vue` y `app/pages/canciones/[id].vue` llamar `useYoutubeService()` al montar (despierta `cloudy-api` vía `/api/youtube/health`) y mostrar `YoutubeServiceBanner` cuando el estado no es `up`/`unknown`, sin modificar esos dos artefactos de 005.
- [ ] T054 [US2] Definición de hecho de la fase: typecheck, `test:unit`, `test:nuxt`, `test:e2e` (T045 en verde). Navegador según quickstart §3 con el `cloudy-api` local en `http://localhost:8000`: abrir el `.pptx` descargado en PowerPoint, color elegido, sin relleno; 360 px y ≥ 1280 px, ambos temas, foco y consola. Reportar antes de marcar.

**Checkpoint**: recorrido completo enlace → letra → presentación (Fases 1 y 2).

---

## Phase 5: User Story 3 - Colecciones de canciones compartidas por el equipo (Priority: P3)

**Goal**: Crear colecciones globales desde una canción (o desde la fila Colecciones), agregar/quitar canciones (cualquier editor), renombrar/eliminar (autor o admin), verlas con su autor en `/canciones` y generar una presentación por canción de toda la colección.

**Independent Test**: crear una colección desde una canción, agregar una segunda, verla con su autor desde otra cuenta del equipo y generarla: llegan dos `.pptx` (quickstart §4).

### Tests for User Story 3 (escribir primero, deben fallar) ⚠️

- [ ] T055 [P] [US3] Tests unitarios en `test/unit/song-collections.spec.ts` y `test/unit/api-songs-collections.spec.ts` (como `api-youtube-playlists.spec.ts`): `GET /collections` devuelve `{ items }` más reciente primero con `itemCount` por subconsulta y `author` (`active: false` para un usuario desactivado) sin N+1; `POST /collections` con `name` crea (201), con `songId` existente crea colección + elemento en un `db.batch`, con `songId` inexistente → 404 sin crear nada, nombre inválido → 400; dos colecciones con el mismo nombre se permiten; `GET /collections/[id]` → `SongCollectionDetail` sin `lyrics`; `PATCH`/`DELETE` por un editor ajeno → 403, por el autor o un admin (`songs.moderate`) → 200/204; eliminar no borra canciones; `POST /collections/[id]/items` → `{ added: true }` y sube `updated_at`, repetida → `{ added: false }` sin duplicar (`ON CONFLICT DO NOTHING RETURNING`); `DELETE /collections/[id]/items/[songId]` → 204 por cualquier editor; ids no UUID → 404 sin consultar. Ampliar `test/unit/endpoint-guards.spec.ts` con los 7 endpoints de colecciones.
- [ ] T056 [P] [US3] Tests de componente: `test/nuxt/SongCollectionCard.spec.ts` (ícono, nombre, conteo, autor; botones ⋯ y de generar alcanzables por teclado y visibles siempre en `(pointer: coarse)`; acciones abrir, renombrar, eliminar y generar; renombrar/eliminar ocultos si no `canManage`) y `test/nuxt/SongCollectionDialog.spec.ts` (crear con nombre validado por `songCollectionSchema`; elegir existente y agregar; «ya estaba» sin duplicar; ver colección con título y artista por canción; quitar con `ConfirmDialog`; generar una; renombrar). Ampliar `test/nuxt/pages-canciones.spec.ts` con la fila Colecciones en sus cuatro estados («Aún no hay colecciones» · «Abre una canción y pulsa Crear colección.»).
- [ ] T057 [P] [US3] E2E en `test/e2e/songs-collections.spec.ts`: crear colección desde la ficha (toast y aparece en la fila); agregar una segunda canción; agregar repetida → «ya estaba»; con otra cuenta de editor se ve con el nombre del autor, puede agregar y quitar pero no renombrar ni eliminar; un admin sí; botón de generar de la tarjeta por hover y foco en escritorio y visible en móvil; avisa «Recibirás 2 archivos, uno por canción.» y descarga dos `.pptx` uno a la vez; con una canción en escenario de fallo (`no_lyrics` del stub) entrega la otra e informa cuál falló y por qué; eliminar colección (confirmación) deja las canciones en el historial.

### Implementation for User Story 3

- [ ] T058 [US3] Implementar `server/utils/song-collections.ts` (forma de `youtube-playlists.ts`): `listCollections()` (subconsulta de conteo y autor con estado activo), `getCollectionDetail(id)`, `createCollection({ name, songId?, userId })` (un `db.batch`), `renameCollection`, `deleteCollection`, `addSong` (`ON CONFLICT DO NOTHING RETURNING`, sube `updated_at`), `removeSong`, `canManageCollection(collection, user)` (autor o `can(role, 'songs.moderate')`). Ninguna lectura selecciona `songs.lyrics`.
- [ ] T059 [US3] Crear los 7 endpoints de colecciones según contracts/api.md §7–13, todos con `requireRole(event, 'editor')`, `readValid`/`paramId` y `Cache-Control: no-store` en lecturas: `server/api/songs/collections/index.get.ts`, `server/api/songs/collections/index.post.ts`, `server/api/songs/collections/[id]/index.get.ts`, `server/api/songs/collections/[id]/index.patch.ts`, `server/api/songs/collections/[id]/index.delete.ts`, `server/api/songs/collections/[id]/items/index.post.ts`, `server/api/songs/collections/[id]/items/[songId].delete.ts`. Hace pasar T055.
- [ ] T060 [US3] Crear `app/composables/useSongCollections.ts` (`useSongCollections()` / `useSongCollectionList()`, forma de `useYoutubePlaylists.ts`, clave `song-collections`): crear, renombrar, eliminar (con `useConfirm`), agregar/quitar canción, `canManage` con `can(role, 'songs.moderate')` o autoría, `generate(collectionId, color)` que carga la colección y llama `useSongPresentations().enqueue(items, color)` tras confirmar con `filesFor(n)`; toasts de FR-032.
- [ ] T061 [P] [US3] Crear `app/components/songs/SongCollectionCard.vue` (forma de `YoutubePlaylistCard.vue`, sin portada: ícono `lucide:list-music`, nombre, conteo, autor; ⋯ con `ActionMenu` y botón de generar siempre visibles en móvil y con `hover` **y** `focus-within` desde `lg:`) y `app/components/songs/SongCollectionRow.vue` (forma de `YoutubePlaylistRow.vue`, cuatro estados con `SkeletonList variant="grid"`, `EmptyState`, `ErrorState`).
- [ ] T062 [US3] Crear `app/components/songs/SongCollectionDialog.vue` (forma de `YoutubePlaylistDialog.vue`): modo crear/elegir desde una canción (`songId`, `songTitle`) con `useFormSchema(songCollectionSchema)`, y modo ver colección (`collectionId`) con canciones, abrir, quitar (`ConfirmDialog`), generar una y renombrar/eliminar si `canManage`. Hace pasar T056.
- [ ] T063 [US3] Integrar: en `app/components/songs/SongActions.vue` el botón **Crear colección** / **Agregar a colección** (emite `collection`); en `app/pages/canciones/[id].vue` abrir `<LazySongCollectionDialog v-if>` con la canción; en `app/pages/canciones/index.vue` añadir `SongCollectionRow` bajo `SongUrlInput` con apertura, renombrado, eliminación y generación de colecciones, y `<LazySongCollectionDialog v-if>`.
- [ ] T064 [US3] Definición de hecho de la fase: typecheck, `test:unit`, `test:nuxt`, `test:e2e` (T057 en verde). Navegador según quickstart §4 (Colecciones) con dos cuentas (editor y admin), 360 px y ≥ 1280 px, ambos temas, cuatro estados, foco y consola. Reportar antes de marcar.

**Checkpoint**: colecciones compartidas con generación por lotes, independientes del historial.

---

## Phase 6: User Story 4 - Historial de canciones y generación por lotes (Priority: P4)

**Goal**: Historial compartido (la más reciente primero, una entrada por canción, quién y cuándo) en `/canciones` con paginación al avanzar, casillas, barra de selección con color y **Generar selección**; acciones por entrada; historial reciente bajo la letra en la ficha; limpieza diaria de canciones huérfanas.

**Independent Test**: obtener tres canciones distintas, verlas en el historial (la más reciente primero), marcar las tres y generar: llegan tres `.pptx` (quickstart §4).

### Tests for User Story 4 (escribir primero, deben fallar) ⚠️

- [ ] T065 [P] [US4] Tests unitarios en `test/unit/songs-history.spec.ts` y `test/unit/api-songs-history.spec.ts`: `GET /api/songs/history` ordena por `(last_viewed_at DESC, id DESC)` con keyset (`encodeCursor`/`decodeCursor`), `limit` 24 por defecto y 1–48, `exclude` omite la canción actual, cursor inválido → 400, no selecciona `lyrics`, incluye `viewedBy` con `active`; abrir/obtener una canción ya en el historial la sube sin duplicarla; `DELETE /api/songs/history/[id]` → 204 poniendo `last_viewed_at`/`last_viewed_by` a `NULL` sin tocar `song_collection_items`, 404 si no existe. Ampliar `test/unit/api-cron.spec.ts`: el paso nuevo borra canciones con `last_viewed_at IS NULL`, sin filas en `song_collection_items` y `updated_at` de hace más de 30 días, y no toca las demás. Ampliar `test/unit/endpoint-guards.spec.ts` con los 2 endpoints de historial (total 13).
- [ ] T066 [P] [US4] Tests de componente: `test/nuxt/SongHistoryList.spec.ts` (rejilla con casillas y `v-model:selected`, centinela de siguiente página, «Cargar más» con su propio error, acciones abrir/agregar a colección/generar/quitar con confirmación, modo `recent` sin casillas y sin la canción actual, cuatro estados con «Todavía no hay canciones» · «Pega el primer enlace arriba.») y `test/nuxt/SongSelectionBar.spec.ts` (conteo, «N archivos», `SongColorPicker`, **Generar selección** emite `generate(color)`, **Limpiar** emite `clear`, respeta `--song-tray-h`). Ampliar `test/nuxt/pages-canciones.spec.ts`: la selección vive en `useState('songs-history-selected')` y sobrevive a un reintento.
- [ ] T067 [P] [US4] E2E en `test/e2e/songs-history.spec.ts`: obtener tres canciones → aparecen la más reciente primero con quién y cuándo; reabrir la primera la sube sin duplicar; marcar las tres → barra con conteo, color y **Generar selección** → aviso de 3 archivos → tres descargas una a la vez; regenerar desde una entrada no hace un nuevo rastreo; quitar una entrada (confirmación) no la saca de su colección; la ficha muestra el historial reciente bajo la letra sin la canción actual; historial vacío muestra su estado vacío; a 360 px la barra no tapa contenido ni provoca scroll horizontal.

### Implementation for User Story 4

- [ ] T068 [US4] Ampliar `server/utils/songs.ts` con `listSongHistory({ limit, cursor, exclude })` (keyset sobre `songs_history_idx`, sin `lyrics`, `viewedBy` con estado activo) y `removeFromHistory(id)`; crear `server/api/songs/history/index.get.ts` y `server/api/songs/history/[id].delete.ts` con `requireRole(event, 'editor')`, `queryValid(songHistoryQuery)`/`paramId` y `Cache-Control: no-store`. Hace pasar la parte de T065.
- [ ] T069 [US4] Agregar a `server/utils/cron.ts` el paso de limpieza de research D13 (canciones sin historial, sin colección y con `updated_at` > 30 días), registrado en el resumen de `/api/cron/cleanup` como los pasos existentes. Hace pasar la parte de cron de T065.
- [ ] T070 [US4] Crear `app/composables/useSongHistory.ts` (clon de `useYoutubeHistory.ts` sobre `/api/songs/history`: primera página con SSR, `loadMore` con `useElementVisibility` sobre el centinela, `remove` con confirmación y toast, opciones `{ exclude?, recent? }`).
- [ ] T071 [P] [US4] Crear `app/components/songs/SongHistoryList.vue` (forma de `YoutubeHistoryList.vue`: casillas ≥ 44 px, acciones por entrada con `ActionMenu`, modo `recent`, cuatro estados) y `app/components/songs/SongSelectionBar.vue` (forma de `YoutubeSelectionBar.vue`: fija abajo con área segura, `bottom` sobre `--song-tray-h`). Hace pasar T066.
- [ ] T072 [US4] Integrar: en `app/pages/canciones/index.vue` la sección **Historial** con `SongHistoryList` (selección en `useState('songs-history-selected')`), `SongSelectionBar` cuando hay selección (**Generar selección** → confirmación con `filesFor(n)` → `useSongPresentations().enqueue`), y «agregar a colección» que abre `LazySongCollectionDialog`; en `app/pages/canciones/[id].vue` el historial reciente (`recent`, `SONG_RECENT_LIMIT`, `exclude` = canción actual) debajo de la letra.
- [ ] T073 [US4] Definición de hecho de la fase: typecheck, `test:unit`, `test:nuxt`, `test:e2e` (T067 en verde). Navegador según quickstart §4 (Historial y Vacíos/errores), 360 px y ≥ 1280 px, ambos temas, foco, consola e INP al marcar casillas. Reportar antes de marcar.

**Checkpoint**: las cuatro historias funcionan de forma independiente.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentación, calidad, rendimiento y validación final.

- [ ] T074 [P] Actualizar `AGENTS.md`: feature activa `specs/006-canciones-lyrics-pptx/`; en la regla IV añadir `server/utils/lyrics-crawler.ts` como única frontera con Apify; en "Environments and variables" `NUXT_APIFY_API_KEY` y `NUXT_APIFY_BASE_URL` (vacío = Apify real; e2e → `test/e2e/setup/apify-stub.ts`); en "Known gotchas" un apartado Canciones (letra guardada como `string[][]`, nunca HTML; un rastreo solo para canciones nuevas o **Volver a obtener la letra**; `.pptx` como única excepción acotada de binario por el servidor; cola de presentaciones de una en una; plazo de funciones confirmado en T005). Mantenerlo alineado con la constitución.
- [ ] T075 Ejecutar `bun run test:coverage` y revisar por archivo que cada módulo nuevo cumpla ≥ 92 % en sentencias, ramas, funciones y líneas (`lyrics-parser.ts`, `lyrics-crawler.ts`, `songs.ts`, `song-collections.ts`, `shared/validation/songs.ts`, `shared/constants/songs.ts`, `createLyricsPptx`, `download-blob.ts`, los `Song*` y `useSong*`); si alguno baja, agregar pruebas. No bajar el umbral ni excluir archivos.
- [ ] T076 [P] Rendimiento: `bun run build` y `bun run analyze`; comprobar que `/canciones` y `/canciones/[id]` no superan 250 KB gzip de JS inicial y que `SongPresentationTray`, `SongCollectionDialog` se cargan diferidos. Ampliar `test/e2e/performance.spec.ts` con `/canciones` si cubre rutas por presupuesto.
- [ ] T077 [P] Seguridad (SC-010): buscar en el bundle del cliente (`.output/public`) y en la pestaña Red que no aparecen `apifyApiKey`, `cloudyApiKey` ni sus valores; revisar que ningún log de `lyrics-crawler.ts`/`cloudy-api.ts` incluye token, URL del run ni cuerpo del servicio. Ejecutar `/security-review` sobre la rama.
- [ ] T078 [P] Accesibilidad: auditoría WCAG 2.2 AA de `/canciones` y `/canciones/<id>` en `cloudy` y `cloudy-light` (contraste, foco visible, etiquetas del selector de color y casillas, `role="status"`/`role="alert"`, `prefers-reduced-motion`); ampliar `test/nuxt/four-states.spec.ts` con las vistas de Canciones si cubre ese patrón.
- [ ] T079 Validación final con `specs/006-canciones-lyrics-pptx/quickstart.md` §2–§6 completos (incluido el despliegue: variables en Vercel y plazo de funciones de T005) y gates de merge de AGENTS.md: typecheck + build, `test:unit`/`test:nuxt`/`test:e2e` verdes con cobertura, revisión manual a 360 px y ≥ 1280 px en ambos temas, sin regresiones de presupuesto. Reportar el resultado; los commits siguen Conventional Commits y el PR a `main` lo abre la persona o el agente solo si se le pide.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias. T003 y T004 necesitan el MCP de Apify o la consola (crédito real) y bloquean T020/T021/T024/T028/T029.
- **Foundational (Phase 2)**: depende de Setup. **Bloquea todas las historias.** T016 espera a que la persona aplique la migración.
- **US1 (Phase 3)**: depende de Foundational. Es el MVP (Fase 1 del spec).
- **US2 (Phase 4)**: depende de US1 (necesita una canción guardada y la ficha).
- **US3 (Phase 5)**: depende de US1 (canciones) y US2 (generación por lotes vía `useSongPresentations`).
- **US4 (Phase 6)**: depende de US1 y US2; la acción «agregar a colección» del historial usa US3 (si US3 no está, esa acción se omite y el resto de US4 funciona).
- **Polish (Phase 7)**: depende de las historias que se vayan a entregar.

### Dependencias entre tareas relevantes

- T004 (fixtures) → T020 → T028 (parser) → T031/T032.
- T003 (rutas del SDK) → T021/T024 → T029 (crawler) y stub e2e.
- T015 → T016 (migración aplicada por la persona) → cualquier endpoint.
- T030 (`songs.ts`) → T031, T032, T047, T058, T068.
- T046 (`createLyricsPptx`) → T047 → T050 (cola) → T051/T052 → T060 (generar colección) y T072 (generar selección).
- T037 (`SongActions` base) → T052 (generar) → T063 (colección).
- T038 (páginas) → T053, T063, T072.

### Within Each User Story

- Tests primero y en rojo; luego utilidades de servidor → endpoints → composables → componentes → páginas → definición de hecho.

### Parallel Opportunities

- Setup: T002 y T005 en paralelo; T003 → T004 en secuencia (mismo actor).
- Foundational: T006–T010 en paralelo; T011–T014, T017, T018 en paralelo; T015 → T016 en secuencia.
- US1: T020–T027 en paralelo; T028 y T029 en paralelo; T032, T033, T035, T036 en paralelo tras T030/T031 según archivo.
- US2: T040–T045 en paralelo; T048 y T049 en paralelo.
- US3: T055–T057 en paralelo; T061 en paralelo con T060.
- US4: T065–T067 en paralelo; T071 en paralelo con T070.
- Polish: T074, T076, T077, T078 en paralelo.

---

## Parallel Example: User Story 1

```bash
# Tests de US1 juntos (deben fallar):
Task: "Tests del parser en test/unit/lyrics-parser.spec.ts"
Task: "Tests de la frontera de rastreo en test/unit/lyrics-crawler.spec.ts"
Task: "Tests de endpoints en test/unit/api-songs-fetch.spec.ts"
Task: "Stub de Apify en test/e2e/setup/apify-stub.ts"
Task: "Tests de componente SongUrlInput/SongLyrics/SongMeta en test/nuxt/"

# Módulos de servidor independientes:
Task: "server/utils/lyrics-parser.ts"
Task: "server/utils/lyrics-crawler.ts"

# Componentes independientes:
Task: "app/components/songs/SongUrlInput.vue"
Task: "app/components/songs/SongMeta.vue + SongLyrics.vue"
Task: "Entrada Canciones en app/utils/navigation.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only — Fase 1 del spec)

1. Phase 1: Setup (incluye verificación del SDK, fixtures reales y plazo de funciones).
2. Phase 2: Foundational (la persona aplica la migración `0007`).
3. Phase 3: US1 — enlace → letra guardada y visible.
4. **Detenerse y validar** con quickstart §2; desplegable solo (el equipo ya consulta letras en un solo lugar).

### Incremental Delivery

1. Setup + Foundational → base lista.
2. US1 → MVP (Fase 1).
3. US2 → presentación `.pptx` (Fase 2): recorrido completo.
4. US3 → colecciones con generación por lotes.
5. US4 → historial, selección múltiple y limpieza.
6. Polish → documentación, cobertura, presupuesto, seguridad y accesibilidad.

Cada historia se cierra con la definición de hecho de AGENTS.md antes de empezar la siguiente.

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes.
- [Story] enlaza cada tarea con su historia para trazabilidad.
- Los tests se escriben antes y deben fallar; ninguno se salta ni se debilita.
- Un rastreo real cuesta crédito de Apify: en pruebas manuales usar pocas canciones; los e2e usan stubs.
- El agente no ejecuta acciones destructivas (migraciones las aplica la persona; nada de `DELETE`/`DROP` ad hoc).
- Commit por tarea o grupo lógico con Conventional Commits.
