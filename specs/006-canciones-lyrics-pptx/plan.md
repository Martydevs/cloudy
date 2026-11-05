# Implementation Plan: Página Canciones — letras de Letras.com a presentaciones PowerPoint

**Branch**: `006-canciones-lyrics-pptx` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-canciones-lyrics-pptx/spec.md` · Contrato del servicio de presentaciones: `frontend-lyrics-pptx.md` y `http://localhost:8000/docs` (`POST /v1/lyrics/pptx`) · Rastreo: actor `apify/rag-web-browser` mediante el SDK `apify-client` ya instalado

## Summary

El equipo pega el enlace de una canción de Letras.com; Cloudy la **rastrea** con el actor `apify/rag-web-browser` (SDK `apify-client`), **extrae y ordena la letra** en estrofas, la guarda y muestra en
`/canciones/<id>`; desde ahí genera y descarga un `.pptx` que arma el servicio `cloudy-api` (ya implementado). Las canciones se agrupan en **colecciones** del equipo y se consultan en un **historial**
con generación por lotes. Es la misma forma de la feature 005 (YouTube) con otro dominio.

**Enfoque técnico**:

- **Dos fronteras con proveedores**, una por servicio (Constitución IV), ambas en `server/utils/`:
  - `lyrics-crawler.ts` — **única** que importa `apify-client` y lee `apifyApiKey`/`apifyBaseUrl`: lanza el actor con `client.actor('apify/rag-web-browser').call(...)`, lee su dataset y traduce los fallos
    a errores en español (research D1–D3).
  - `cloudy-api.ts` — frontera **existente**; se le agrega `createLyricsPptx` y el mapeo de errores de `POST /v1/lyrics/pptx` (D9). Sin módulo nuevo para el mismo servicio.
- **Parser puro y sin dependencias** (`lyrics-parser.ts`): HTML de la página → `{ title, artist, stanzas }` y `stanzas` → HTML limpio para el servicio. Separado del SDK para probarse con fixtures (D4–D5).
- **La letra se guarda como estrofas (`jsonb`)**, nunca como HTML crudo: se muestra como texto y el HTML que se envía al servicio se reconstruye y escapa en cada generación (D5). Un rastreo por canción nueva;
  releer es gratis (SC-003).
- **Tres tablas** (`songs`, `song_collections`, `song_collection_items`), el historial en la misma fila de la canción (como `youtube_videos`), migración `0007` (D6–D7, D13).
- **13 endpoints** `/api/songs/**`, todos con `requireRole(event, 'editor')`; el estado del servicio reutiliza `/api/youtube/health` (mismo servicio, D11).
- **El `.pptx` pasa por el servidor de Cloudy** (decenas de KB; es la única forma de no exponer la clave) y el navegador lo descarga como blob (D9–D10).
- **Cola de presentaciones en el cliente**: una a la vez, con bandeja que conserva el archivo para volver a descargarlo, cancelación y reintento solo de fallos transitorios (D10).
- **UI**: páginas `app/pages/canciones/index.vue` y `app/pages/canciones/[id].vue`; componentes `Song*` con la forma de los `Youtube*`; reutiliza el aviso y el ping de servicio de 005 y los átomos de UI (D11).
- **Sin dependencias nuevas**: `apify-client` ya está en `package.json` y `NUXT_APIFY_API_KEY` ya existe en `runtimeConfig`. Solo se agrega `apifyBaseUrl` (vacío en producción) para que los e2e usen un stub.
- **Calidad**: cada módulo nuevo se cubre ≥ 92 % en sentencias, ramas, funciones y líneas (meta de esta feature, igual al gate global); detalle en [research.md § D16](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 (estricto) · Vue 3.5 · Nuxt 4.6 (Nitro 2, h3 1) · Bun (local) / Node 22 (Vercel). El servicio de presentaciones es Python (FastAPI) y **no se modifica**.

**Primary Dependencies**:

- **Sin dependencias nuevas.** `apify-client@2.25.0` ya instalado (hoy sin uso en el código).
- **Reutilizadas**:
  - Servidor: `session.ts` (`requireRole`), `validation.ts` (`readValid`, `queryValid`, `paramId`), `pagination.ts` (`encodeCursor`/`decodeCursor`), `db.ts`, `cron.ts` (limpieza diaria), `cloudy-api.ts` (`config`, `request`, `fail`).
  - Compartido: `permissions.ts` (acción nueva `songs.moderate`), `validation/core.ts`, `types/api.ts`.
  - Cliente: `useApi`/`useApiFetch`, `useToast`, `useConfirm`, `useRelativeTime`, `useFormSchema`, `useYoutubeService`, `YoutubeServiceBanner`, `SkeletonList`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `ActionMenu`.
  - VueUse: `useLocalStorage` (color de letra) y `useElementVisibility` (siguiente página del historial, como en `/youtube`).

**Storage**:

- **Neon Postgres**: migración `0007` con 3 tablas nuevas, 2 índices y CHECK ([data-model.md](./data-model.md)). Sin enums nuevos.
- **Bucket**: sin cambios. Las presentaciones no se guardan (FR-034).
- **Servicios externos**: Apify (ejecución del actor; sin estado propio en Cloudy) y `cloudy-api` (sin estado entre peticiones para esta función).

**Testing**: Vitest con `unit`, `nuxt` y `e2e`.
- Unitarios con `vi.mock('apify-client')` para `lyrics-crawler.ts`, `fetch` simulado para `cloudy-api.ts`, y fixtures HTML para `lyrics-parser.ts`.
- E2E contra **dos stubs locales**: `test/e2e/setup/apify-stub.ts` (nuevo, por `NUXT_APIFY_BASE_URL`) y `cloudy-api-stub.ts` (se le agrega `POST /v1/lyrics/pptx`). Nunca llaman a Apify, a Letras ni a Render.

**Target Platform**: Vercel (preset `vercel`, Node) y navegadores desde 360 px.

**Project Type**: Aplicación web full-stack, el mismo proyecto Nuxt (`app/`, `server/`, `shared/`), más dos servicios externos.

**Performance Goals**:

- Canción nueva con título y letra en < 20 s (SC-002); canción guardada en < 2 s sin rastreo (SC-003).
- Primer bloque del historial con 5 000 entradas en < 2 s; INP < 200 ms al marcar casillas (SC-008). Las listas no seleccionan la columna `lyrics`.
- `SongPresentationTray`, `SongCollectionDialog` y `SongLyrics` largos diferidos con `Lazy*` + `v-if`; JS inicial de cada ruta ≤ 250 KB gzip.
- Sin sondeo propio: la generación es una petición larga por canción, no un trabajo que se consulte.

**Constraints**:

- Funciones sin estado: la cola de presentaciones vive en el navegador; ningún trabajo en memoria del servidor.
- `NUXT_APIFY_API_KEY` y `NUXT_CLOUDY_API_KEY` solo en el servidor; jamás en el cliente ni en respuestas (SC-010).
- Plazos: rastreo ≤ 55 s de espera del actor; generación ≤ 90 s (arranque en frío de Render). La duración máxima de la función de Vercel se fija y verifica ([research D15](./research.md), [quickstart § 6](./quickstart.md)).
- Letra: 1–500 000 caracteres y ≤ 300 líneas (contrato del servicio); título ≤ 200.
- Un rastreo cuesta dinero: solo canciones nuevas o **Volver a obtener la letra** rastrean (FR-007).

**Scale/Scope**:

- Volumen: un equipo de decenas de personas, cientos de canciones, decenas de colecciones.
- Servidor: 13 endpoints nuevos, 2 módulos de frontera (1 nuevo, 1 ampliado), 3 módulos de dominio (`songs`, `song-collections`, `lyrics-parser`), 1 paso nuevo en la limpieza diaria.
- Cliente: 2 páginas, 11 componentes, 4 composables.
- 4 historias: US1 (P1, MVP Fase 1) enlace → letra; US2 (P2, Fase 2) presentación; US3 (P3) colecciones; US4 (P4) historial y lotes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluado contra la constitución **v1.1.1**.

| Principio | Pre-diseño | Post-diseño: cómo se cumple |
|-----------|------------|-----------------------------|
| **I. Rendimiento** | ✅ | Ver el detalle bajo la tabla. |
| **II. Funcional y efectivo** | ✅ (con justificación) | Ver el detalle; Apify como servicio externo nuevo se justifica en Complexity Tracking. |
| **III. Mobile first** | ✅ | Ver el detalle. |
| **IV. Calidad de código** | ✅ | Ver el detalle. |
| **V. Pruebas** | ✅ | Ver el detalle. |
| **VI. Consistencia de UX** | ✅ | Ver el detalle. |
| **Restricciones técnicas** | ✅ | Ver el detalle. |
| **Flujo y gates** | ✅ | Rama `006-canciones-lyrics-pptx`. Conventional Commits. DoD de AGENTS.md por fase (typecheck → tests → navegador). |

**Detalle de los principios**:

- **I. Rendimiento**:
  - El `.pptx` pesa decenas de KB: cabe en el límite de cuerpo de Vercel; no se retransmiten binarios pesados (excepción acotada en Assumptions del spec).
  - Historial con keyset `(last_viewed_at DESC, id DESC)` e índice parcial; colecciones con el conteo por subconsulta (sin N+1); las listas nunca traen `lyrics`.
  - Sin rastreo repetido: la letra guardada se reutiliza (SC-003); un rastreo por canción nueva.
  - Componentes pesados o posteriores a una acción son `Lazy*` con `v-if`; la primera vista de `/canciones` (campo, colecciones, historial) usa SSR como `/youtube`.
- **II. Funcional y efectivo**:
  - 4 historias desplegables en orden P1→P4; US2 depende de US1, US3 y US4 de US1–US2. La Fase 1 (US1) se puede entregar sola.
  - Sin dependencias nuevas; sin cuotas por persona, sin edición de letra, sin plantillas: YAGNI (spec, Alcance excluido).
  - Sin huérfanos: un rastreo fallido o sin letra no inserta nada (el `INSERT` ocurre tras parsear con éxito); crear colección con canción va en un solo `db.batch`; canciones sin historial ni colección se limpian a los 30 días.
  - Cada error dice qué hacer (reintentar, corregir el enlace, **Volver a obtener la letra**).
- **III. Mobile first**:
  - Campo y botones `btn-block` a 360 px; los botones de acción de la ficha se acomodan en filas sin ocultar ninguno; **Generar presentación** visible sin recorrer la letra.
  - Casillas y botones ≥ 44 px; barra de selección fija abajo con área segura; el botón de generar de cada colección es permanente en móvil y aparece con hover **y** foco en escritorio.
  - Verificación a 360 px y ≥ 1280 px (quickstart §2–§4).
- **IV. Calidad de código**:
  - `requireRole(event, 'editor')` en los 13 endpoints; renombrar/eliminar colección exige autor o `can(role, 'songs.moderate')`. `endpoint-guards.spec.ts` los cubre.
  - Fronteras únicas: `apify-client` solo en `lyrics-crawler.ts`; `cloudyApiUrl/Key` solo en `cloudy-api.ts`. `architecture.spec.ts` se amplía para impedir importar el SDK o leer `apifyApiKey` fuera de ese módulo.
  - Reglas compartidas en `shared/`: `constants/songs.ts` (límites, mensajes por código), `validation/songs.ts` (`parseLetrasUrl`, validadores), DTOs en `types/api.ts`.
  - Formularios por `useFormSchema` con `songUrlSchema` y `songCollectionSchema` (paridad con `shared/validation` vigilada por `form-schemas.spec.ts`); errores al usuario solo por `serverMessage()`.
  - `<script setup lang="ts">`, componentes pequeños, lógica en composables; sin `any` sin comentario; el parser y el mapeo son funciones puras.
- **V. Pruebas**:
  - Unitarias: `parseLetrasUrl` (aceptados, rechazados, normalización), `lyrics-parser` (fixtures reales y casos límite), `lyrics-crawler` (SDK simulado: éxito, sin letra, fallo del run, tiempo, cuota, clave inválida), `cloudy-api` (`createLyricsPptx`: encabezados, 422 por código, 401, 5xx, tiempo), reglas de colección, keyset, permiso nuevo y guards.
  - Componente: `SongUrlInput`, `SongLyrics`, `SongActions`, `SongCollectionCard`, `SongHistoryList`, `SongSelectionBar`, `SongPresentationTray`, `form-schemas.spec.ts`.
  - E2E (stubs): US1–US4, rutas protegidas (sin sesión y rol incorrecto) y escenarios sin letra, servicio dormido, letra larga y lote con fallo parcial.
  - **Cobertura ≥ 92 % en cada archivo nuevo** (meta de la feature) y gate global 92 % intacto; `server/utils/**` y `shared/**` ≥ 80 % (constitución).
- **VI. Consistencia de UX**:
  - Solo tokens daisyUI; lucide; DM Sans; `SkeletonList`/`EmptyState`/`ErrorState` en colecciones, historial y ficha; `ConfirmDialog` al eliminar colecciones, quitar canciones y volver a obtener la letra; toasts por acción.
  - Copy en español en `app/utils/messages.ts` y `shared/constants/songs.ts`; sin `text-warning` sobre `base-100` claro; el selector de color expone etiqueta y valor al lector de pantalla.
- **Restricciones técnicas**:
  - Stack sin cambios; sin estado en el servidor; secretos solo por `runtimeConfig` (`NUXT_APIFY_API_KEY`, `NUXT_APIFY_BASE_URL`, `NUXT_CLOUDY_API_URL`, `NUXT_CLOUDY_API_KEY`).
  - Esquema solo con migración Drizzle `0007`; la persona la aplica a cada rama.
  - Privacidad: no se guardan datos personales nuevos; colecciones e historial guardan autoría de miembros del equipo; las letras son contenido con derechos de autor de uso interno (Assumptions).

**Reevaluación post-diseño**: sin violaciones. Un servicio externo nuevo (Apify) requiere la justificación de abajo; no hay excepciones a los presupuestos de rendimiento.

## Project Structure

### Documentation (this feature)

```text
specs/006-canciones-lyrics-pptx/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   ├── api.md           # 13 endpoints /api/songs/** + fronteras Apify y cloudy-api
│   └── ui.md            # páginas, componentes, composables, estados y textos
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
shared/
├── constants/songs.ts            # LYRICS_MAX_LINES, LYRICS_MAX_CHARS, límites de título/artista/colección, SONG_SERVICE_MESSAGES, SONG_ERROR_MESSAGES, PRESET de color
├── validation/songs.ts           # parseLetrasUrl, songUrlInput, songFontColor, songPresentationInput, songCollection*, songHistoryQuery
├── permissions.ts                # + acción 'songs.moderate' (solo admin)
└── types/api.ts                  # + DTOs Song* (data-model.md)

server/
├── db/schema.ts                  # + songs, song_collections, song_collection_items
├── utils/
│   ├── lyrics-crawler.ts         # ÚNICA frontera con Apify (apify-client): crawlLetras(url) → { html, status }
│   ├── lyrics-parser.ts          # puro: parseLetrasHtml, lyricsToHtml, countLines
│   ├── cloudy-api.ts             # + createLyricsPptx (frontera existente)
│   ├── songs.ts                  # upsert de canción + historial, keyset, mappers, guardas de id
│   ├── song-collections.ts       # lecturas con subconsultas, reglas de autor/admin
│   └── cron.ts                   # + borrado de canciones huérfanas (> 30 días)
└── api/songs/
    ├── fetch.post.ts
    ├── [id]/index.get.ts
    ├── [id]/refresh.post.ts
    ├── [id]/pptx.post.ts
    ├── history/index.get.ts
    ├── history/[id].delete.ts
    ├── collections/index.get.ts
    ├── collections/index.post.ts
    ├── collections/[id]/index.get.ts
    ├── collections/[id]/index.patch.ts
    ├── collections/[id]/index.delete.ts
    ├── collections/[id]/items/index.post.ts
    └── collections/[id]/items/[songId].delete.ts

drizzle/0007_*.sql                # generada con bun run db:generate

app/
├── pages/canciones/
│   ├── index.vue                 # índice: campo, colecciones, historial
│   └── [id].vue                  # ficha: metadatos, acciones y letra arriba; historial reciente debajo
├── layouts/dashboard.vue         # + <LazySongPresentationTray v-if="…"> (montaje diferido)
├── components/songs/
│   ├── SongUrlInput.vue
│   ├── SongMeta.vue
│   ├── SongActions.vue
│   ├── SongLyrics.vue
│   ├── SongColorPicker.vue
│   ├── SongCollectionRow.vue
│   ├── SongCollectionCard.vue
│   ├── SongCollectionDialog.vue
│   ├── SongHistoryList.vue
│   ├── SongSelectionBar.vue
│   └── SongPresentationTray.vue
├── composables/
│   ├── useSongs.ts               # abrir/rastrear, refrescar letra, recientes
│   ├── useSongHistory.ts
│   ├── useSongCollections.ts
│   └── useSongPresentations.ts   # cola secuencial, estados, descarga y reintento
├── utils/
│   ├── form-schemas.ts           # + songUrlSchema, songCollectionSchema
│   ├── messages.ts               # + bloque songs
│   ├── download-blob.ts          # descarga de un Blob con el nombre de Content-Disposition
│   └── navigation.ts             # + entrada Canciones
└── …

nuxt.config.ts                    # + runtimeConfig.apifyBaseUrl; duración máxima de funciones (D15)
.env.example                      # + NUXT_APIFY_BASE_URL (vacío); NUXT_APIFY_API_KEY ya existe
AGENTS.md                         # frontera lyrics-crawler.ts en la regla IV y variables

test/
├── unit/        songs-url.spec.ts · lyrics-parser.spec.ts · lyrics-crawler.spec.ts · cloudy-api.spec.ts (+) · api-songs-*.spec.ts · songs-history.spec.ts · song-collections.spec.ts · architecture.spec.ts (+) · endpoint-guards.spec.ts (+) · permissions.spec.ts (+) · route-access.spec.ts (+)
│                fixtures/letras-song.html · letras-no-lyrics.html
├── nuxt/        SongUrlInput.spec.ts · SongLyrics.spec.ts · SongActions.spec.ts · SongCollectionCard.spec.ts · SongHistoryList.spec.ts · SongSelectionBar.spec.ts · SongPresentationTray.spec.ts · useSongPresentations.spec.ts · pages-canciones.spec.ts · form-schemas.spec.ts (+)
└── e2e/         songs-fetch.spec.ts · songs-presentation.spec.ts · songs-collections.spec.ts · songs-history.spec.ts · routes-guard.spec.ts (+)
                 setup/apify-stub.ts · setup/cloudy-api-stub.ts (+ POST /v1/lyrics/pptx) · setup/global-setup.ts (+ NUXT_APIFY_*)
```

**Structure Decision**: mismo proyecto Nuxt con la separación `app/` · `server/` · `shared/` de las features anteriores. Cada proveedor queda detrás de **un solo módulo de `server/utils/`** (Constitución IV): Apify en
`lyrics-crawler.ts`, el servicio de presentaciones en `cloudy-api.ts`. No se crea una carpeta nueva de servidor (un único proveedor y un único archivo con el SDK). El parser se separa del SDK para que sea
puro y pruebable sin red.

## Complexity Tracking

| Violación / adición | Why Needed | Simpler Alternative Rejected Because |
|---------------------|------------|--------------------------------------|
| Servicio externo nuevo: Apify (actor `apify/rag-web-browser`) | Letras.com responde `403` a una petición HTTP directa (verificado: `curl` con User-Agent de navegador) y exige un navegador real; las funciones de Vercel no ejecutan navegadores. Es lo que pidió la persona y el SDK ya está instalado | `fetch` directo desde Nuxt: bloqueado por Letras. Pedir el HTML al navegador de la persona: bloqueado por CORS |
| Un módulo de frontera más (`lyrics-crawler.ts`) separado del parser | El SDK y la red se simulan en un solo punto; el parser queda puro y con cobertura completa sin red | Un solo módulo con SDK + parseo: mezcla E/S y lógica, obliga a simular el SDK en cada prueba del parser |
| Parser HTML propio sin dependencia | La marca de la letra es sencilla (`p` + `br` dentro de un contenedor); evita sumar un paquete a una dependencia de servidor | `node-html-parser`/`linkedom`: dependencia nueva por una función de ~80 líneas. Si el fixture real (research D4, tarea inicial) demuestra que no basta, se añade y se registra aquí |
| Cola de presentaciones en el cliente (`useSongPresentations`) | Una canción por petición, una a la vez, para no saturar el servicio gratuito ni exceder el plazo de una función; el cliente ya sabe mostrar avance y cancelar | Un endpoint que genere N presentaciones en una petición: excede la duración de la función y mezcla fallos parciales |
