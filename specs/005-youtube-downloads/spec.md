# Feature Specification: Página YouTube — descargas y listas de reproducción

**Feature Branch**: `005-youtube-downloads` (carpeta de documentos: `specs/005-youtube-downloads/`)

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "New feature page in Cloudy, Youtube. This page need to have two core features, Playlists and Downloads. Downloads means the cloudy team can download videos and audios pasting the yt video url, so cloudy give the options for downloading as video or audio; Playlists means cloudy team can organize his saved yt links; so can able to fetch and download on demand YT media sources. The videos will served by FastAPI python webservice with yt-dlp as core where currently is created, the python api will be hosted on Render.com. [...] in home page, below the page layout, a big input where the cloudy member input the youtube url. below the input, two row sections: 1. playlists [...] 2. recent and history of the fetched videos/audios url plus, on playlists section, when hover a playlist let appear a download button to fetch all the videos the playlist includes and, on historic fetched videos section, let user marks multiple checks for batch download. When a cloudy member enter a link on input, a slug page with the id of the video is shown [...] top placed a daisy cloudy themed videoplayer [...] below the player two sections, 1. the video metadata and action buttons like Download, Create playlist over the slug video, play this video on fullscreen through external browser window or in the active page window 2. a row of the historic fetched videos. [...] the way works is based on jobs and batch downloads, for more information of the backend, i have loaded for you the backend repo dir."

## Contexto

El equipo de multimedia y audio necesita con frecuencia material que ya existe en YouTube (un tema musical, un
fragmento de video para proyectar, un audio de referencia). Hoy cada persona lo baja por su cuenta con herramientas
externas y sin orden. Esta feature agrega a Cloudy una página **YouTube** donde administradores y editores pegan un
enlace, ven el video, lo descargan como video o audio, guardan sus enlaces en **listas de reproducción** compartidas
por todo el equipo y consultan un **historial** de lo ya consultado.

La obtención y conversión de los medios la hace un **servicio de descargas** independiente de Cloudy (repositorio
`cloudy-api`). Funciona con **trabajos** asíncronos: se crea un trabajo para uno o varios videos (hasta 10), se consulta
su avance y, al terminar, el navegador baja el archivo directamente desde el servicio mediante un enlace firmado de
corta vida. Un trabajo de un solo video entrega el archivo; un lote entrega un `.zip` con los videos que sí pudieron
descargarse. Los archivos y los trabajos son temporales (el servicio los borra a los 30 minutos y puede reiniciarse).

**Terminología** (textos de interfaz, en español):

- **YouTube**: la página del equipo con el campo de enlace, las listas y el historial.
- **Video**: un enlace de YouTube de un solo video, identificado por su ID de 11 caracteres.
- **Lista**: colección con nombre de videos guardados, visible para todo el equipo.
- **Historial**: videos que alguien del equipo ya consultó en Cloudy.
- **Descarga**: archivo que se baja al dispositivo, en formato **Video 720p**, **Video 1080p** o **Audio MP3**.

## Clarifications

### Session 2026-11-03

- Directiva del usuario: dos funciones centrales, **Descargas** y **Listas**; el servicio de descargas ya existe
  (FastAPI + yt-dlp, alojado en Render) y trabaja por trabajos y lotes.
- Alcance acordado al leer el servicio: el servicio solo acepta **IDs de video individuales** (no URLs de listas de
  YouTube), ofrece **tres formatos** (MP4 720p, MP4 1080p, MP3), acepta **hasta 10 videos por trabajo**, rechaza videos
  de más de **30 minutos**, en vivo o de duración desconocida, y no ofrece reproducción en streaming: solo archivos
  descargables. De ahí los supuestos de la sección Assumptions.

### Session 2026-11-04

- Directiva del usuario: replicar **Guardar en el drive** (ya existente en la página de un video) en el historial, la
  barra de selección y las listas, con una lista de casillas para elegir qué videos subir cuando son varios (FR-033).
- Decisiones: el avance de estas subidas se ve en una sección de la bandeja de descargas; se elige el formato primero
  y luego los videos; las subidas en lote van de una en una.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pegar un enlace, ver el video y descargarlo como video o audio (Priority: P1) 🎯 MVP

Un administrador o editor entra a **YouTube** desde la barra lateral. Ve un campo grande para pegar el enlace. Lo pega y
Cloudy lo lleva a la página del video (`/youtube/<id>`), donde arriba aparece un reproductor con el estilo de Cloudy y
debajo los datos del video (título, canal, duración, miniatura) y el botón **Descargar**. Elige formato (Video 720p,
Video 1080p o Audio MP3), ve el avance de la preparación y, al terminar, el navegador baja el archivo.

**Why this priority**: es la necesidad que originó la feature y entrega valor completo por sí sola: sin listas ni
historial, el equipo ya puede conseguir un video o un audio desde un enlace.

**Independent Test**: con una sesión de editor, pegar un enlace válido de un video corto, ver la página del video con su
reproductor y metadatos, descargarlo como MP3 y como Video 720p, y comprobar que el archivo baja y se reproduce.

**Acceptance Scenarios**:

1. **Given** un editor en la página YouTube, **When** pega un enlace válido (formatos `watch?v=`, `youtu.be/`,
   `shorts/` o `embed/`) en el campo y lo envía, **Then** Cloudy abre la página del video con ese ID y muestra sus datos.
2. **Given** la página de un video descargable, **When** elige "Audio MP3" y pulsa Descargar, **Then** ve un estado de
   preparación con avance y, al terminar, el navegador baja un archivo de audio con el título del video como nombre.
3. **Given** la página de un video, **When** elige "Video 1080p" y el video no tiene esa altura, **Then** se descarga la
   mayor altura disponible hasta 1080p y Cloudy informa la calidad real entregada.
4. **Given** un texto que no es un enlace de YouTube, o un enlace de lista de YouTube, **When** lo envía, **Then** el
   campo muestra un mensaje que explica qué enlaces se aceptan y no navega a ninguna parte.
5. **Given** un video que no se puede descargar (privado, no disponible, en vivo, con restricción de edad, de más de 30
   minutos), **When** se abre su página, **Then** se muestran sus datos disponibles, el botón Descargar queda
   deshabilitado y un mensaje en español explica el motivo.
6. **Given** el servicio de descargas dormido o saturado, **When** el usuario abre la página o pide una descarga,
   **Then** Cloudy muestra "despertando el servicio" o "ocupado, intenta de nuevo en un momento" con una acción para
   reintentar, y el estado nunca queda en blanco.
7. **Given** una persona sin sesión o con un rol que no es administrador/editor, **When** intenta abrir la página YouTube
   o la de un video, **Then** se la redirige como en el resto de rutas protegidas.

---

### User Story 2 - Listas de reproducción compartidas por el equipo (Priority: P2)

Desde la página de un video, el usuario pulsa **Crear lista** (o **Agregar a lista**) para guardar ese video en una lista
nueva o existente. Las listas son globales: las ven todos los administradores y editores, y cada una muestra quién la
creó. En la página YouTube, una fila **Listas** muestra las listas del equipo; al pasar el cursor (o tocar en teléfono)
sobre una lista aparece un botón de descarga que baja todos sus videos en el formato elegido.

**Why this priority**: organiza los enlaces guardados y evita repetir búsquedas, pero depende de que ya exista la
consulta de videos (US1).

**Independent Test**: crear una lista desde un video, agregar un segundo video, ver la lista con su autor desde otra
cuenta del equipo, descargar la lista completa y comprobar que llega un `.zip` con ambos videos.

**Acceptance Scenarios**:

1. **Given** la página de un video, **When** el usuario pulsa "Crear lista", escribe un nombre y confirma, **Then** se crea
   una lista global con ese video, se muestra un aviso de confirmación y la lista aparece en la fila Listas.
2. **Given** una lista creada por una persona, **When** otro administrador o editor abre la página YouTube, **Then** ve la
   lista con el nombre de su autora o autor.
3. **Given** una lista existente, **When** el usuario agrega el video actual a ella, **Then** el video queda en la lista;
   si ya estaba, Cloudy lo indica y no lo duplica.
4. **Given** una lista con varios videos, **When** el usuario abre la lista, **Then** ve sus videos con miniatura,
   título y duración, y puede reproducir uno, quitarlo (con confirmación) o descargarlo.
5. **Given** la fila Listas, **When** el usuario pasa el cursor sobre una lista en escritorio o toca su botón de descarga
   en teléfono, **Then** elige el formato y se inicia la descarga de todos sus videos; si la lista tiene más de 10
   videos, Cloudy los divide en varios lotes y entrega un archivo por lote, mostrando el avance de cada uno.
6. **Given** una lista en la que algunos videos ya no están disponibles, **When** se descarga, **Then** el archivo incluye
   los que sí se pudieron bajar y Cloudy informa cuáles fallaron y por qué.
7. **Given** una lista, **When** la creadora o creador (o un administrador) la renombra o la elimina, **Then** el cambio
   se aplica a todo el equipo tras confirmar; un editor que no es la autora o autor no puede renombrarla ni
   eliminarla, pero sí agregar y quitar videos.
8. **Given** que aún no hay listas, **When** se abre la página YouTube, **Then** la fila Listas muestra un estado vacío
   que invita a crear la primera desde un video.

---

### User Story 3 - Historial de videos consultados y descarga por lotes (Priority: P3)

Cada video que alguien del equipo abre en Cloudy queda en el **Historial**. En la página YouTube y en la página de cada
video, una fila muestra lo más reciente. En la página YouTube el usuario puede marcar varios videos con casillas y
descargarlos juntos en un solo lote.

**Why this priority**: acelera repetir descargas y reaprovechar lo ya consultado; es la capa de comodidad sobre US1 y US2.

**Independent Test**: abrir tres videos distintos, comprobar que aparecen en el historial (el más reciente primero),
marcar los tres con casillas y descargarlos como Audio MP3 en un solo `.zip`.

**Acceptance Scenarios**:

1. **Given** un video consultado por primera vez, **When** se abre su página, **Then** aparece al inicio del historial
   con quién lo consultó y cuándo; si ya estaba, sube al inicio sin duplicarse.
2. **Given** el historial en la página YouTube, **When** el usuario marca dos o más videos con casillas, **Then** aparece
   una barra de acción con el número de videos marcados, el selector de formato y el botón "Descargar selección".
3. **Given** más de 10 videos marcados, **When** pulsa descargar, **Then** Cloudy los divide en lotes de hasta 10 y avisa
   de cuántos archivos recibirá.
4. **Given** una entrada del historial cuyo archivo ya expiró en el servicio, **When** el usuario la descarga de nuevo,
   **Then** Cloudy crea un trabajo nuevo sin pedir que se pegue el enlace otra vez.
5. **Given** una entrada del historial, **When** el usuario la abre, **Then** llega a la página de ese video; desde el
   historial también puede quitarla (con confirmación) para limpiar la lista.
6. **Given** un historial vacío, **When** se abre la página YouTube, **Then** la fila muestra un estado vacío que invita a
   pegar el primer enlace.
7. **Given** más entradas de las que caben en pantalla, **When** el usuario avanza por el historial, **Then** se cargan
   más sin recargar la página y sin bloquear la interfaz.

---

### User Story 4 - Reproducir el video en pantalla completa o en otra ventana (Priority: P4)

En la página de un video, junto a Descargar y Crear lista, hay acciones para ver el video en **pantalla completa** dentro
de la misma página o abrirlo en una **ventana externa** del navegador, para proyectarlo o verlo en otra pantalla.

**Why this priority**: mejora la revisión del material antes de descargarlo, pero el equipo puede trabajar sin ella.

**Independent Test**: en la página de un video, activar pantalla completa y comprobar que el reproductor la ocupa y se
sale con Escape; abrir la ventana externa y comprobar que reproduce el mismo video.

**Acceptance Scenarios**:

1. **Given** el reproductor con el video listo, **When** el usuario elige "Pantalla completa", **Then** el reproductor
   ocupa toda la pantalla con sus controles y se sale con Escape o con el botón de salir.
2. **Given** el reproductor con el video listo, **When** el usuario elige "Abrir en ventana nueva", **Then** el video se
   abre en una ventana separada del navegador y reproduce desde el inicio.
3. **Given** el reproductor, **When** se usa solo con teclado, **Then** reproducir/pausar, volumen, avance, pantalla
   completa y las acciones de la página son alcanzables y tienen etiquetas.
4. **Given** que el video aún se está preparando para reproducir, **When** el usuario intenta usar estas acciones,
   **Then** ve el progreso y las acciones se habilitan solas al terminar.

---

### Edge Cases

- Enlace pegado con parámetros extra (`&t=30s`, `&list=...`, `?si=...`): se toma solo el ID del video y se ignora lo demás.
- Enlace de lista de YouTube (`/playlist?list=`) o de canal: se rechaza con un mensaje que indica que solo se aceptan
  videos individuales.
- Dos personas piden el mismo video a la vez: cada una tiene su propio trabajo; no se mezclan archivos ni avances.
- El usuario cierra la pestaña a medias: no queda nada a medias en Cloudy; si volvió a abrir la página, puede volver a
  pedir la descarga.
- El enlace de descarga caducó (unos 10 minutos) o el archivo expiró (30 minutos): Cloudy ofrece "Preparar de nuevo".
- El servicio se reinició y respondió "no encontrado" para un trabajo en curso: se trata como "expiró, reintenta".
- Un lote con algunos videos rechazados (privados, en vivo, demasiado largos): se informa cuáles y por qué, y se
  descargan los demás; si fallan todos, se informa el fallo completo.
- Una lista o el historial incluyen un video que ya no existe en YouTube: se muestra como "No disponible" y no impide
  descargar el resto.
- Dos personas crean listas con el mismo nombre: se permite; cada una muestra su autor para distinguirlas.
- Una persona del equipo es desactivada o eliminada: sus listas siguen existiendo para el equipo y su autor se muestra
  como usuario que ya no está activo.
- Un archivo grande en teléfono con red lenta: la descarga la hace el navegador directamente, sin pasar por Cloudy.
- Se alcanza el máximo de trabajos en espera del servicio: se informa que está ocupado y se permite reintentar sin
  perder la selección marcada.

## Requirements *(mandatory)*

### Functional Requirements

**Acceso y navegación**

- **FR-001**: Cloudy MUST ofrecer la página **YouTube** (`/youtube`) y la página de cada video (`/youtube/<id>`), con
  entrada en la barra lateral, solo para administradores y editores. Toda acción del servidor de la feature MUST
  comprobar sesión y rol; ocultar la interfaz no cuenta como autorización.
- **FR-002**: Las personas sin sesión o sin rol permitido MUST ser tratadas como en las demás rutas protegidas.
- **FR-003**: El navegador MUST nunca recibir las credenciales del servicio de descargas: todas las llamadas a él que
  requieren credencial las hace el servidor de Cloudy; el navegador solo baja el archivo final por el enlace firmado
  de corta vida que entrega el servicio.

**Enlace y página del video (US1)**

- **FR-004**: La página YouTube MUST mostrar, bajo el encabezado, un campo de enlace grande y visible en primer plano,
  enfocable por teclado y con etiqueta, que acepte enlaces de YouTube en los formatos habituales y extraiga el ID del
  video.
- **FR-005**: Cloudy MUST validar el enlace antes de navegar y explicar en español qué se acepta cuando no es válido
  (texto cualquiera, listas, canales, otros sitios).
- **FR-006**: La página de un video MUST mostrar título, canal, duración, miniatura y las calidades disponibles,
  obtenidas del servicio de descargas, y MUST indicar si el video es descargable y, si no, el motivo (demasiado largo,
  en vivo, duración desconocida, privado, no disponible, con restricción de edad, solo miembros, restringido por
  región).
- **FR-007**: La página de un video MUST ofrecer descargar en **Video 720p**, **Video 1080p** o **Audio MP3**, y
  informar la calidad real cuando el video no alcance la solicitada.
- **FR-008**: Una descarga MUST ejecutarse como trabajo asíncrono: Cloudy lo crea, consulta su estado cada pocos
  segundos, muestra el avance y el estado de cada elemento y, al terminar, inicia la bajada del archivo. El nombre del
  archivo incluye el título del video.
- **FR-009**: Cloudy MUST permitir cancelar un trabajo en curso y MUST dejar la interfaz en un estado consistente
  (sin trabajos fantasma ni botones bloqueados) si el trabajo falla, expira o se cancela.
- **FR-010**: Cloudy MUST comunicar con acción de reintento los estados del servicio: dormido (arranque en frío),
  ocupado (cola llena), no disponible y trabajo expirado.
- **FR-011**: Los mensajes de error del servicio de descargas MUST traducirse a textos en español que digan qué hacer;
  el usuario nunca ve respuestas crudas del servicio.

**Reproductor y vista (US1, US4)**

- **FR-012**: La página de un video MUST incluir en la parte superior un reproductor con los controles propios del
  tema de Cloudy (reproducir/pausar, avance, volumen, tiempo, pantalla completa), accesible por teclado y que respete
  el tema oscuro y el claro. La pantalla completa se entrega con US4; el resto de los controles, con US1.
- **FR-013**: Cloudy MUST ofrecer, junto a las acciones del video, **Pantalla completa** en la misma página y **Abrir en
  ventana nueva**; ambas MUST habilitarse solo cuando el video esté listo para reproducirse.
- **FR-014**: Mientras el video se prepara para reproducir, el reproductor MUST mostrar el progreso y un estado de
  carga, y si no puede prepararse MUST mostrar el error con una acción de reintento sin impedir los metadatos ni las
  descargas.

**Listas (US2)**

- **FR-015**: Cualquier administrador o editor MUST poder crear una lista con nombre (obligatorio, longitud acotada
  como en el resto de la aplicación) y agregarle videos desde la página de un video o desde el historial.
- **FR-016**: Las listas MUST ser globales para el equipo y mostrar su autor y su fecha de creación; todo el equipo MUST
  poder verlas, abrirlas, agregar y quitar videos y descargarlas.
- **FR-017**: Solo la autora o autor de una lista y los administradores MUST poder renombrarla o eliminarla; eliminar
  MUST pedir confirmación y no elimina los videos del historial.
- **FR-018**: Un video MUST aparecer una sola vez por lista; agregar uno repetido se informa sin duplicar.
- **FR-019**: En la fila Listas, cada lista MUST tener un botón de opciones (⋯) que aparezca al pasar el cursor o enfocar
  con teclado en escritorio y que sea visible de forma permanente en teléfono y tabletas (ninguna acción depende solo
  de `hover`). Su menú agrupa **Descargar** (video 720p, video 1080p, audio MP3: descarga todos sus videos) y
  **Guardar en el drive** (FR-033).
- **FR-020**: Descargar una lista o una selección de más de 10 videos MUST dividirse en lotes de hasta 10, procesarse de
  forma ordenada y mostrar el avance por lote; cada lote entrega un solo archivo `.zip`.
- **FR-021**: Cuando algunos videos de un lote fallan, Cloudy MUST entregar los que sí se bajaron e informar cuáles
  fallaron y por qué.

**Historial (US3)**

- **FR-022**: Cada vez que un administrador o editor abre la página de un video válido, Cloudy MUST registrarlo en el
  historial del equipo con quién lo consultó y cuándo; repetir un video lo mueve al inicio sin duplicarlo.
- **FR-023**: El historial MUST ser compartido por el equipo, ordenado del más reciente al más antiguo, y paginado
  por cursor para listar miles de entradas sin bloquear la página.
- **FR-024**: El historial MUST permitir marcar varios videos con casillas, ver cuántos hay marcados, elegir formato y
  descargarlos por lotes; la selección MUST poder limpiarse y sobrevivir a un reintento tras un error.
- **FR-025**: Cada entrada del historial MUST ofrecer abrir su página, agregarla a una lista, descargarla de nuevo y
  quitarla del historial (con confirmación). Quitarla no elimina las listas que la contienen.
- **FR-026**: La página de un video MUST mostrar una fila con el historial reciente (sin repetir el video actual) para
  saltar rápido a otro.

**Calidad y comportamiento general**

- **FR-027**: Cada vista con datos (listas, historial, página de video) MUST cubrir los estados cargando (skeleton),
  vacío con guía, error con reintento y con contenido.
- **FR-028**: Toda acción completada (crear/renombrar/eliminar lista, agregar/quitar video, descarga lista) MUST mostrar
  un aviso breve; toda acción destructiva MUST pedir confirmación.
- **FR-029**: Los textos MUST estar en español, la interfaz MUST usar solo los tokens de color de los temas de Cloudy y
  verse bien en 360 px y en ≥ 1280 px, con objetivos táctiles ≥ 44 px, foco visible y navegación por teclado.
- **FR-030**: El servidor de Cloudy MUST NOT retransmitir archivos de audio o video: la bajada y la reproducción van del
  navegador al servicio de descargas mediante enlaces firmados.
- **FR-031**: Ningún trabajo del servicio de descargas MUST disparar descargas duplicadas por doble clic o reintentos
  rápidos: un mismo gesto crea un solo trabajo.
- **FR-032**: Las listas y el historial MUST guardar solo lo necesario para mostrarse (ID del video, título, canal,
  duración, miniatura y autoría); no se guardan los archivos descargados.
- **FR-033**: **Guardar en el drive** (Video 720p o Audio MP3, a la raíz del drive) MUST estar disponible, además de en la
  página de un video, en el menú de cada tarjeta del historial, en la barra de selección del historial y en el menú de
  opciones de cada lista. Un solo video se sube directo; **varios** (selección o lista) MUST mostrar antes una lista con
  casillas, todas marcadas por defecto, para que la persona decida cuáles subir. Las subidas en lote MUST ejecutarse de
  una en una (cada archivo pasa entero por el navegador, tope de 100 MB), mostrar su estado (en cola, preparando,
  descargando, subiendo, listo, falló con **Reintentar**) en la bandeja de descargas y sobrevivir a la navegación.
  Un video que ya se está guardando no se vuelve a encolar.

### Key Entities *(include if feature involves data)*

- **Video guardado**: referencia a un video de YouTube que Cloudy ya conoce: ID de 11 caracteres, título, canal,
  duración y miniatura. Es la base común de listas e historial y evita pedir los datos al servicio cada vez.
- **Entrada del historial**: un video consultado por el equipo; incluye quién lo consultó por última vez y cuándo.
  Una entrada por video, compartida por todo el equipo.
- **Lista**: colección con nombre, autor (usuario del equipo), fecha de creación y fecha de última modificación;
  global para el equipo.
- **Elemento de lista**: pertenencia de un video guardado a una lista, con su posición y quién lo agregó; un video no
  se repite dentro de una lista.
- **Trabajo de descarga**: solicitud temporal de uno a diez videos en un formato, con estado, avance, resultado por
  elemento y enlace de descarga con caducidad. Vive en el servicio de descargas, no en Cloudy; Cloudy solo lo consulta
  mientras la persona mira la página.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona del equipo consigue un audio o video descargado a partir de un enlace pegado en menos de 3
  clics (pegar, elegir formato, descargar) y, para un video de 5 minutos, recibe el archivo en menos de 2 minutos con
  el servicio ya despierto.
- **SC-002**: Al pegar un enlace válido, la página del video muestra título, canal y miniatura en menos de 3 segundos
  (servicio despierto); si el servicio está dormido, la persona ve un estado de espera claro en menos de 1 segundo.
- **SC-003**: El 100 % de los enlaces inválidos (texto libre, listas, canales, otros sitios) se rechaza antes de
  navegar, con un mensaje que dice qué enlaces se aceptan.
- **SC-004**: Crear una lista desde un video y verla desde otra cuenta del equipo toma menos de 30 segundos y la lista
  siempre muestra su autor.
- **SC-005**: Descargar una lista o una selección de hasta 10 videos entrega un solo archivo; de 11 videos en adelante entrega
  un archivo por cada 10 (no hay tope de videos por lista o selección), y la persona siempre sabe cuántos archivos recibirá antes de confirmar.
- **SC-006**: En una descarga por lotes con fallos parciales, el 100 % de los videos disponibles llegan al archivo y el
  100 % de los fallidos se listan con su motivo en español.
- **SC-007**: La página YouTube, con 5 000 entradas en el historial, muestra el primer bloque en menos de 2 segundos
  y mantiene la interacción por debajo de 200 ms al marcar casillas.
- **SC-008**: Ningún flujo de la feature exige desplazamiento horizontal a 360 px y todas las acciones son alcanzables
  en teléfono sin depender del cursor.
- **SC-009**: Ninguna credencial del servicio de descargas es observable desde el navegador.
- **SC-010**: Tras un fallo (servicio caído, trabajo expirado, error de red) la persona recupera el control con una
  acción de reintento visible en menos de 5 segundos, sin recargar la página.

## Assumptions

- **Usuarios**: solo administradores y editores usan la página (los mismos roles de equipo de Cloudy); los invitados no
  tienen acceso. Las listas y el historial son compartidos por todo el equipo, sin listas privadas en esta versión.
- **Servicio de descargas**: ya existe y se despliega aparte (Render, plan gratuito). Su contrato (formatos, límite de 10
  videos por trabajo, 30 minutos de duración máxima, archivos con 30 minutos de vida, enlaces firmados de unos 10
  minutos) es el límite de lo que Cloudy puede ofrecer. Cloudy depende de que esté disponible; cuando no lo está, la
  feature se degrada con mensajes claros, sin romper el resto de la aplicación.
- **Enlaces admitidos**: videos individuales de YouTube (`watch`, `youtu.be`, `shorts`, `embed`). Enlaces de listas de
  YouTube, canales, transmisiones en vivo y otros sitios quedan fuera de alcance: "lista" en esta feature siempre es una
  lista de Cloudy, no una lista de YouTube.
- **Formatos**: Video 720p, Video 1080p y Audio MP3; son los que ofrece el servicio. No se ofrecen otros formatos ni
  elegir códec en esta versión.
- **Reproductor**: el servicio no entrega streaming, solo archivos. Para reproducir, Cloudy prepara una copia de
  reproducción en el servicio (Video 720p) y la reproduce mediante su enlace firmado; por eso el reproductor puede tardar
  en estar listo y la copia caduca (se vuelve a preparar al reintentar). La descarga que elige la persona es independiente
  de esa copia.
- **Pantalla completa y ventana externa**: pantalla completa usa la del navegador sobre el reproductor de la página;
  "ventana externa" abre el mismo video en una ventana nueva del navegador (no se controla un monitor concreto).
- **Historial**: registra los videos que se abren en Cloudy, no los que se descargan por fuera; es compartido y sin
  vencimiento; cualquiera del equipo puede quitar entradas.
- **Permisos de listas**: todo el equipo agrega y quita videos de cualquier lista; solo la autora o autor y los
  administradores renombran o eliminan. Sin cuotas por lista ni por persona en esta versión.
- **Persistencia**: Cloudy guarda solo datos de listas e historial; los trabajos y archivos viven en el servicio y no se
  recuperan tras reiniciarlo ni tras cerrar la pestaña.
- **Cumplimiento**: descargar de YouTube puede contradecir sus términos de servicio; el uso del servicio es decisión y
  responsabilidad de quien lo opera, y la página puede incluir un aviso breve para el equipo.
- **Alcance excluido**: subir los archivos descargados a la biblioteca de Cloudy, programar descargas, subtítulos,
  recorte de video y notificaciones por correo no forman parte de esta versión.
