# Implementation Plan: Página YouTube — descargas y listas de reproducción

**Branch**: `005-youtube-downloads` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-youtube-downloads/spec.md` · Servicio: `C:\Users\andre.perez\Dev\cloudy-api` (FastAPI + pytubefix en Railway)

## Summary

El equipo pega un enlace de YouTube en una página nueva, ve el video en un reproductor con el tema de Cloudy y lo descarga como Video 720p, Video 1080p o Audio MP3.
También guarda videos en **listas** compartidas y consulta un **historial** del equipo, con descarga por lotes. La obtención y conversión las hace un servicio ajeno
(`cloudy-api`) que trabaja con **trabajos asíncronos**: Cloudy crea el trabajo, lo consulta y el navegador baja el archivo directo desde el servicio con un enlace firmado.

**Enfoque técnico**:

- **Una frontera** (Constitución IV): `server/utils/cloudy-api.ts` es la única puerta al servicio; guarda la clave, aplica plazos y traduce errores a español. El navegador solo
  conoce los endpoints `/api/youtube/**` y el enlace firmado final (research D1, D6).
- **Los trabajos viven en el servicio**, no en Postgres: el navegador los crea, los sondea cada 2,5 s y, para listas o selecciones de más de 10, encadena **un lote de hasta 10
  a la vez**. Una bandeja diferida en el layout los muestra y sobrevive a la navegación, no a la recarga (D2–D4).
- **Reproductor propio**: `<video>` nativo con barra daisyUI (`useMediaControls`, `useFullscreen`), alimentado por un trabajo `mp4_720` que se crea **solo al pulsar Reproducir**
  y se reutiliza para "Descargar 720p". Ventana externa = página de Cloudy, no el archivo (D5, D14).
- **Datos mínimos** (D9–D11): `youtube_videos` (video + historial compartido en la misma fila), `youtube_playlists` y `youtube_playlist_items`; migración `0005`. Historial con
  cursor keyset; listas con conteo y miniaturas por subconsulta.
- **Sin dependencias nuevas.** El servicio de descargas es el único servicio externo nuevo (Complexity Tracking).
- **Arranque en frío** del servicio en Railway (dormido, reiniciándose o desplegando): ping a `/healthz` al abrir la feature y banner con reintento (D7).
- **Hallazgo corregido** (commit 6871c03): `.env.example` declaraba `NUXT_CLOUDY_APIURL`, que no mapea a `runtimeConfig.cloudyApiUrl`; ahora es `NUXT_CLOUDY_API_URL` más `NUXT_CLOUDY_API_KEY` (D16).

## Technical Context

**Language/Version**: TypeScript 5 (estricto) · Vue 3.5 · Nuxt 4.6 (Nitro 2, h3 1) · Bun (local) / Node 22 (Vercel). El servicio es Python (FastAPI) y **no se modifica**.

**Primary Dependencies**:

- **Sin dependencias nuevas.**
- **Reutilizadas**:
  - Servidor: `session.ts` (`requireRole`), `validation.ts` (`readValid`, `queryValid`, `paramId`), `pagination.ts` (`encodeCursor`/`decodeCursor`), `db.ts`, `cron.ts` (limpieza diaria).
  - Compartido: `permissions.ts` (acción nueva `youtube.moderate`), `validation/core.ts`, `types/api.ts`.
  - Cliente: `useApi`/`useApiFetch`, `useToast`, `useConfirm`, `useRelativeTime`, `useFormSchema`, `SkeletonList`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `ActionMenu`.
  - VueUse: `useMediaControls`, `useFullscreen`, `useInfiniteScroll`, `useIntervalFn`, `useOnline`, `useDocumentVisibility`, `onKeyStroke`, `useBreakpoints`.

**Storage**:

- **Neon Postgres**: migración `0005` con 3 tablas nuevas, 2 índices parciales/compuestos y los CHECK de [data-model.md](./data-model.md). Sin enums nuevos.
- **Bucket**: sin cambios. Los archivos descargados nunca pasan por Cloudy ni se guardan (FR-030, FR-032).
- **Servicio de descargas**: estado de trabajos en memoria y archivos temporales (30 min); fuera de nuestro control y no se recupera tras un reinicio.

**Testing**: Vitest con los proyectos `unit`, `nuxt` y `e2e`.
- E2E contra un **stub del servicio** (`test/e2e/setup/cloudy-api-stub.ts`, `NUXT_CLOUDY_API_URL`), con el mismo patrón que el de OpenRouter; nunca llaman a YouTube ni al `cloudy-api` real (research D17).
- Unitarios con `fetch` simulado para `cloudy-api.ts` (clasificación de errores, plazos).

**Target Platform**: Vercel (preset `vercel`, Node) y navegadores desde 360 px. Reproducción con `<video>` MP4/H.264 y MP3.

**Project Type**: Aplicación web full-stack, el mismo proyecto Nuxt (`app/`, `server/`, `shared/`), más un servicio externo ya existente.

**Performance Goals**:

- Ficha del video con título, canal y miniatura en < 3 s con el servicio despierto (SC-002); depende de la sonda de pytubefix (D8).
- Primer bloque del historial con 5 000 entradas en < 2 s; INP < 200 ms al marcar casillas (SC-007).
- `YoutubePlayer`, `YoutubePlaylistDialog` y `YoutubeDownloadTray` son `Lazy*` con `v-if`: JS inicial de cada ruta ≤ 250 KB gzip.
- Sin sondeo de la feature cuando no hay trabajo activo ni pestaña oculta (el sondeo solo corre con un trabajo `queued/running/zipping`).

**Constraints**:

- Funciones sin estado: ningún trabajo ni cola en memoria del servidor; el estado de la descarga vive en el servicio y en el navegador.
- Los binarios no pasan por Vercel: descarga y reproducción van directo al servicio por enlace firmado (~10 min) (Principio I).
- Máximo 10 videos por trabajo, 30 min por video, archivo 30 min de vida, un trabajo a la vez en la instancia gratuita (README del servicio).
- `NUXT_CLOUDY_API_KEY` solo en el servidor; jamás en el cliente ni en respuestas (SC-009).
- Plazo máximo de la función de Vercel por confirmar para `POST /api/youtube/jobs` (research D8, quickstart §4).

**Scale/Scope**:

- Volumen: un equipo de decenas de personas, cientos de videos en el historial, decenas de listas.
- Servidor: 14 endpoints nuevos (`health`, `videos/:id`, 3 de `jobs`, 2 de `history`, 7 de `playlists`) y 1 módulo de frontera; 1 paso nuevo en la limpieza diaria.
- Cliente: 3 páginas nuevas (`index`, `[id]/index`, `[id]/ventana`), 1 layout (`player`), 12 componentes, 5 composables; `navigation.ts` ya tiene la entrada.
- 4 historias: US1 (P1, MVP) pegar enlace, ver ficha y descargar; US2 (P2) listas; US3 (P3) historial y selección por lotes; US4 (P4) pantalla completa y ventana externa.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluado contra la constitución **v1.1.1**.

| Principio | Pre-diseño | Post-diseño: cómo se cumple |
|-----------|------------|-----------------------------|
| **I. Rendimiento** | ✅ | Ver el detalle bajo la tabla. |
| **II. Funcional y efectivo** | ✅ (con justificación) | Ver el detalle bajo la tabla; el servicio externo se justifica en Complexity Tracking. |
| **III. Mobile first** | ✅ | Ver el detalle bajo la tabla. |
| **IV. Calidad de código** | ✅ | Ver el detalle bajo la tabla. |
| **V. Pruebas** | ✅ | Ver el detalle bajo la tabla. |
| **VI. Consistencia de UX** | ✅ | Ver el detalle bajo la tabla. |
| **Restricciones técnicas** | ✅ | Ver el detalle bajo la tabla. |
| **Flujo y gates** | ✅ | Rama `005-youtube-downloads` creada. Conventional Commits. DoD de AGENTS.md por fase (typecheck → tests → navegador). |

**Detalle de los principios**:

- **I. Rendimiento**:
  - Binarios fuera de Vercel: el navegador baja y reproduce directo del servicio con el `downloadUrl` firmado; `/api/youtube/**` solo mueve JSON.
  - Índice parcial para el historial y subconsultas para el conteo y las miniaturas de las listas: sin N+1 y sin OFFSET.
  - `YoutubePlayer`, `YoutubePlaylistDialog` y `YoutubeDownloadTray` diferidos; el sondeo solo existe con trabajo activo y se pausa sin conexión.
  - Miniaturas `<img loading="lazy" width height>`; la primera vista de `/youtube` (campo, listas, historial) con SSR.
  - El video no se pide al abrir la ficha, solo al pulsar Reproducir (protege la cola de la instancia gratuita).
- **II. Funcional y efectivo**:
  - 4 historias desplegables por separado en orden de prioridad (US1 → US4); US2 y US3 dependen de que la ficha registre videos (US1); la entrada "Agregar a lista" del menú del historial (US3) usa el diálogo de US2, por eso US3 se entrega después de US2. US4 solo depende de US1.
  - Sin dependencias nuevas; todo sale de VueUse, Nuxt, daisyUI y los utils existentes. Sin cuotas, sin reorden de listas, sin persistir trabajos: YAGNI.
  - Sin huérfanos: la creación de una lista con video es un solo `db.batch`; el trabajo fallido no deja filas (no se guardan); los videos sin historial ni listas se limpian a las 24 h.
  - Cada error dice qué hacer ("Reintenta en un momento", "Prepárala de nuevo", "Pega el de un video").
- **III. Mobile first**:
  - Campo y acciones `btn-block` a 360 px; filas con desplazamiento horizontal interno; el botón de descarga de lista es permanente en móvil y aparece con hover **y** foco en escritorio.
  - Casillas y botones ≥ 44 px; barra de selección fija abajo, al alcance del pulgar, con relleno para no tapar el último elemento.
  - Verificación a 360 px y ≥ 1280 px (quickstart §2–§3).
- **IV. Calidad de código**:
  - `requireRole(event, 'editor')` en los 14 endpoints; renombrar/eliminar una lista exige autor o `can(role, 'youtube.moderate')`. El barrido de `endpoint-guards.spec.ts` los cubre.
  - Reglas compartidas una sola vez en `shared/`: `constants/youtube.ts` (formatos, tope de 10, mensajes por código), `validation/youtube.ts` (`parseYoutubeUrl`, validadores), DTOs en `types/api.ts`.
  - Frontera del servicio en `server/utils/cloudy-api.ts` y `architecture.spec.ts` impide leer `cloudyApiUrl`/`cloudyApiKey` o llamar al servicio fuera de ese módulo.
  - Formularios por `useFormSchema` con `youtubeUrlSchema` y `youtubePlaylistSchema`; mensajes por `serverMessage()`.
  - `<script setup lang="ts">`, componentes pequeños, lógica en composables.
- **V. Pruebas**:
  - Unitarias: `parseYoutubeUrl` (formatos y rechazos), validadores, `chunkVideoIds`, `cloudy-api.ts` (clasificación, plazos, sin fuga de la clave), upsert de historial, keyset, reglas de lista (autor/admin), permiso nuevo y guards.
  - Componente: `YoutubeUrlInput`, `YoutubePlayer` (estados), `YoutubeHistoryList` (selección), `YoutubePlaylistCard`, bandeja, `form-schemas.spec.ts`.
  - E2E (stub del servicio): US1 a US4 y rutas protegidas (sin sesión y rol incorrecto); escenarios de video privado, muy largo, servicio caído y lote con fallo parcial.
  - Cobertura global 92 % del proyecto; `server/utils/**` y `shared/**` ≥ 80 %.
- **VI. Consistencia de UX**:
  - Solo tokens de color de daisyUI; lucide; DM Sans; `SkeletonList`/`EmptyState`/`ErrorState` en listas, historial y ficha; `ConfirmDialog` al eliminar listas y quitar del historial; toasts por acción.
  - Copy en español en `app/utils/messages.ts` y `shared/constants/youtube.ts`; sin `text-warning` sobre `base-100` claro.
  - Reproductor y barra operables por teclado, con etiquetas y `prefers-reduced-motion`.
- **Restricciones técnicas**:
  - Stack sin cambios; sin estado en el servidor; secretos solo como `NUXT_CLOUDY_API_URL`/`NUXT_CLOUDY_API_KEY` mediante `runtimeConfig`.
  - Esquema solo con migración Drizzle `0005`; la persona la aplica a cada rama.
  - Privacidad: no se guardan datos personales nuevos; las listas e historial guardan ID de video y autoría de miembros del equipo; las miniaturas se cargan desde `i.ytimg.com` (D15).

**Reevaluación post-diseño**: sin violaciones. Un servicio externo nuevo requiere la justificación de abajo; no hay excepciones a los presupuestos de rendimiento.

## Project Structure

### Documentation (this feature)

```text
specs/005-youtube-downloads/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   ├── api.md           # 14 endpoints /api/youtube/**
│   └── ui.md            # páginas, componentes, composables, estados y textos
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
shared/
├── constants/youtube.ts          # YOUTUBE_FORMATS, MAX_BATCH, VIDEO_ID_RE, ITEM_ERROR_MESSAGES, BLOCK_REASON_MESSAGES, chunkVideoIds
├── validation/youtube.ts         # parseYoutubeUrl, youtubeJobInput, youtubePlaylistInput, youtubePlaylistRename, youtubeHistoryQuery
├── permissions.ts                # + acción 'youtube.moderate' (solo admin)
└── types/api.ts                  # + DTOs Youtube* (data-model.md)

server/
├── db/schema.ts                  # + youtube_videos, youtube_playlists, youtube_playlist_items
├── utils/
│   ├── cloudy-api.ts             # ÚNICA frontera con el servicio de descargas (D1, D6, D8)
│   ├── youtube-videos.ts         # upsert de video + historial, keyset, toYoutube* mappers
│   ├── youtube-playlists.ts      # lecturas con subconsultas, reglas de autor/admin
│   └── cron.ts                   # + borrado de videos huérfanos (> 24 h)
└── api/youtube/
    ├── health.get.ts
    ├── videos/[videoId].get.ts
    ├── jobs/index.post.ts
    ├── jobs/[jobId].get.ts
    ├── jobs/[jobId].delete.ts
    ├── history/index.get.ts
    ├── history/[videoId].delete.ts
    ├── playlists/index.get.ts
    ├── playlists/index.post.ts
    ├── playlists/[id]/index.get.ts
    ├── playlists/[id]/index.patch.ts
    ├── playlists/[id]/index.delete.ts
    ├── playlists/[id]/items/index.post.ts
    └── playlists/[id]/items/[videoId].delete.ts

drizzle/0005_*.sql                # generada con bun run db:generate

app/
├── pages/youtube/
│   ├── index.vue                 # reemplaza al stub app/pages/youtube.vue (se mueve, ver D14)
│   ├── [id]/index.vue            # ficha del video
│   └── [id]/ventana.vue          # ventana externa (layout player)
├── layouts/player.vue            # sin barra lateral, fondo bg-base-300
├── layouts/dashboard.vue         # + <LazyYoutubeDownloadTray v-if="…"> (montaje diferido)
├── components/youtube/
│   ├── YoutubeUrlInput.vue
│   ├── YoutubeServiceBanner.vue
│   ├── YoutubePlaylistRow.vue
│   ├── YoutubePlaylistCard.vue
│   ├── YoutubePlaylistDialog.vue
│   ├── YoutubeHistoryList.vue
│   ├── YoutubeVideoCard.vue
│   ├── YoutubeSelectionBar.vue
│   ├── YoutubeFormatPicker.vue
│   ├── YoutubePlayer.vue
│   ├── YoutubeVideoMeta.vue
│   └── YoutubeDownloadTray.vue
├── composables/
│   ├── useYoutubeService.ts
│   ├── useYoutubeDownloads.ts
│   ├── useYoutubePlayback.ts
│   ├── useYoutubeHistory.ts
│   └── useYoutubePlaylists.ts
├── utils/
│   ├── form-schemas.ts           # + youtubeUrlSchema, youtubePlaylistSchema
│   ├── messages.ts               # + bloque youtube
│   └── navigation.ts             # entrada YouTube (ya existe)
└── …

nuxt.config.ts                    # runtimeConfig.cloudyApiUrl / cloudyApiKey (ya existen)
.env.example                      # corregir NUXT_CLOUDY_API_URL y añadir NUXT_CLOUDY_API_KEY

test/
├── unit/        youtube-url.spec.ts · youtube-validation.spec.ts · cloudy-api.spec.ts · api-youtube-*.spec.ts · architecture.spec.ts (+) · endpoint-guards.spec.ts (+) · permissions.spec.ts (+)
├── nuxt/        YoutubeUrlInput.spec.ts · YoutubePlayer.spec.ts · YoutubeHistoryList.spec.ts · YoutubePlaylistCard.spec.ts · pages-youtube.spec.ts · form-schemas.spec.ts (+)
└── e2e/         youtube-download.spec.ts · youtube-playlists.spec.ts · youtube-history.spec.ts · youtube-player.spec.ts · routes-guard.spec.ts (+)
                 setup/cloudy-api-stub.ts
```

**Structure Decision**: mismo proyecto Nuxt con la separación `app/` · `server/` · `shared/` de las features anteriores. El servicio de descargas queda en su repositorio
(`cloudy-api`), consumido por HTTP detrás de `server/utils/cloudy-api.ts`; no se agrega carpeta nueva de servidor porque la frontera cabe en un solo módulo (Constitución IV).

## Complexity Tracking

| Violación / adición | Why Needed | Simpler Alternative Rejected Because |
|---------------------|------------|--------------------------------------|
| Servicio externo nuevo: `cloudy-api` (FastAPI + pytubefix en Railway) | Descargar y convertir de YouTube necesita pytubefix, ffmpeg y un runtime de JavaScript, imposibles en funciones de Vercel (límite de cuerpo, duración y binarios del sistema). Es lo que pidió la persona y ya está construido | Hacerlo dentro de Nuxt: ni ffmpeg ni archivos temporales de minutos caben en funciones sin estado (Principio I y Despliegue) |
| Una segunda unidad desplegable con estado en memoria (el servicio) | El servicio es la fuente de verdad de los trabajos y de sus archivos temporales; Cloudy lo trata como no recuperable | Duplicar los trabajos en Postgres obliga a sincronizar un estado de 30 min que se pierde si el servicio reinicia o se redespliega (research D2) |
| Orquestación de lotes en el cliente (`useYoutubeDownloads`) | Un lote a la vez evita el `429 queue_full` y muestra el avance; las funciones de Vercel no pueden esperar minutos | Encolar todo de golpe (429 con listas grandes) o un endpoint que espere el lote (excede el tiempo de la función) |
