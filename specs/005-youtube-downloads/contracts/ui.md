# Contrato de UI: Página YouTube

**Feature**: [spec.md](../spec.md) · **API**: [api.md](./api.md)

Reglas de siempre: mobile first (360 px base, `lg:` amplía), `btn` base (nunca `btn-sm`/`btn-xs` como base), iconos lucide, colores solo con clases semánticas de
daisyUI, copy en `app/utils/messages.ts`, errores HTTP con `serverMessage()`, cuatro estados con `SkeletonList`/`EmptyState`/`ErrorState`, datos con `useApiFetch`.
Rutas de equipo (`access: 'private'`, roles editor y admin). Entrada en `navItems`: `{ to: '/youtube', label: 'YouTube', icon: 'lucide:circle-play', roles: TEAM }`
(ya existe, sin versionar).

## Páginas

### `/youtube` (`app/pages/youtube/index.vue`, FR-001, FR-004, FR-019, FR-024)

De arriba abajo, una sola columna:

1. **Encabezado** "YouTube" + `YoutubeServiceBanner` (solo si el servicio no está `up`).
2. **`YoutubeUrlInput`**: `<form>` con `input input-lg` a todo el ancho, `label` visible "Enlace de YouTube", `placeholder` "Pega aquí el enlace de un video" y `btn btn-primary`
   "Ver video" (icono `lucide:search`, `btn-block` en móvil). Valida con `youtubeUrlSchema` vía `useFormSchema`; el error aparece bajo el campo en el patrón de los demás
   formularios. Al enviar un enlace válido: `navigateTo('/youtube/<id>')`.
3. **Fila "Listas"** (`YoutubePlaylistRow`): desplazable horizontalmente dentro de su contenedor (sin scroll de página) con `YoutubePlaylistCard` (`card`, 4 miniaturas en
   rejilla 2×2, nombre, "N videos", autor con `Avatar`/texto "Creada por {nombre}"). Botón **Descargar lista** (`btn btn-circle`, icono `lucide:download`, `aria-label`
   "Descargar {nombre}"): **visible siempre en móvil**; desde `lg:` aparece con `group-hover` **y** `group-focus-within` (teclado). Tocar la tarjeta abre el detalle (§ Diálogo de lista).
   Botón "Nueva lista" solo desde la ficha de un video (no hay lista sin video, FR-015) — en la fila vacío el `EmptyState` lo explica.
4. **Fila "Historial"** (`YoutubeHistoryList`): rejilla de `YoutubeVideoCard` (miniatura 16:9 con duración, título a 2 líneas, canal, "{nombre} · hace N"). Cada tarjeta lleva una
   `checkbox` (área táctil ≥ 44 px, `aria-label` "Seleccionar {título}"). Con ≥ 1 marcado aparece `YoutubeSelectionBar` fija abajo: "N seleccionados", `YoutubeFormatPicker` y
   `btn btn-primary` "Descargar selección" + `btn btn-ghost` "Limpiar". `useInfiniteScroll` pide la página siguiente (24); al fallar una página, `ErrorState` inline con Reintentar.
   Menú `ActionMenu` por tarjeta: Abrir · Agregar a lista · Descargar · Quitar del historial (`ConfirmDialog`).

| Vista | cargando | vacío | error | contenido |
|-------|----------|-------|-------|-----------|
| Listas | `SkeletonList` (3 tarjetas) | `EmptyState` "Aún no hay listas" + "Abre un video y pulsa Crear lista" | `ErrorState` + Reintentar | `YoutubePlaylistCard` |
| Historial | `SkeletonList` (6 tarjetas) | `EmptyState` "Todavía no hay videos" + "Pega el primer enlace arriba" | `ErrorState` + Reintentar | `YoutubeVideoCard` |

### `/youtube/:id` (`app/pages/youtube/[id]/index.vue`, FR-006, FR-012, FR-013, FR-026)

1. **Reproductor** (`YoutubePlayer`, carga diferida): contenedor `aspect-video` de ancho completo, tema `cloudy`. Estados:

   | Estado | Qué se ve |
   |--------|-----------|
   | `idle` | Miniatura como póster, botón grande `btn btn-primary btn-circle` Reproducir (icono `lucide:play`, `aria-label` "Preparar y reproducir") y texto "Se prepara una copia en 720p, puede tardar un momento." |
   | `preparing` | Póster atenuado, `progress` con el avance del trabajo y texto "Preparando el video… N %" con `role="status"`; **Cancelar** |
   | `ready` | `<video>` nativo; barra de controles daisyUI: Reproducir/Pausar, `range` de avance (`aria-label` "Posición"), tiempo, `range` de volumen + silencio, Pantalla completa. Autoplay al quedar listo |
   | `error` | `ErrorState` ("No pudimos preparar el video") + Reintentar; los metadatos y las descargas siguen disponibles |
   | `expired` | Mensaje "La copia expiró" + **Preparar de nuevo** |

   Atajos con foco en el reproductor: Espacio/K play-pausa, ←/→ ±5 s, ↑/↓ volumen, F pantalla completa (`onKeyStroke`), Escape sale.
2. **Metadatos y acciones** (`YoutubeVideoMeta`): título (`h1`), canal, duración, calidades disponibles como `badge`. Fila de acciones (`btn` base, en móvil se
   apilan en una columna de `btn-block`, desde `sm:` en fila):
   - **Descargar** (`btn-primary`): abre `YoutubeFormatPicker` (menú con Video 720p · Video 1080p · Audio MP3; 1080p solo si `availableHeights` lo alcanza o se avisa
     "se entregará la mayor calidad disponible"). Deshabilitado con `title` y texto de la razón si `downloadable = false` (`BLOCK_REASON_MESSAGES`).
   - **Crear lista** → `LazyYoutubePlaylistDialog` (modal): pestañas "Nueva lista" (campo Nombre) y "Agregar a una existente" (`select` o lista de botones). Toast "Lista creada" /
     "Agregado a {lista}" / "Ya estaba en {lista}".
   - **Pantalla completa** (`lucide:maximize`) y **Abrir en ventana nueva** (`lucide:external-link`): `disabled` hasta `ready`, con texto de ayuda "Prepara el video para usar estas acciones".
3. **Fila "Historial reciente"**: `YoutubeVideoCard` en una fila desplazable (12, `exclude` = el video actual), sin casillas; mismo estado vacío/cargando/error.

Estados de la ficha: cargando (`SkeletonList` con póster y líneas), error de video (`ErrorState` con el motivo y "Volver a YouTube"), servicio dormido (`YoutubeServiceBanner` + Reintentar),
contenido. Un ID con forma inválida → 404 de Nuxt (`createError`).

### `/youtube/:id/ventana` (`app/pages/youtube/[id]/ventana.vue`, layout `player`, FR-013)

Layout sin barra lateral (`app/layouts/player.vue`): fondo `bg-base-300`, el `YoutubePlayer` ocupa el viewport, título pequeño sobre la barra. Lee `?job=<jobId>` y reproduce
(`ready` directo). Sin `job` o con trabajo expirado → estado `idle`/`expired` con **Preparar de nuevo**. El botón "Cerrar ventana" llama `window.close()`.

## Componentes

| Componente | Responsabilidad | Props / eventos clave |
|------------|-----------------|-----------------------|
| `YoutubeUrlInput` | campo grande + validación del enlace | emite `submit(videoId)` |
| `YoutubeServiceBanner` | `alert` "Despertando el servicio…" / "ocupado" con Reintentar | `state`, emite `retry` |
| `YoutubePlaylistRow` / `YoutubePlaylistCard` | fila de listas; tarjeta con 4 miniaturas, autor y botón descargar | `playlist`, emite `open`, `download` |
| `YoutubePlaylistDialog` (`Lazy`) | crear lista / agregar a existente / detalle de lista (ver, quitar, renombrar, eliminar) | `videoId?`, `playlistId?` |
| `YoutubeHistoryList` | rejilla con selección múltiple y `useInfiniteScroll` | `v-model:selected`, emite `download` |
| `YoutubeVideoCard` | miniatura, duración, título, canal, quién y cuándo, casilla opcional, `ActionMenu` | `video`, `selectable?` |
| `YoutubeSelectionBar` | barra fija con N, formato, Descargar, Limpiar | `count`, emite `download(format)`, `clear` |
| `YoutubeFormatPicker` | menú de formato (radio) | `v-model`, `heights?` |
| `YoutubePlayer` | `<video>` + controles + estados de preparación | `videoId`, `poster`, `initialJobId?`, expone `fullscreen()` |
| `YoutubeVideoMeta` | título, canal, duración, acciones | `video` |
| `YoutubeDownloadTray` (`Lazy`, en layout `dashboard`) | bandeja de trabajos: nombre, lote N de M, avance, estado por video, Guardar archivo, Cancelar | estado de `useYoutubeDownloads` |

## Composables

| Composable | Responsabilidad |
|------------|-----------------|
| `useYoutubeService` | `GET /health`, estado `up/waking/down`, reintento cada 5 s mientras no esté `up` |
| `useYoutubeDownloads` | `useState` con trabajos y lotes pendientes; `enqueue(videoIds, format, label)` parte con `chunkVideoIds`, crea un lote a la vez, sondea cada 2,5 s, dispara el guardado y expone `cancel`, `retry`, `saveAgain` |
| `useYoutubePlayback` | crea/reutiliza el trabajo `mp4_720`, sondea, renueva la firma al fallar el `<video>`, estados `idle/preparing/ready/error/expired` |
| `useYoutubeHistory` | `useApiFetch` + `useInfiniteScroll`, `remove(videoId)` con confirmación y toast |
| `useYoutubePlaylists` | listado, crear, renombrar, eliminar, agregar y quitar con toasts y `refresh` |

## Textos (`app/utils/messages.ts`, bloque `youtube`)

- Toasts: lista creada/renombrada/eliminada, video agregado/quitado/"ya estaba", descarga lista ("Tu archivo está listo"), lote N de M, historial limpiado.
- Errores de campo: `youtubeUrl.*` por `reason` de `parseYoutubeUrl` (`not_url`: "Pega un enlace completo, por ejemplo https://youtu.be/…"; `playlist`: "Ese enlace es de una lista
  de YouTube. Pega el de un video."; `not_youtube`: "Solo aceptamos enlaces de YouTube"; …).
- Estados del servicio y de los trabajos: `waking`, `busy`, `expired`, `notConfigured`; por elemento: `ITEM_ERROR_MESSAGES` y `BLOCK_REASON_MESSAGES` (`shared/constants/youtube.ts`).
- Aviso breve de cumplimiento (assumptions) en la ficha, `text-base-content/70` (sin `text-warning`).

## Accesibilidad y mobile

- 360 px: campo y botones `btn-block`; filas con `overflow-x-auto` interno y `snap-x`; sin scroll de página. `YoutubeSelectionBar` respeta el área segura inferior y no tapa el
  último elemento (padding inferior de la página cuando hay selección).
- Todo control con etiqueta; foco visible; barra del reproductor operable con teclado; los avances se anuncian en una región `role="status" aria-live="polite"` (sin anunciar cada 2,5 s: solo
  cambios de estado y cada 25 % de avance).
- `prefers-reduced-motion`: sin autoplay animado de póster, `loading` sin animación continua.
- Nada depende de `hover`: el botón de descarga de la lista es permanente en móvil y aparece también con foco en escritorio.
