# Feature Specification: Página Canciones — letras de Letras.com a presentaciones PowerPoint

**Feature Branch**: `006-canciones-lyrics-pptx` (carpeta de documentos: `specs/006-canciones-lyrics-pptx/`)

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "New feature page named Canciones, this feature will able to the cloudy team convert html extracted lyrics from Letras.com into a pptx slides. the feature will be split in two phases; phase 1. crawl, extraction and mapping of the lyrics, that where nuxt belongs in that phase where user enters a letras.com url, communicates with a crawl api through Apify actor named 'apify/rag-web-browser' (sdk client installed), then the mapped lyrics be sent to the fastapi backend so, phase 2. processing, arrangement of the lyrics calling an llm and generation of the pptx; already implemented the feature on the backend side. The backend agent generate for you the core requirements @frontend-lyrics-pptx.md . For the UI, reuse the youtube feature page layout, url input bar, playlists section rebranded to collections and history section. More detailed info of the backend side, the local api is running, check the docs: http://localhost:8000/docs."

## Contexto

Para proyectar las letras en el servicio, el equipo de multimedia y audio arma a mano una presentación por canción:
copia la letra de Letras.com, la parte en diapositivas y le da formato. Es un trabajo repetitivo que se hace cada
semana y que cada persona resuelve a su manera. Esta feature agrega a Cloudy una página **Canciones** donde
administradores y editores pegan el enlace de una canción de Letras.com, ven su letra, y descargan una presentación
`.pptx` con la letra ya repartida en diapositivas. Las canciones consultadas se guardan en un **historial** y se
organizan en **colecciones** compartidas por todo el equipo.

La feature se entrega en **dos fases** que corresponden a dos responsabilidades distintas:

- **Fase 1 — Obtención de la letra (en Cloudy)**: la persona pega el enlace; Cloudy lo valida, pide la página a un
  **servicio de rastreo** externo, extrae la letra, la ordena en un formato que el servicio de presentaciones entiende
  y la guarda para no tener que rastrear de nuevo.
- **Fase 2 — Presentación (servicio de presentaciones)**: el servicio externo `cloudy-api` (el mismo que atiende los
  videos de YouTube) recibe la letra ya extraída, decide con un modelo de lenguaje cómo repartirla en diapositivas y
  devuelve el archivo `.pptx`. **Este servicio ya está implementado**; su contrato (límites, códigos de error,
  encabezados) está en `frontend-lyrics-pptx.md` y en su documentación interactiva. Cloudy solo lo consume.

La página reutiliza la forma de la página YouTube (feature 005): un campo de enlace grande arriba, una fila de listas
—aquí llamadas **colecciones**— y un **historial** con selección múltiple. El navegador nunca habla con el servicio de
rastreo ni con el servicio de presentaciones: lo hace el servidor de Cloudy, que guarda las credenciales.

**Terminología** (textos de interfaz, en español):

- **Canciones**: la página del equipo con el campo de enlace, las colecciones y el historial.
- **Canción**: una página de letra de Letras.com ya obtenida por Cloudy; tiene título, artista (si la página lo
  indica), enlace de origen y letra.
- **Letra**: el texto de la canción, dividido en estrofas, tal como se extrae de Letras.com.
- **Colección**: conjunto con nombre de canciones guardadas, visible para todo el equipo (el equivalente a las listas
  de YouTube).
- **Historial**: canciones que alguien del equipo ya obtuvo o abrió en Cloudy.
- **Presentación**: archivo `.pptx` con la letra repartida en diapositivas, nombrado con el título de la canción.

## Clarifications

### Session 2026-11-05

- Directiva del usuario: nueva página **Canciones**; la entrega se parte en Fase 1 (rastreo, extracción y mapeo de la
  letra, responsabilidad de Cloudy) y Fase 2 (arreglo con modelo de lenguaje y generación del `.pptx`, ya
  implementada en el servicio de presentaciones). La interfaz reutiliza el diseño de la página YouTube: campo de
  enlace, sección de listas renombrada a **colecciones** e **historial**.
- Alcance acordado al leer el contrato del servicio de presentaciones: recibe **una canción por solicitud** y devuelve
  un `.pptx`; acepta hasta **300 líneas de letra** y **500 000 caracteres** de entrada; el color de letra es opcional
  (negro por defecto); informa cuántas diapositivas generó y si el reparto lo hizo el modelo de lenguaje o un reparto
  automático de respaldo; distingue «sin letra» y «letra demasiado larga» como errores propios; el servicio gratuito
  de alojamiento se duerme tras 15 minutos de inactividad. De ahí los supuestos de la sección Assumptions
  (en particular que descargar una colección entrega **un archivo por canción**).
- Q: ¿Qué páginas incluye la feature y cómo se organiza la de cada canción? → A: Dos páginas: el **índice**
  (`/canciones`: campo de enlace, colecciones, historial) y la **página de canción** (`/canciones/<id>`). En la página
  de canción, la parte superior muestra, en este orden, los **metadatos** de la canción, los **botones de acción** y
  la **letra**; el historial reciente queda debajo de la letra.
- Decisiones tras `/speckit-analyze` (2026-11-05):
  - **Color de letra**: no hay selector. La letra de las diapositivas va **siempre en blanco** (para proyectar sobre un
    fondo oscuro); Cloudy envía ese color fijo al servicio.
  - **Título**: límite de 200 caracteres en todo Cloudy (es el límite del servicio de presentaciones).
  - **Colecciones**: también se pueden crear desde la fila Colecciones (botón **Nueva colección**, visible en la
    cabecera de la fila y en su estado vacío), no solo desde una canción.
  - **Retención**: una canción fuera del historial y sin colección se elimina a los 30 días (limpieza diaria).
  - **Plazo de las funciones**: el máximo de una función en el proyecto de Vercel es de 5 minutos (300 s); pasado ese
    plazo responde `504 FUNCTION_INVOCATION_TIMEOUT`. Los 90 s de espera de una generación caben de sobra.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pegar un enlace de Letras.com y obtener la letra (Priority: P1) 🎯 MVP (Fase 1)

Un administrador o editor entra a **Canciones** desde la barra lateral. Ve un campo grande para pegar el enlace de una
canción de Letras.com. Lo pega y Cloudy busca la letra: tras unos segundos lo lleva a la página de la canción
(`/canciones/<id>`). Arriba de esa página ve, en este orden, los **metadatos** (título, artista, enlace a la página de
origen y fecha de obtención), los **botones de acción** y la **letra** completa ordenada por estrofas. Si esa canción
ya se había obtenido antes, la página se abre al instante sin volver a rastrear.

**Why this priority**: es la base de todo (sin letra no hay presentación) y es la parte de la feature que construye
Cloudy desde cero. Entrega valor por sí sola: el equipo ya puede consultar y revisar letras en un solo lugar.

**Independent Test**: pegar `https://www.letras.com/musiko/de-buenas-part-josh-gamez/`, comprobar que llega a la
página de la canción con título y letra por estrofas, volver a pegar el mismo enlace y comprobar que se abre sin
esperar un nuevo rastreo.

**Acceptance Scenarios**:

1. **Given** la barra lateral, **When** un administrador o editor abre **Canciones**, **Then** ve el encabezado, un
   campo de enlace grande y visible en primer plano, la fila **Colecciones** y la sección **Historial**; una persona
   sin sesión o sin rol permitido es tratada como en las demás rutas protegidas.
2. **Given** un enlace válido de una canción de Letras.com, **When** la persona lo pega y confirma, **Then** el campo
   muestra un estado de espera mientras se obtiene la letra y, al terminar, Cloudy navega a la página de la canción,
   que muestra arriba los metadatos, luego los botones de acción y luego la letra por estrofas.
3. **Given** una canción ya obtenida antes por cualquiera del equipo, **When** se pega su enlace (también con
   `www.` o sin él, con parámetros extra o con una barra final), **Then** Cloudy abre la misma canción sin rastrear
   de nuevo y sin crear un duplicado.
4. **Given** un texto que no es un enlace válido de Letras.com (texto libre, `http://`, otro sitio, un dominio que
   solo se parece como `letras.com.otro.test`, un enlace con usuario y contraseña), **When** la persona lo confirma,
   **Then** Cloudy lo rechaza **antes de pedir nada a ningún servicio** y explica en español qué enlaces se aceptan.
5. **Given** un enlace de Letras.com con la forma de una canción (`/artista/cancion/`) pero sin letra (canción
   retirada, página inexistente o sin la zona de la letra), **When** la persona lo confirma, **Then** ve «No
   encontramos una letra en ese enlace», no se guarda nada y puede corregir el enlace sin recargar. Un enlace de
   Letras.com que no tiene esa forma (inicio del sitio, página de artista, álbum o listas) se rechaza **antes de
   pedir nada a ningún servicio**, con un mensaje que explica que debe ser el enlace de una canción.
6. **Given** que el servicio de rastreo no responde, está sin cuota o no está configurado, **When** la persona
   confirma un enlace, **Then** ve un mensaje que dice qué hacer (reintentar más tarde o avisar a quien administra) con
   acción de reintento, y no queda ninguna canción a medias.
7. **Given** la página de una canción, **When** la letra obtenida salió incompleta o mal ordenada, **Then** la persona
   puede pulsar **Volver a obtener la letra** para rastrear de nuevo y reemplazar la guardada, tras lo cual ve la
   versión nueva.
8. **Given** la página de una canción en teléfono (360 px), **When** se ve la letra y las acciones, **Then** nada exige
   desplazamiento horizontal y todas las acciones son alcanzables sin cursor.

---

### User Story 2 - Generar y descargar la presentación PowerPoint (Priority: P2) (Fase 2)

En la página de una canción, la persona pulsa **Generar presentación** y Cloudy le entrega un archivo `.pptx` con la
letra repartida en diapositivas, con el texto en blanco para proyectarlo sobre un fondo oscuro. Mientras se genera ve un estado de
progreso (puede tardar varios segundos porque un modelo de lenguaje decide el reparto). Al terminar, el archivo se
descarga con el título de la canción como nombre y se informa cuántas diapositivas tiene.

**Why this priority**: es el resultado que el equipo busca; depende de que ya exista la letra (US1). Juntas, US1 y US2
forman el recorrido completo: enlace → letra → presentación.

**Independent Test**: desde una canción ya obtenida, pulsar **Generar presentación**, comprobar que se descarga un
`.pptx` con el nombre de la canción (con tildes correctas) que abre en PowerPoint con la letra repartida en
diapositivas, y que se muestra el número de diapositivas.

**Acceptance Scenarios**:

1. **Given** la página de una canción, **When** la persona pulsa **Generar presentación**, **Then** el botón muestra
   progreso, no permite lanzar una segunda generación de la misma canción y, al terminar, el navegador descarga un
   `.pptx` cuyo nombre es el título de la canción (conservando tildes y eñes) y un aviso indica «N diapositivas
   generadas».
2. **Given** una presentación generada, **When** se abre sobre un fondo oscuro, **Then** la letra va en blanco; Cloudy
   no ofrece selector de color y junto al botón explica que la letra va en blanco para proyectar sobre fondo oscuro.
3. **Given** una generación en la que el modelo de lenguaje no estuvo disponible, **When** el archivo llega con el
   reparto automático de respaldo, **Then** Cloudy entrega el archivo igualmente y muestra una nota breve:
   «Las diapositivas se agruparon automáticamente (el reparto con IA no estuvo disponible)».
4. **Given** una letra con más de 300 líneas, **When** la persona intenta generar, **Then** ve «Eso no parece una
   canción» (con la explicación de que supera el máximo de líneas) y no se reintenta automáticamente.
5. **Given** que el servicio de presentaciones está dormido (arranque en frío), **When** la persona abre Canciones o
   pulsa generar, **Then** ve un estado de espera claro (el servicio se despierta al abrir la página) y la generación
   termina con éxito dentro del tiempo de espera, sin que la persona tenga que repetir nada.
6. **Given** que el servicio de presentaciones falla, no responde a tiempo o la credencial es inválida, **When** la
   persona genera, **Then** ve un mensaje genérico en español con la acción **Reintentar** (sin mostrar detalles del
   servicio ni credenciales); los fallos de espera o del servidor se pueden reintentar, los errores definitivos
   (sin letra, demasiado larga) no.
7. **Given** una canción cuya presentación ya se generó, **When** la persona la genera de nuevo, **Then** se descarga
   una presentación nueva sin volver a rastrear la letra.

---

### User Story 3 - Colecciones de canciones compartidas por el equipo (Priority: P3)

Desde la página de una canción, la persona pulsa **Crear colección** (o **Agregar a colección**) para guardar esa
canción en una colección nueva o existente (por ejemplo «Domingo 10 de noviembre» o «Alabanza rápida»). Las colecciones
son globales: las ven todos los administradores y editores y cada una muestra quién la creó. En la página Canciones, una
fila **Colecciones** las muestra; al pasar el cursor (o tocar en teléfono) sobre una colección aparece un botón de
descarga que genera las presentaciones de todas sus canciones.

**Why this priority**: organiza el repertorio de cada servicio y evita volver a buscar las canciones; depende de que ya
existan la letra y la generación (US1 y US2).

**Independent Test**: crear una colección desde una canción, agregar una segunda canción, ver la colección con su autor
desde otra cuenta del equipo, descargar la colección completa y comprobar que llegan dos `.pptx`, uno por canción.

**Acceptance Scenarios**:

1. **Given** la página de una canción, **When** la persona pulsa «Crear colección», escribe un nombre y confirma,
   **Then** se crea una colección global con esa canción, se muestra un aviso de confirmación y la colección aparece
   en la fila Colecciones.
2. **Given** una colección creada por una persona, **When** otro administrador o editor abre Canciones, **Then** la ve
   con el nombre de su autora o autor.
3. **Given** una colección existente, **When** la persona agrega la canción actual a ella, **Then** la canción queda
   en la colección; si ya estaba, Cloudy lo indica y no la duplica.
4. **Given** una colección con varias canciones, **When** la persona la abre, **Then** ve sus canciones con título y
   artista, y puede abrir una, quitarla (con confirmación) o generar su presentación.
5. **Given** la fila Colecciones, **When** la persona pasa el cursor sobre una colección en escritorio o toca su botón
   de descarga en teléfono, **Then** Cloudy genera **una presentación por canción**, diciendo antes cuántos archivos
   recibirá y mostrando el avance de cada una.
6. **Given** una colección en la que algunas canciones fallan al generar, **When** se descarga, **Then** se entregan
   las presentaciones que sí se generaron e informa cuáles fallaron y por qué, sin detener las demás.
7. **Given** una colección, **When** su autora o autor (o un administrador) la renombra o la elimina, **Then** el
   cambio se aplica a todo el equipo tras confirmar; un editor que no es la autora o autor no puede renombrarla ni
   eliminarla, pero sí agregar y quitar canciones.
8. **Given** que aún no hay colecciones, **When** se abre Canciones, **Then** la fila Colecciones muestra un estado
   vacío con el botón **Nueva colección** para crear la primera ahí mismo (o desde una canción).

---

### User Story 4 - Historial de canciones y generación por lotes (Priority: P4)

Cada canción que alguien del equipo obtiene o abre en Cloudy queda en el **Historial**. En la página Canciones y en la
página de cada canción, una fila muestra lo más reciente. En la página Canciones la persona puede marcar varias
canciones con casillas y generar sus presentaciones juntas.

**Why this priority**: acelera repetir presentaciones y reaprovechar lo ya consultado sin volver a pegar enlaces; es la
capa de comodidad sobre US1–US3.

**Independent Test**: obtener tres canciones distintas, comprobar que aparecen en el historial (la más reciente
primero), marcar las tres y generar sus presentaciones: llegan tres `.pptx`.

**Acceptance Scenarios**:

1. **Given** una canción obtenida o abierta, **When** se ve el historial, **Then** aparece al inicio con quién la
   consultó y cuándo; si ya estaba, sube al inicio sin duplicarse.
2. **Given** el historial en Canciones, **When** la persona marca dos o más canciones con casillas, **Then** aparece
   una barra de acción con el número marcado y el botón «Generar selección».
3. **Given** una selección de varias canciones, **When** pulsa generar, **Then** Cloudy avisa de cuántos archivos
   recibirá, las procesa de una en una, muestra el avance de cada una y descarga cada archivo al terminar.
4. **Given** una entrada del historial, **When** la persona la genera de nuevo, **Then** Cloudy usa la letra guardada
   (no rastrea otra vez) y no pide pegar el enlace.
5. **Given** una entrada del historial, **When** la persona la abre, **Then** llega a la página de esa canción; desde
   el historial también puede agregarla a una colección o quitarla (con confirmación) para limpiar la lista. Quitar
   una entrada no elimina la canción de las colecciones que la contienen.
6. **Given** un historial vacío, **When** se abre Canciones, **Then** la fila muestra un estado vacío que invita a pegar
   el primer enlace.
7. **Given** más entradas de las que caben en pantalla, **When** la persona avanza por el historial, **Then** se cargan
   más sin recargar la página y sin bloquear la interfaz.

---

### Edge Cases

- Enlace pegado con parámetros extra, fragmentos o barra final (`?utm_source=…`, `#letra`, `/`): se normaliza y se
  trata como la misma canción; no se crean duplicados.
- Enlace de Letras.com que no es de una canción (inicio del sitio, página de artista, de álbum o de listas): se
  reconoce por la forma del enlace y se rechaza antes de cualquier solicitud externa («Ese enlace no es de una
  canción…»). «No encontramos una letra en ese enlace» queda para enlaces con forma de canción cuya página no existe
  o no trae la letra.
- Enlace con otro esquema o host parecido (`http://`, `letras.com.otro.test`, `letras.com@otro.test`, puerto o
  credenciales en el enlace): se rechaza antes de cualquier solicitud externa.
- Dos personas pegan el mismo enlace a la vez: se guarda una sola canción; ninguna ve un error.
- La página rastreada es muy grande o trae mucho contenido ajeno a la letra (menús, anuncios, comentarios): solo se
  conserva la letra; si ni siquiera así cabe en el límite del servicio de presentaciones, se informa que no parece una
  canción.
- La letra rastreada llega vacía, truncada o con restos de la página: la persona puede usar **Volver a obtener la
  letra** y no queda guardada una canción sin letra.
- El servicio de rastreo tarda mucho: la espera tiene tope; al agotarse se informa y se permite reintentar sin perder
  el enlace escrito.
- El servicio de presentaciones está dormido al abrir la página: se despierta en segundo plano; si la persona genera
  antes de que despierte, la solicitud espera y no falla de inmediato.
- Se hace doble clic en **Generar presentación** o se reintenta rápido: no se lanzan generaciones duplicadas.
- Generar muchas canciones seguidas (colección o selección grande): se procesan de una en una para no saturar el
  servicio; la persona puede cancelar lo pendiente y lo ya descargado no se pierde.
- El navegador pide permiso para descargar varios archivos seguidos: Cloudy lo explica y permite volver a descargar
  los que se bloquearon sin generarlos de nuevo.
- El título de la canción trae tildes, eñes, signos o caracteres no válidos para nombres de archivo: el archivo
  conserva el título legible y el sistema lo hace un nombre válido.
- Una canción cuya letra ya no existe en Letras.com: sigue disponible con la letra guardada; solo **Volver a obtener la
  letra** falla y avisa.
- Una persona del equipo es desactivada o eliminada: sus colecciones siguen existiendo para el equipo y su autor se
  muestra como usuario que ya no está activo.
- Dos personas crean colecciones con el mismo nombre: se permite; cada una muestra su autor para distinguirlas.
- El servicio de rastreo no está configurado (sin credenciales): la página dice que la función no está disponible y
  no rompe el resto de Cloudy; las canciones ya guardadas siguen funcionando.
- La letra incluye indicaciones como «(Coro)» o «x2»: se conservan tal como vienen; el reparto en diapositivas es
  decisión del servicio de presentaciones.
- Una canción quitada del historial y de todas sus colecciones: sigue guardada 30 días (volver a pegar el enlace la
  abre sin rastrear); después se elimina y pegar el enlace vuelve a rastrear.
- La presentación se abre en PowerPoint sin fondo: la letra blanca no se ve sobre el fondo blanco del programa; es
  normal, está pensada para proyectarse sobre un fondo oscuro propio, y Cloudy lo avisa junto al botón de generar.

## Requirements *(mandatory)*

### Functional Requirements

**Acceso y navegación**

- **FR-001**: Cloudy MUST ofrecer dos páginas: el **índice** **Canciones** (`/canciones`) y la página de cada canción
  (`/canciones/<id>`), con entrada en la barra lateral, solo para administradores y editores. Toda acción del servidor
  de la feature MUST comprobar sesión y rol; ocultar la interfaz no cuenta como autorización.
- **FR-002**: Las personas sin sesión o sin rol permitido MUST ser tratadas como en las demás rutas protegidas.
- **FR-003**: El navegador MUST NOT recibir ni usar las credenciales del servicio de rastreo ni las del servicio de
  presentaciones: todas las llamadas a ambos las hace el servidor de Cloudy, y el navegador solo habla con Cloudy.

**Fase 1 — Obtención de la letra**

- **FR-004**: La página Canciones MUST mostrar, bajo el encabezado, un campo de enlace grande y visible en primer
  plano, con la misma forma y comportamiento general que el campo de la página YouTube (enviar con Enter o botón,
  estado de espera, mensaje de error junto al campo).
- **FR-005**: Cloudy MUST validar el enlace antes de navegar y **otra vez en el servidor antes de pedir nada a ningún
  servicio externo**. Solo se aceptan enlaces `https` cuyo host sea exactamente `letras.com` o `www.letras.com`, sin
  usuario, contraseña ni puerto; todo lo demás se rechaza con un mensaje en español que dice qué se acepta.
- **FR-006**: Cloudy MUST normalizar el enlace (host sin `www.`, sin parámetros, fragmento ni barra final) para
  identificar la canción; el mismo enlace normalizado MUST corresponder a una sola canción guardada.
- **FR-007**: Si la canción ya está guardada, Cloudy MUST abrirla sin rastrear de nuevo. Solo se rastrea una canción
  nueva o cuando la persona pide **Volver a obtener la letra**.
- **FR-008**: Para una canción nueva, Cloudy MUST pedir la página al servicio de rastreo, extraer de ella la zona de
  la letra (descartando menús, anuncios y comentarios), obtener el título (y el artista si la página lo indica) y
  ordenar la letra en estrofas y líneas en el formato que el servicio de presentaciones acepta (cuerpo de 1 a
  500 000 caracteres, título de hasta 200).
- **FR-009**: Cloudy MUST guardar la canción (enlace normalizado, título, artista, letra mapeada, fechas) solo cuando
  la letra se obtuvo completa; un rastreo fallido o sin letra MUST NOT dejar canciones ni filas a medias.
- **FR-010**: La página de una canción (`/canciones/<id>`) MUST mostrar en su parte superior, de arriba abajo y en este
  orden: (1) los **metadatos**: título, artista (si existe), enlace a la página de origen en Letras.com y fecha de
  obtención; (2) los **botones de acción**: **Generar presentación**, **Crear colección** / **Agregar a colección** y
  **Volver a obtener la letra**; (3) la **letra** completa ordenada por
  estrofas, en solo lectura. El historial reciente (FR-030) va debajo de la letra. En teléfono (360 px) los botones se
  acomodan en varias filas sin quitar ninguno ni forzar desplazamiento horizontal, y **Generar presentación** sigue
  visible sin recorrer toda la letra. **Volver a obtener la letra** MUST pedir confirmación breve y reemplaza la letra
  guardada solo si el nuevo rastreo tuvo éxito.
- **FR-011**: Cloudy MUST comunicar con acción de reintento los estados del servicio de rastreo (no configurado, sin
  cuota, ocupado, sin respuesta a tiempo, página sin letra), con textos en español que digan qué hacer; los errores
  del servicio externo MUST traducirse y no mostrarse tal cual.

**Fase 2 — Presentación**

- **FR-012**: La página de una canción MUST ofrecer **Generar presentación**; al generar, Cloudy MUST enviar al
  servicio de presentaciones la letra guardada, el título y el color de letra fijo (blanco), y MUST entregar el
  `.pptx` resultante como descarga del navegador.
- **FR-013**: La letra de las diapositivas MUST ir siempre en **blanco** (pensada para proyectar sobre un fondo
  oscuro). Cloudy no ofrece selector de color: envía ese color fijo al servicio y lo indica junto al botón de generar.
- **FR-014**: El archivo descargado MUST llamarse como el título de la canción, conservando tildes y eñes; la
  descarga MUST usar el nombre que informa el servicio de presentaciones, con un nombre de respaldo si no llega.
- **FR-015**: Cloudy MUST mostrar el número de diapositivas que informa el servicio y, cuando el servicio indique que
  el reparto fue el automático de respaldo, la nota «Las diapositivas se agruparon automáticamente (el reparto con IA
  no estuvo disponible)»; en ambos casos el archivo es válido y se entrega.
- **FR-016**: Cloudy MUST traducir los errores del servicio de presentaciones: «sin letra» y «letra demasiado larga
  (más de 300 líneas)» como mensajes propios y sin reintento automático; credencial inválida, caída o tiempo agotado
  como un mensaje genérico con **Reintentar**, sin mostrar el cuerpo del servicio ni credenciales. Una solicitud
  mal formada se trata como un error propio de Cloudy, no como culpa de la persona.
- **FR-017**: Cloudy MUST reintentar solo los fallos de espera y de servidor, nunca los errores definitivos (sin
  letra, letra demasiado larga).
- **FR-018**: El servicio de presentaciones puede estar dormido: Cloudy MUST despertarlo al abrir la página Canciones y
  esperar hasta 90 segundos una generación antes de darla por fallida, mostrando un estado de espera claro; el estado
  del servicio MUST compartir el aviso de la página YouTube, ya que es el mismo servicio.
- **FR-019**: Una generación MUST ejecutarse una sola vez por acción: el doble clic o el reintento rápido no deben
  lanzar generaciones duplicadas de la misma canción.

**Colecciones**

- **FR-020**: Cualquier administrador o editor MUST poder crear una colección con nombre (obligatorio, longitud
  acotada, sin espacios solos) desde la página de una canción o desde la fila Colecciones, y agregar canciones a
  colecciones existentes.
- **FR-021**: Las colecciones MUST ser globales para el equipo y mostrar su autor y su fecha de creación; todo el
  equipo MUST poder agregar y quitar canciones de cualquier colección.
- **FR-022**: Solo la autora o autor de una colección y los administradores MUST poder renombrarla o eliminarla;
  eliminar una colección MUST pedir confirmación y no elimina las canciones (siguen en el historial).
- **FR-023**: Una canción MUST aparecer una sola vez por colección; agregar una repetida se informa sin duplicar.
- **FR-024**: En la fila Colecciones, cada colección MUST tener un botón de opciones (⋯) y un botón de descarga que
  aparezcan al pasar el cursor o enfocar con teclado, y siempre visibles en pantallas táctiles, con las acciones:
  abrir, renombrar, eliminar y generar presentaciones.
- **FR-025**: Generar las presentaciones de una colección o de una selección MUST producir **un archivo por canción**,
  procesadas de una en una; Cloudy MUST decir antes de empezar cuántos archivos llegarán, mostrar el avance por
  canción y MUST permitir cancelar lo que aún no empezó.
- **FR-026**: Cuando algunas canciones de un lote fallan, Cloudy MUST entregar las presentaciones que sí se generaron e
  informar cuáles fallaron y por qué, sin detener las demás; si fallan todas, informa el fallo completo con
  **Reintentar** solo para las fallidas.

**Historial**

- **FR-027**: Cada vez que un administrador o editor obtiene una canción nueva o abre la página de una canción
  guardada, Cloudy MUST registrarla en el historial compartido (una entrada por canción, con quién la consultó por
  última vez y cuándo), subiéndola al inicio si ya estaba.
- **FR-028**: El historial MUST estar ordenado de la más reciente a la más antigua, paginarse al avanzar (sin
  recargar la página) y permitir marcar varias canciones con casillas, ver cuántas hay marcadas y generar sus
  presentaciones, además de limpiar la selección.
- **FR-029**: Cada entrada del historial MUST ofrecer abrir su página, agregarla a una colección, generar su
  presentación de nuevo con la letra guardada y quitarla del historial (con confirmación).
- **FR-030**: La página de una canción MUST mostrar, debajo de la letra, una fila con el historial reciente (sin
  repetir la canción actual) para saltar a otra.

**Estados, accesibilidad y datos**

- **FR-031**: Cada vista con datos (colecciones, historial, página de canción) MUST cubrir los estados cargando
  (skeleton), vacío, error con reintento y contenido.
- **FR-032**: Toda acción completada (crear, renombrar o eliminar colección; agregar o quitar canción; letra obtenida;
  presentación generada) MUST mostrar un aviso en español, y todo error MUST decir qué hacer a continuación.
- **FR-033**: Los textos MUST estar en español, la interfaz MUST usar solo los tokens de color de los temas de Cloudy
  y cumplir contraste AA en ambos temas, y todo MUST ser operable con teclado, con foco visible y respetando la
  preferencia de reducir movimiento. A 360 px no debe haber desplazamiento horizontal y los botones deben ser táctiles
  (≥ 44 px); nada puede ser descubrible solo con el cursor.
- **FR-034**: Cloudy MUST guardar solo lo necesario: enlace normalizado, título, artista, letra mapeada y fechas de la
  canción; colecciones, elementos de colección e historial. No guarda las presentaciones generadas (se descargan al
  dispositivo) ni la página completa rastreada. Una canción que lleva más de 30 días fuera del historial y sin
  pertenecer a ninguna colección se elimina automáticamente (limpieza diaria); si alguien vuelve a pegar su enlace, se
  rastrea de nuevo.
- **FR-035**: Los límites del servicio de presentaciones (hasta 300 líneas de letra, hasta 500 000 caracteres) MUST
  respetarse y comunicarse a la persona con un mensaje claro cuando una canción los supera.

### Key Entities *(include if feature involves data)*

- **Canción**: página de letra de Letras.com ya obtenida; enlace de origen normalizado (identificador natural, único),
  título (hasta 200 caracteres), artista (opcional), letra mapeada (estrofas y líneas), número de líneas, fecha de
  obtención y de última actualización. Es la base común de colecciones e historial y evita rastrear de nuevo cada vez;
  se conserva mientras esté en el historial o en una colección, y hasta 30 días después.
- **Entrada del historial**: una canción consultada por el equipo; incluye quién la consultó por última vez y cuándo.
  Una entrada por canción, compartida por todo el equipo.
- **Colección**: conjunto con nombre, autor (usuario del equipo), fecha de creación y de última modificación; global
  para el equipo.
- **Elemento de colección**: pertenencia de una canción a una colección, con la fecha en que se agregó (orden de la
  colección) y quién la agregó; una canción no se repite dentro de una colección.
- **Generación de presentación**: solicitud temporal (una canción) con estado y resultado (archivo,
  número de diapositivas, tipo de reparto o error). Vive solo mientras la persona mira la página; Cloudy no la
  guarda.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona del equipo consigue la presentación de una canción a partir de un enlace pegado en menos de
  4 acciones (pegar, ver la letra, generar, recibir el archivo) y, con los servicios ya despiertos, la recibe en menos
  de 60 segundos para una canción típica.
- **SC-002**: Al pegar un enlace nuevo y válido, la página de la canción muestra título y letra en menos de 20
  segundos con el servicio de rastreo disponible; durante la espera la persona ve un estado de progreso en menos de 1
  segundo.
- **SC-003**: Una canción ya guardada se abre en menos de 2 segundos y el 100 % de las veces sin un nuevo rastreo
  (salvo que la persona pida **Volver a obtener la letra**).
- **SC-004**: El 100 % de los enlaces inválidos (texto libre, otros sitios, `http`, dominios parecidos, enlaces con
  credenciales) se rechaza antes de pedir nada a ningún servicio externo, con un mensaje que dice qué enlaces se
  aceptan.
- **SC-005**: El 100 % de los archivos generados abre en PowerPoint y lleva el título de la canción como nombre, con
  las tildes y eñes correctas.
- **SC-006**: Generar una colección o selección de N canciones entrega N archivos (menos las que fallen); la persona
  siempre sabe cuántos recibirá antes de confirmar y el 100 % de las fallidas se listan con su motivo en español.
- **SC-007**: Crear una colección desde una canción y verla desde otra cuenta del equipo toma menos de 30 segundos y la
  colección siempre muestra su autor.
- **SC-008**: La página Canciones, con 5 000 entradas en el historial, muestra el primer bloque en menos de 2 segundos
  y mantiene la interacción por debajo de 200 ms al marcar casillas.
- **SC-009**: Ningún flujo de la feature exige desplazamiento horizontal a 360 px y todas las acciones son alcanzables
  en teléfono sin depender del cursor.
- **SC-010**: Ninguna credencial de los servicios externos (rastreo y presentaciones) es observable desde el
  navegador.
- **SC-011**: Tras un fallo (servicio caído, sin cuota, tiempo agotado, error de red) la persona recupera el control con
  una acción de reintento visible en menos de 5 segundos, sin recargar la página y sin perder el enlace escrito o la
  selección marcada.
- **SC-012**: Un servicio de presentaciones dormido no hace fallar una generación: el 100 % de las generaciones
  iniciadas con el servicio dormido terminan con éxito dentro de la espera máxima, o muestran un error con reintento.

## Assumptions

- **Usuarios**: solo administradores y editores usan la página (los mismos roles de equipo de Cloudy); los invitados no
  tienen acceso. Las colecciones y el historial son compartidos por todo el equipo, sin colecciones privadas en esta
  versión.
- **Servicio de presentaciones**: ya existe y se despliega aparte (el mismo `cloudy-api` de la feature 005, en
  Railway, que puede estar dormido, reiniciándose o desplegando). Su contrato (una canción por solicitud, hasta 300
  líneas y 500 000 caracteres, color de letra opcional, encabezados con diapositivas y tipo de reparto, errores
  «sin letra» y «letra demasiado larga») es el límite de lo que Cloudy puede ofrecer. **No rastrea ni busca letras:**
  recibe la letra ya extraída. La presentación sale con texto **blanco** sin relleno de fondo, pensada para proyectarse
  sobre un fondo oscuro propio; abierta en PowerPoint sin fondo, el texto no se distingue hasta aplicar uno.
- **Servicio de rastreo**: la obtención de la página de Letras.com la hace el actor `apify/rag-web-browser` de Apify,
  con el cliente ya instalado en el proyecto; Cloudy depende de su disponibilidad y de la cuota de la cuenta, y cuando
  no está disponible la feature se degrada con mensajes claros sin afectar al resto de la aplicación. Cada rastreo
  tiene costo y tarda segundos, por eso las letras se guardan y se reutilizan.
- **Enlaces admitidos**: páginas de canción de Letras.com (`letras.com` o `www.letras.com`, `https`). Páginas de
  artista, álbum, listas o búsquedas, y cualquier otro sitio de letras, quedan fuera de alcance.
- **Colección, no lista de YouTube**: «colección» es una lista de canciones de Cloudy; no existe importar colecciones
  desde Letras.com.
- **Descarga de colecciones**: el servicio genera una presentación por canción, así que descargar una colección o
  selección entrega **un archivo por canción**, uno tras otro; unirlas en una sola presentación o en un `.zip` no se
  incluye en esta versión.
- **Archivos pequeños en el servidor**: las presentaciones pesan decenas de KB, de modo que pasar el archivo por el
  servidor de Cloudy (necesario para no exponer la credencial al navegador) cabe de sobra en los límites de la
  plataforma; esto no contradice la regla de no retransmitir archivos pesados por el servidor.
- **Reparto en diapositivas**: lo decide el servicio de presentaciones (modelo de lenguaje, con reparto automático de
  respaldo); Cloudy no permite editar la letra ni la distribución de diapositivas en esta versión.
- **Persistencia**: Cloudy guarda solo canciones, colecciones, elementos de colección e historial; las presentaciones
  se generan bajo demanda y no se almacenan.
- **Cumplimiento**: las letras tienen derechos de autor y rastrear Letras.com puede contradecir sus términos de uso;
  su uso es decisión y responsabilidad de quien opera Cloudy, y la página puede incluir un aviso breve para el equipo
  de que las letras son de uso interno.
- **Alcance excluido**: guardar la presentación generada en el drive de Cloudy, editar o corregir la letra a mano,
  elegir el color de la letra, plantillas o fondos, combinar varias canciones en una sola presentación, buscar canciones por nombre dentro de
  Cloudy, otros sitios de letras, programar generaciones y notificaciones por correo no forman parte de esta versión.
