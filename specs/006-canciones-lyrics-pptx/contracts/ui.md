# Contrato de UI: páginas, componentes, composables, estados y textos

Todo el copy en español; colores solo con tokens daisyUI; íconos lucide; DM Sans. A 360 px sin desplazamiento horizontal y objetivos táctiles ≥ 44 px (no usar `btn-sm`/`btn-xs` como tamaño base).
La interfaz **sigue la forma de la página YouTube** (feature 005); cada pieza indica su equivalente.

## Rutas

| Ruta | Archivo | Acceso |
|------|---------|--------|
| `/canciones` | `app/pages/canciones/index.vue` | `definePageMeta({ layout: 'dashboard', access: 'private', roles: ['editor', 'admin'] })` |
| `/canciones/<id>` | `app/pages/canciones/[id].vue` | igual |

Entrada **Canciones** (`lucide:music`) en `app/utils/navigation.ts`, roles `TEAM`; `route-access.spec.ts` se amplía con las dos rutas.

## Página índice — `/canciones` (equivale a `/youtube`)

Orden vertical, igual que YouTube:

1. Encabezado: `<h1>Canciones</h1>` + «Pega el enlace de una canción de Letras.com para ver su letra y descargar la presentación.»
2. `YoutubeServiceBanner` (reutilizado) si el servicio no está `up`/`unknown`; `useYoutubeService()` despierta el servicio al abrir (FR-018).
3. `SongUrlInput`.
4. `SongCollectionRow` — fila **Colecciones** (equivale a `YoutubePlaylistRow`).
5. Sección **Historial** (`SongHistoryList`, equivale a `YoutubeHistoryList`), con selección múltiple. Sin interruptor «Descargas»: no existe equivalente.
6. `SongSelectionBar` (si hay selección) y diálogos `Lazy*` (`SongCollectionDialog`).

La selección vive en `useState('songs-history-selected')` para sobrevivir a un reintento.

## Página de canción — `/canciones/<id>` (equivale a `/youtube/<id>`)

De arriba abajo (FR-010, clarificación 2026-11-05):

1. **Metadatos** — `SongMeta`: título (`<h1>`), artista, enlace «Ver en Letras.com» (`target="_blank" rel="noopener noreferrer"`), «Obtenida {relativo}».
2. **Acciones** — `SongActions`: **Generar presentación** (primario) con la nota `present.whiteHint` debajo, **Crear colección** / **Agregar a colección**, **Volver a obtener la letra** (secundario, con `ConfirmDialog`).
   No hay selector de color (la letra va en blanco, D12). A 360 px los botones ocupan el ancho y se acomodan en varias filas; el orden visual es el del DOM.
3. **Letra** — `SongLyrics`: estrofas como `<p>`/líneas en solo lectura, `whitespace-pre-line`, ancho de lectura cómodo; contador «N líneas»; aviso si pasa de 300 (genera deshabilitado con motivo).
4. **Historial reciente** — `SongHistoryList` con `recent` (12, sin la canción actual), debajo de la letra.

Registra la vista al cargar (`GET /api/songs/[id]`). Estados de la ficha: cargando (`SkeletonList`), no encontrada (`ErrorState`/`EmptyState` con «Volver a Canciones»), error con reintento, contenido.

## Componentes (`app/components/songs/`)

| Componente | Equivale a | Responsabilidad | Props / eventos |
|------------|------------|-----------------|-----------------|
| `SongUrlInput` | `YoutubeUrlInput` | Campo grande; valida con `songUrlSchema`; espera visible durante el rastreo («Buscando la letra…») | `busy` · `submit(url)` |
| `SongMeta` | `YoutubeVideoMeta` | Título, artista, origen, fecha | `song` |
| `SongActions` | acciones de `YoutubeVideoMeta` | Botones de la ficha; deshabilita **Generar** mientras corre y por letra demasiado larga; muestra `present.whiteHint` | `song`, `generating` · `generate`, `collection`, `refresh` |
| `SongLyrics` | `YoutubePlayer` (zona superior) | Lectura de la letra por estrofas | `stanzas` |
| `SongCollectionRow` | `YoutubePlaylistRow` | Fila **Colecciones** con sus cuatro estados y el botón **Nueva colección** en la cabecera de la fila y en el estado vacío (FR-020) | `collections`, `pending`, `error` · `retry`, `open`, `generate`, `create` |
| `SongCollectionCard` | `YoutubePlaylistCard` | Tarjeta (ícono, nombre, conteo, autor); botón de generar visible siempre en móvil y con hover **y** foco desde `lg:` | `collection` · `open`, `generate` |
| `SongCollectionDialog` | `YoutubePlaylistDialog` | Crear una colección (vacía desde la fila, o con la canción actual) / elegir colección desde una canción; ver una colección, renombrar, quitar canciones, generar una | `collectionId?`, `songId?`, `songTitle?` · `close` (sin `songId` ni `collectionId` = modo **crear vacía**) |
| `SongHistoryList` | `YoutubeHistoryList` | Rejilla con casillas, centinela de siguiente página, acciones por entrada (abrir, agregar a colección, generar, quitar) | `v-model:selected`, `recent?`, `exclude?` · `collection`, `generate` |
| `SongSelectionBar` | `YoutubeSelectionBar` | Barra fija abajo: conteo, «N archivos», **Generar selección**, **Limpiar** | `count` · `generate`, `clear` |
| `SongPresentationTray` | `YoutubeDownloadTray` | Bandeja con la cola; avance por canción, nota de reparto de respaldo, **Cancelar**, **Reintentar**, **Descargar de nuevo**, **Descartar** | — (lee `useSongPresentations`) |

Se **reutilizan sin cambios**: `YoutubeServiceBanner`, `SkeletonList`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `ActionMenu`.

`SongPresentationTray` se monta diferido en `app/layouts/dashboard.vue`: `<LazySongPresentationTray v-if="presentations.hasItems" />`. Si la bandeja de YouTube también está visible, la de canciones se apoya encima
(`bottom: var(--youtube-tray-h, 0px)`) y publica su alto en `--song-tray-h`, que usa `SongSelectionBar` como `YoutubeSelectionBar` usa `--youtube-tray-h`.

## Composables (`app/composables/`)

| Composable | Responsabilidad |
|------------|-----------------|
| `useSongs()` | `open(url)`: `POST /api/songs/fetch` + `navigateTo('/canciones/<id>')`; `useSong(id)` (ficha, `useApiFetch`); `refreshLyrics(id)` con confirmación y aviso |
| `useSongHistory({ exclude?, recent? })` | Clon de `useYoutubeHistory` sobre `/api/songs/history`: primera página con SSR, `loadMore`, `remove` con confirmación |
| `useSongCollections()` / `useSongCollectionList()` | Clon de `useYoutubePlaylists`: crear (vacía o con canción), renombrar, eliminar, agregar/quitar canción, `canManage` con `can(role, 'songs.moderate')`, `generate(collectionId)` (confirma con `filesFor(n)` y encola); clave `song-collections` |
| `useSongPresentations()` | Cola secuencial en `useState` (D10): `enqueue(songs)`, `cancel`, `retry`, `dismiss`, `redownload`, `filesFor(n)`; usa `download-blob.ts`; `504` cuenta como transitorio |

`app/utils/download-blob.ts`: `downloadBlob(blob, headers)` toma el nombre de `Content-Disposition` (`filename*` primero, luego `filename`, luego `canciones.pptx`) y dispara la descarga; revoca el `objectURL` al descartar.

## Estados (cuatro por vista de datos, FR-031)

| Vista | Cargando | Vacío | Error | Contenido |
|-------|----------|-------|-------|-----------|
| Colecciones | `SkeletonList variant="grid"` | `EmptyState` «Aún no hay colecciones» · «Crea la primera aquí o desde una canción.» con el botón **Nueva colección** | `ErrorState` + reintento | Tarjetas |
| Historial | `SkeletonList` | «Todavía no hay canciones» · «Pega el primer enlace arriba.» | `ErrorState` + reintento; «Cargar más» con su propio error | Rejilla con casillas |
| Ficha | `SkeletonList` | — | `ErrorState` / «Esa canción ya no existe» | Metadatos, acciones, letra |
| Bandeja | — | no se monta | fila `failed` con motivo y acción | filas por canción |

Rastreo (campo): espera con spinner y `aria-busy`; errores junto al campo con `role="alert"`.

## Textos (en `app/utils/messages.ts › songs` y `shared/constants/songs.ts`)

| Clave | Texto |
|-------|-------|
| `url.not_https` | Pega un enlace que empiece con https://, por ejemplo https://www.letras.com/artista/cancion/ |
| `url.not_letras` | Solo aceptamos enlaces de Letras.com (letras.com o www.letras.com). |
| `url.not_song` | Ese enlace no es de una canción. Abre la canción en Letras.com y copia su enlace. |
| `url.credentials` | Ese enlace no es válido. Cópialo de nuevo desde Letras.com. |
| `fetch.searching` | Buscando la letra… puede tardar unos segundos |
| `fetch.no_lyrics` | No encontramos una letra en ese enlace. |
| `fetch.crawl_failed` | No pudimos leer la página de la canción. Intenta de nuevo en un momento. |
| `fetch.quota` | Se agotó el crédito del servicio de rastreo. Avisa a un administrador. |
| `fetch.not_configured` | El rastreo de letras no está configurado. Avisa a un administrador. |
| `present.lyrics_too_long` | Eso no parece una canción: la letra pasa de 300 líneas. |
| `present.no_lyrics` | La letra guardada no tiene contenido. Vuelve a obtenerla. |
| `present.fallback` | Las diapositivas se agruparon automáticamente (el reparto con IA no estuvo disponible). |
| `present.whiteHint` | La letra va en blanco: proyecta la presentación sobre un fondo oscuro. |
| `present.done(n)` | {n} diapositivas generadas |
| `present.filesCount(n)` | Recibirás {n} archivos, uno por canción. |
| `present.blocked` | Tu navegador pudo bloquear las descargas seguidas. Usa «Descargar de nuevo» en las que falten. |
| `refresh.confirm` | ¿Volver a obtener la letra? Reemplaza la guardada si el nuevo rastreo tiene éxito. |
| `collection.*` | Las mismas frases que `youtube.playlists`, con «colección» (creada, renombrada, eliminada, ya estaba, etc.); `collection.new` = «Nueva colección» |
| `inactiveUser` | Usuario inactivo (se reutiliza `messages.youtube.inactiveUser`) |

Los mensajes de error del servidor llegan por `serverMessage(error, fallback, byStatus)`; el `503` se nombra explícitamente (`waking`/`busy`/`quota`).

## Accesibilidad y movimiento

Foco visible en todos los controles; la letra es texto real (lectores de pantalla); el cambio de estado del rastreo y de la bandeja usa
`role="status"`; `motion-reduce` en animaciones (spinner). Contraste AA en `cloudy` y `cloudy-light`; sin `text-warning` sobre `base-100` claro.

## Pruebas de UI

- Componente (`test/nuxt/`): `SongUrlInput` (inválidos, espera, emite la URL), `SongLyrics`, `SongActions` (deshabilitado por letra larga y mientras genera), `SongCollectionCard` (acciones por teclado),
  `SongHistoryList` (selección), `SongSelectionBar`, `SongPresentationTray` y `useSongPresentations` (secuencia de una en una, cancelación, reintento solo transitorio, nota de respaldo), `pages-canciones.spec.ts`.
- E2E (`test/e2e/songs-*.spec.ts`): US1–US4 con stubs; sin sesión y rol equivocado en ambas rutas; 360 px y 1280 px.
