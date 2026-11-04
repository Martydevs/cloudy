# Contrato de UI: Página YouTube

**Feature**: [spec.md](../spec.md) · **API**: [api.md](./api.md)

Reglas de siempre: mobile first (360 px base, `lg:` amplía), `btn` base (nunca `btn-sm`/`btn-xs` como base), iconos lucide, colores solo con clases semánticas de
daisyUI, copy en `app/utils/messages.ts`, errores HTTP con `serverMessage()`, cuatro estados con `SkeletonList`/`EmptyState`/`ErrorState`, datos con `useApiFetch`.
Rutas de equipo (`access: 'private'`, roles editor y admin). Entrada en `navItems`: `{ to: '/youtube', label: 'YouTube', icon: 'lucide:circle-play', roles: TEAM }`
(ya existe).

## Páginas

### `/youtube` (`app/pages/youtube/index.vue`, FR-001, FR-004, FR-019, FR-024, FR-033)

De arriba abajo, una sola columna:

1. **Encabezado** "YouTube" + `YoutubeServiceBanner` (solo si el servicio no está `up`).
2. **`YoutubeUrlInput`**: `<form>` con `input input-lg` a todo el ancho, `label` visible "Enlace de YouTube", `placeholder` "Pega aquí el enlace de un video" y `btn btn-primary`
   "Ver video" (icono `lucide:search`, `btn-block` en móvil). Valida con `youtubeUrlSchema` vía `useFormSchema`; el error aparece bajo el campo en el patrón de los demás
   formularios. Al enviar un enlace válido: `navigateTo('/youtube/<id>')`.
3. **Fila "Listas"** (`YoutubePlaylistRow`): desplazable horizontalmente dentro de su contenedor (sin scroll de página) con `YoutubePlaylistCard` (`card`, 4 miniaturas en
   rejilla 2×2, nombre, "N videos", autor con `Avatar`/texto "Creada por {nombre}"). Botón de **opciones** (`ActionMenu` ⋯, `aria-label` "Opciones de {nombre}", deshabilitado con 0 videos):
   **visible siempre en móvil**; desde `lg:` aparece con `group-hover` **y** `group-focus-within` (teclado). Su menú (`role="menu"`) agrupa, en este orden: *Descargar video 720p*,
   *Descargar video 1080p*, *Descargar audio MP3* (descarga por lotes de 10) y *Guardar en el drive: video 720p* / *audio MP3* (FR-033). Tocar la tarjeta abre el detalle (§ Diálogo de lista).
   El menú es **flotante** (`ActionMenu` con `floating`: se dibuja en `body` con posición fija junto al botón, hacia abajo o hacia arriba según el espacio, y se cierra al desplazar, redimensionar o con Esc), porque la fila con `overflow-x-auto` recortaba sus últimas opciones.
   Botón "Nueva lista" solo desde la ficha de un video (no hay lista sin video, FR-015) — en la fila vacío el `EmptyState` lo explica.
4. **Fila "Historial"** (`YoutubeHistoryList`): rejilla de `YoutubeVideoCard` (miniatura 16:9 con duración, título a 2 líneas, canal, "{nombre} · hace N"). Cada tarjeta lleva una
   `checkbox` (área táctil ≥ 44 px, `aria-label` "Seleccionar {título}"). Con ≥ 1 marcado aparece `YoutubeSelectionBar` fija abajo: "N seleccionados", `YoutubeFormatPicker` y
   `btn btn-primary` "Descargar selección", un segundo `YoutubeFormatPicker` secundario **Guardar en el drive** (`lucide:hard-drive-upload`, solo Video 720p y Audio MP3) y `btn btn-ghost` "Limpiar". En móvil «Limpiar» sube a la fila del conteo (posición absoluta arriba a la derecha) para que la barra, apilada sobre la bandeja, ocupe menos pantalla.
   `useInfiniteScroll` pide la página siguiente (24); al fallar una página, `ErrorState` inline con Reintentar.
   Menú `ActionMenu` por tarjeta: Abrir · Agregar a lista · Descargar video 720p / audio MP3 · **Guardar en el drive: video 720p / audio MP3** (sube ese video directo, sin diálogo) · Quitar del historial (`ConfirmDialog`).
   **Guardar en el drive con varios videos** (selección de ≥ 2 o una lista): elegir el formato abre `LazyYoutubeDriveDialog` (modal, `modal-bottom sm:modal-middle`) con una lista de casillas
   (todas marcadas, área táctil ≥ 44 px, `aria-label` "Guardar {título}"), «Marcar todos / Quitar todos», contador `role="status"`, nota del tope de 100 MB si el formato es video y botón
   `btn-primary` «Subir N al drive» (deshabilitado con 0). Un video que ya se está guardando aparece deshabilitado («Ya se está guardando»). Con **un** solo video seleccionado se sube directo.
   Al confirmar: toast «Se guardarán N videos en el drive», se cierra el diálogo y, si venía de la barra, se limpia la selección. El avance está en la bandeja (§ Bandeja).
   El encabezado de esta sección es de la página: `h2` («Historial» o «Descargas») y, a su derecha, un interruptor `join` de dos `btn` con `aria-pressed`
   (grupo «Cambiar de sección») para alternar con **«Descargas»**. El historial se oculta sin desmontarlo (conserva páginas y selección) y la barra de selección solo se muestra en él.
5. **Sección "Descargas"** (`YoutubeDownloadsGrid`, se carga la primera vez que se abre): rejilla compacta de miniaturas **sin tarjetas** (2 columnas en móvil, hasta 6 en `xl:`): miniatura 16:9
   con formato (arriba a la izquierda) y duración, título a 2 líneas y "{nombre} · hace N"; cada celda es un enlace a la ficha. Página siguiente al llegar al final y `ErrorState` inline si falla una.

| Vista | cargando | vacío | error | contenido |
|-------|----------|-------|-------|-----------|
| Listas | `SkeletonList` (3 tarjetas) | `EmptyState` "Aún no hay listas" + "Abre un video y pulsa Crear lista" | `ErrorState` + Reintentar | `YoutubePlaylistCard` |
| Historial | `SkeletonList` (6 tarjetas) | `EmptyState` "Todavía no hay videos" + "Pega el primer enlace arriba" | `ErrorState` + Reintentar | `YoutubeVideoCard` |
| Descargas | `SkeletonList` (6 miniaturas) | `EmptyState` "Todavía no hay descargas" + "Descarga un video y aparecerá aquí" | `ErrorState` + Reintentar | `YoutubeDownloadsGrid` |

### `/youtube/:id` (`app/pages/youtube/[id]/index.vue`, FR-006, FR-012, FR-013, FR-026)

1. **Reproductor** (`YoutubePlayer`, carga diferida; research D5 revisado): el **reproductor incrustado oficial de YouTube**
   (`https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1&hl=es`) dentro de un contenedor `aspect-video` de ancho completo con
   `rounded-box`. No crea trabajos ni llama al servicio de descargas: reproduce desde YouTube y funciona con el servicio dormido. Estados:

   | Estado | Qué se ve |
   |--------|-----------|
   | Inicial | La miniatura como póster y un botón grande `btn btn-primary btn-circle` con `lucide:play` (`aria-label` "Reproducir: {título}"), que ocupa todo el contenedor. Al acercar el cursor o enfocar el botón se añade `preconnect` a `youtube-nocookie.com` e `i.ytimg.com` |
   | Reproduciendo | `<iframe>` con `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`, `allowfullscreen` y `title` "YouTube: {título}". Controles, teclado y pantalla completa son los de YouTube |

   El iframe solo se monta al pulsar (la miniatura pesa kilobytes; el reproductor, cientos de ellos). Un video que su dueño no permite incrustar muestra el aviso del propio YouTube.
2. **Metadatos y acciones** (`YoutubeVideoMeta`): título (`h1`), canal, duración, calidades disponibles como `badge`. Fila de acciones (`btn` base, en móvil se
   apilan en una columna de `btn-block`, desde `sm:` en fila):
   - **Descargar** (`btn-primary`): abre `YoutubeFormatPicker` (menú con Video 720p · Video 1080p · Audio MP3; 1080p solo si `availableHeights` lo alcanza o se avisa
     "se entregará la mayor calidad disponible"). Deshabilitado con `title` y texto de la razón si `downloadable = false` (`BLOCK_REASON_MESSAGES`).
   - **Guardar en el drive** (`btn` secundario, `lucide:hard-drive-upload`): `YoutubeFormatPicker` con solo **Video 720p** y **Audio MP3**. Elegir uno crea el trabajo, baja el archivo y lo
     sube a la raíz del drive (`useYoutubeDriveImport`); mientras corre, bajo las acciones se ve el paso («Preparando el archivo…», «Descargando del servicio…», «Subiendo al drive…») con su `progress`
     y el botón queda deshabilitado. Al terminar: aviso ««{nombre}» ya está en el drive» con enlace al drive y entrada de actividad «subió el archivo · desde YouTube (Audio MP3)». Errores en el
     mismo sitio (`role="alert"`): servicio dormido/ocupado, trabajo fallido, archivo de más de 100 MB («Prueba con Audio MP3»), fallo al bajar o subir (sin registros a medias). Deshabilitado si `downloadable = false`.
   - **Crear lista** → `LazyYoutubePlaylistDialog` (modal): pestañas "Nueva lista" (campo Nombre) y "Agregar a una existente" (`select` o lista de botones). Toast "Lista creada" /
     "Agregado a {lista}" / "Ya estaba en {lista}".
   - **Abrir en ventana nueva** (`lucide:external-link`): siempre disponible. No hay botón de Pantalla completa propio: la ofrece el reproductor de YouTube.
3. **Fila "Historial reciente"**: `YoutubeVideoCard` en una fila desplazable (12, `exclude` = el video actual), sin casillas; mismo estado vacío/cargando/error.

**El reproductor es independiente del servicio de descargas**: se muestra al instante con el ID de la URL (miniatura `i.ytimg.com/vi/<id>/hqdefault.jpg` mientras no llegan los datos) y no espera a `GET /videos/:id`; los avisos de abajo aparecen debajo de él. Estados del resto de la ficha: cargando (esqueleto de título y acciones), error de video (`ErrorState` con el motivo y "Volver a YouTube"), servicio dormido (`YoutubeServiceBanner` + Reintentar),
contenido. Un ID con forma inválida → 404 de Nuxt (`createError`).

### `/youtube/:id/ventana` (`app/pages/youtube/[id]/ventana.vue`, layout `player`, FR-013)

Layout sin barra lateral (`app/layouts/player.vue`): fondo `bg-base-300`, el `YoutubePlayer` ocupa el viewport (`fill`), título pequeño sobre él. Arranca ya en marcha (`autoplay`:
la ventana se abre con un clic; si el navegador lo bloquea, basta el Play de YouTube). Sin `?job=`: ya no hay copia que preparar. El botón "Cerrar ventana" llama `window.close()`.

### Diálogo de lista (`YoutubePlaylistDialog`, FR-015–FR-018, FR-027)

`modal` de daisyUI cargado con `LazyYoutubePlaylistDialog` y `v-if`. Dos modos:

- **Con `videoId`** (desde la ficha o el historial): pestañas "Nueva lista" (campo Nombre, `youtubePlaylistSchema`) y "Agregar a una existente". Toasts "Lista creada",
  "Agregado a {lista}" y "Ya estaba en {lista}".
- **Con `playlistId`** (detalle, al tocar una tarjeta): carga `GET /api/youtube/playlists/:id` y lista los videos (miniatura, título, duración, quién lo agregó). Por video:
  **Abrir** (enlace a `/youtube/<id>`), **Descargar** (`YoutubeFormatPicker` + `enqueue([id], formato, título)`) y **Quitar** (`ConfirmDialog`). **Renombrar** y **Eliminar**
  (`ConfirmDialog`) solo si la persona es autora o administradora.

| Vista | cargando | vacío | error | contenido |
|-------|----------|-------|-------|-----------|
| Detalle de lista | `SkeletonList` (3 filas) | `EmptyState` "Esta lista aún no tiene videos" | `ErrorState` + Reintentar | videos con sus acciones |

## Componentes

| Componente | Responsabilidad | Props / eventos clave |
|------------|-----------------|-----------------------|
| `YoutubeUrlInput` | campo grande + validación del enlace | emite `submit(videoId)` |
| `YoutubeServiceBanner` | `alert` "Despertando el servicio…" / "ocupado" con Reintentar | `state`, emite `retry` |
| `YoutubePlaylistRow` / `YoutubePlaylistCard` | fila de listas; tarjeta con 4 miniaturas, autor y menú de opciones (descargas + guardar en el drive) | `playlist`, emite `open`, `download(playlist, format)`, `drive(playlist, format)` |
| `YoutubeDriveDialog` (`Lazy`) | lista de casillas para elegir qué videos subir al drive (selección o lista) | `videos`, `format`, `heading`; emite `confirm(videos)`, `close` |
| `YoutubeDriveImportRow` | fila de la bandeja por video guardado en el drive: etapa, avance, «Ver en el drive», Reintentar, cerrar | `item`; emite `retry`, `dismiss` |
| `YoutubePlaylistDialog` (`Lazy`) | crear lista / agregar a existente / detalle de lista (ver, abrir, descargar y quitar cada video; renombrar, eliminar) | `videoId?`, `playlistId?` |
| `YoutubeHistoryList` | rejilla con selección múltiple y `useInfiniteScroll`; sube un video al drive desde el menú; expone `videosOf(ids)` para resolver la selección | `v-model:selected`, emite `download`, `playlist` |
| `YoutubeVideoCard` | miniatura, duración, título, canal, quién y cuándo, casilla opcional, `ActionMenu` | `video`, `selectable?` |
| `YoutubeSelectionBar` | barra fija con N, formato, Descargar, Guardar en el drive, Limpiar | `count`, emite `download(format)`, `drive(format)`, `clear` |
| `ActionMenu` (`ui/`, props `floating?`, `disabled?`) | menú ⋯ de acciones; con `floating` se dibuja en `body` (listas con desplazamiento) |
| `YoutubeFormatPicker` | menú de formato (radio) | `v-model`, `heights?` |
| `YoutubePlayer` | `<video>` + controles + estados de preparación | `videoId`, `poster`, `initialJobId?`, expone `fullscreen()` |
| `YoutubeVideoMeta` | título, canal, duración, acciones | `video` |
| `YoutubeDownloadTray` (`Lazy`, en layout `dashboard`) | bandeja de trabajos: nombre, lote N de M, avance, estado por video ("Entregado en {n}p" si 1080p no estaba disponible), Guardar archivo, Cancelar; y la sección **Guardar en el drive** (§ Bandeja). Se monta si hay descargas **o** importaciones al drive | estado de `useYoutubeDownloads` y `useYoutubeDriveImport` |

### Bandeja: sección «Guardar en el drive» (FR-033)

Bajo los trabajos de descarga, una sección con una `YoutubeDriveImportRow` por video (`ul` con nombre «Guardar en el drive»): título, formato y etapa (*En cola* · *Preparando el archivo…* · *Descargando del servicio…* ·
*Subiendo al drive…*) con `progress` y su porcentaje (la fila «en cola» no lleva barra); al terminar «{nombre} ya está en el drive» con enlace **Ver en el drive** (`/archivos`) y botón cerrar; si falla,
el motivo (`role="alert"`), **Reintentar** (mismo formato) y cerrar. «N en curso» suma descargas e importaciones. El `aria-live` de la bandeja anuncia solo los cambios a *en cola*, *guardado* y *no se pudo guardar*.
Cada fila en cola o en curso lleva **Cancelar** (`aria-label` «Cancelar {título}»): en cola sale de la cola; en curso aborta la petición, la descarga o el envío, libera el trabajo del servicio y la
reserva del drive, avisa «Guardado cancelado» y la cola sigue con la siguiente. Una descarga o subida que pasa `YOUTUBE_IMPORT_STALL_MS` (60 s) sin avanzar se aborta con «La conexión se quedó sin respuesta»
y cada petición a la API tiene tope (`YOUTUBE_IMPORT_REQUEST_MS`), así que ninguna importación bloquea la cola. Las subidas corren **de una en una** y la bandeja sigue siendo la dueña de `--youtube-tray-h`, por lo que la barra de selección queda encima.

## Composables

| Composable | Responsabilidad |
|------------|-----------------|
| `useYoutubeService` | `GET /health`, estado `up/waking/down`, reintento cada 5 s mientras no esté `up` |
| `useYoutubeDownloads` | `useState` con trabajos y lotes pendientes; `enqueue(videoIds, format, label)` parte con `chunkVideoIds`, crea un lote a la vez, sondea cada 2,5 s, dispara el guardado y expone `cancel`, `retry`, `saveAgain` |
| `useYoutubeDriveImport` | guardar videos en el drive (`useState` `youtube-drive-imports`, sobrevive a la navegación, no a la recarga): `start(video, format)`, `startMany(videos, format)` (todos «en cola», se procesan de uno en uno; devuelve cuántos encoló y salta los que ya están activos), `retry`, `dismiss`, `of`, `list`, `hasImports`. La cola vive en el propio estado (`pump`), no en variables de módulo |
| `useYoutubeHistory` | `useApiFetch` + `useInfiniteScroll`, `remove(videoId)` con confirmación y toast |
| `useYoutubePlaylists` | listado, crear, renombrar, eliminar, agregar y quitar con toasts y `refresh` |

## Textos (`app/utils/messages.ts`, bloque `youtube`)

- Toasts: lista creada/renombrada/eliminada, video agregado/quitado/"ya estaba", descarga lista ("Tu archivo está listo"), lote N de M, historial limpiado.
- Errores de campo: `youtubeUrl.*` por `reason` de `parseYoutubeUrl` (`not_url`: "Pega un enlace completo, por ejemplo https://youtu.be/…"; `playlist`: "Ese enlace es de una lista
  de YouTube. Pega el de un video."; `not_youtube`: "Solo aceptamos enlaces de YouTube"; …).
- Estados del servicio y de los trabajos: `waking`, `busy`, `expired`, `notConfigured`; por elemento: `ITEM_ERROR_MESSAGES` y `BLOCK_REASON_MESSAGES` (`shared/constants/youtube.ts`).
- Guardar en el drive (`messages.youtube.drive`): etapas (`queued`, `preparing`, `downloading`, `uploading`), `done(nombre)`, `queuedCount(n)` («Se guardarán N videos en el drive»), `confirm(n)` («Subir N al drive»), `retry`, `tooLargeNote` y los errores `failed`, `jobFailed`, `downloadFailed`, `timeout`, `tooLarge`.
- Aviso breve de cumplimiento (assumptions) en la ficha, `text-base-content/70` (sin `text-warning`).

## Accesibilidad y mobile

- 360 px: campo y botones `btn-block`; filas con `overflow-x-auto` interno y `snap-x`; sin scroll de página. `YoutubeSelectionBar` respeta el área segura inferior y no tapa el
  último elemento (padding inferior de la página cuando hay selección).
- Todo control con etiqueta; foco visible; barra del reproductor operable con teclado; los avances se anuncian en una región `role="status" aria-live="polite"` (sin anunciar cada 2,5 s: solo
  cambios de estado y cada 25 % de avance).
- `prefers-reduced-motion`: sin autoplay animado de póster, `loading` sin animación continua.
- Nada depende de `hover`: el botón de descarga de la lista es permanente en móvil y aparece también con foco en escritorio.
