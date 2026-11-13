# Feature Specification: Página Peticiones — peticiones de oración a imágenes para proyectar

**Feature Branch**: `007-peticiones-imagenes` (carpeta de documentos: `specs/007-peticiones-imagenes/`)

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "New Nuxt page as feature named Peticiones. On the peticiones i require to display the uploaded requests from @app/pages/upload.vue and link shared upload as multiselect radio buttons cards arranged in a grid of cols and rows, no table, then the selected cards transcription goes to api where consume the openrouter client in order to generate an image or images where each image maximum margin of upload content description can include 4 parragaphs, then the 5th will be placed in a second image displaying the pray requests of the day. the llm is a custom image type llm with system prompt and, part of the input goes a image as template where simply the llm will fill the empty indicated body space with the selected card content. Add filters by date, sorter asc and desc, infinite scrolling, responsive grid and search input. Include in the card the submitted image and make the ai transcript content editable so, if includes a [unlegible] like text, the user can update it before generate the image."

> **Enmienda (2026-11-13) — el texto se escribe a mano; se retiró la transcripción automática.** La feature 002 (lectura
> del texto de las imágenes con el modelo de visión de OpenRouter) se **retiró por completo**, así que Peticiones se quedó
> sin su fuente de texto y cambia así:
>
> - **Elegir**: cualquier imagen de un envío aprobado, visible y fuera de la papelera se puede elegir. Ya no hay filtro por
>   «transcripción lista» (`isSelectable` desaparece) ni el aviso «Sin texto: escríbelo primero». Sigue el tope de 40.
> - **Escribir**: «Generar imágenes» pasa a llamarse **«Escribir textos y generar»** y abre `PrayerComposeDialog`
>   (reemplaza a `PrayerSelectionDialog` **y** a `PrayerTextDialog`): las peticiones elegidas agrupadas por imagen, cada una
>   con su foto, remitente, nota, un `textarea` (1–10 000 caracteres, `PRAYER_TEXT_MAX_LENGTH`) y «Quitar». El botón de
>   generar queda deshabilitado mientras falte algún texto, y el diálogo dice cuántos faltan.
> - **Persistencia**: el texto **no se guarda en ningún lado**. Vive en la selección de la página (`usePrayerSelection`,
>   `useState`, solo en memoria): recargar o salir lo pierde, y el guardián de salida ya avisaba de la cola en curso.
> - **Contrato**: `POST /api/peticiones/imagenes` recibe `{ requests: [{ fileId, text }] }` (1–4, ids distintos) en vez de
>   `{ fileIds }`. El navegador **sí** manda el texto ahora (FR-027 «el servidor lo relee» queda sin efecto); el servidor
>   solo comprueba que cada id siga disponible y fija el orden de los párrafos `(reviewed_at, created_at, id)`.
> - **Historial**: `prayer_images` sigue guardando solo los ids, nunca el texto, así que **desaparece «Generar de nuevo»**
>   del menú de una imagen guardada (no hay texto que repetir). Lo demás del historial y las colecciones no cambia.
> - **Búsqueda**: cubre remitente y nota; ya no el texto de la imagen.
> - **Ilegibles**: se retira toda la maquinaria de `[ilegible]` (`hasIllegibleMark`, `splitIllegible`, la insignia «Texto por
>   corregir», el aviso de la barra y el segundo paso de confirmación): era un artefacto de la transcripción automática.
>   Se conserva `isLongText` (aviso «puede no caber»), ahora dentro del diálogo.
>
> Quedan **sin efecto** FR-027 (releer el texto en el servidor) y lo que la US3 decía sobre corregir una transcripción
> existente: la US3 pasa a ser «escribir el texto antes de generar». Ver la nota de retirada al principio de
> `specs/002-note-text-extraction/spec.md`.

> **Enmienda (2026-11-12) — historial y colecciones de imágenes generadas.** Las imágenes generadas **ya se guardan**: cada
> una se sube al bucket (`peticiones/<id>.<ext>`) con una fila en `prayer_images` (los ids de sus 1–4 peticiones, nunca su
> texto) y aparece en una sección nueva, **Historial de imágenes generadas**, compartida por el equipo, la más reciente
> primero y con desplazamiento infinito. La página queda en tres secciones, en este orden: **Colecciones** (fila
> desplazable de colecciones con nombre que agrupan imágenes generadas, como en Canciones), **Peticiones aprobadas** (lo
> que ya existía) e **Historial**. Desde el historial cada imagen se descarga (enlace con `Content-Disposition`), se amplía,
> se guarda en una colección, se **genera de nuevo** con las mismas peticiones (el servidor relee su texto actual) o se
> **elimina** (solo su autora o un administrador). Las imágenes se conservan **30 días** salvo las que estén en una
> colección; la limpieza diaria borra las demás. La cola en curso (en cola, generándose, fallida o cancelada) se muestra
> arriba del historial y el aviso al salir solo cuenta lo que está en curso. Quedan **sin efecto** FR-026 («no guardarlas»
> y «avisar si hay imágenes sin descargar») y el supuesto «Persistencia de las imágenes»; FR-023 y FR-024 pasan a
> referirse a la cola en curso y al historial. Ver `data-model.md` § Historial, `contracts/api.md` § 5–6 y
> `contracts/ui.md` § Estructura.

## Contexto

Los invitados de la iglesia envían sus peticiones de oración desde la página pública `/upload`: normalmente una foto de
una tarjeta escrita a mano, con su nombre y una nota opcional. Cloudy ya lee el texto de esas imágenes (feature 002) y
el equipo las ve en **Solicitudes** (feature 003) para aprobar o rechazar el material. Hoy, para proyectar las
peticiones del día durante el servicio, el equipo de multimedia tiene que abrir cada foto, reescribir el texto en una
diapositiva o en una imagen y darle formato, cada semana y a mano.

Esta feature agrega a Cloudy una página **Peticiones** donde administradores y editores ven las peticiones recibidas
—solo las de envíos que el equipo ya **aprobó** en Solicitudes— como **tarjetas** en una rejilla (no una tabla), eligen cuáles proyectar, corrigen la transcripción si el texto salió
ilegible y generan **imágenes de «Peticiones de oración del día»**: cada imagen parte de una **plantilla** diseñada por
el equipo, y un modelo de generación de imágenes solo rellena el espacio vacío del cuerpo con el texto de las
peticiones elegidas. Cada imagen lleva hasta **4 peticiones**; si hay más, las siguientes pasan a una segunda imagen
(la quinta petición abre la segunda imagen), a una tercera, y así sucesivamente.

El navegador nunca habla con el proveedor del modelo de imágenes: lo hace el servidor de Cloudy, que guarda las
credenciales (igual que con la lectura de texto de imágenes y con las demás integraciones externas del proyecto).

**Terminología** (textos de interfaz, en español):

- **Peticiones**: la página del equipo con la rejilla de tarjetas, los filtros y la bandeja de generación.
- **Petición**: una imagen enviada por un invitado cuyo envío ya fue **aprobado** y que tiene (o puede tener) una
  **transcripción**; es la unidad de una tarjeta y equivale a **un párrafo** en la imagen generada.
- **Transcripción**: el texto leído de la imagen por la IA (feature 002), que el equipo puede corregir.
- **Plantilla**: la imagen base del diseño de «Peticiones de oración del día», con un espacio de cuerpo vacío
  donde va el texto (el área abierta bajo el título).
- **Imagen de peticiones**: el resultado: la plantilla con el cuerpo relleno con hasta 4 peticiones.
- **Bandeja de resultados**: la sección «Imágenes generadas» de la propia página de Peticiones (no una bandeja fija del
  layout como las de YouTube y Canciones), donde aparecen, se descargan y se reintentan las imágenes.
- **Selección**: el conjunto de tarjetas elegidas para generar.

## Clarifications

### Session 2026-11-07

- Directiva del usuario: nueva página **Peticiones** que muestra los envíos de `/upload` como tarjetas de selección
  múltiple en rejilla (sin tabla), con enlace para compartir la página de subida; las transcripciones de las tarjetas
  elegidas se mandan al servidor para generar con un modelo de generación de imágenes (consumido a través del cliente
  de OpenRouter ya usado en el proyecto, con *system prompt* propio y la plantilla como parte de la entrada) una o
  varias imágenes; **máximo 4 párrafos por imagen**, el quinto va a una segunda imagen; filtros por fecha, orden
  ascendente/descendente, desplazamiento infinito, rejilla adaptable y buscador; cada tarjeta muestra la imagen
  enviada y su transcripción es editable para corregir textos como `[ilegible]` antes de generar.
- Decisiones tomadas por defecto (sin pregunta al usuario, reversibles en `/speckit-clarify`):
  - **Una tarjeta = una imagen enviada de un envío aprobado** y **una petición = un párrafo** en la imagen generada. Una petición nunca se
    parte entre dos imágenes.
  - **«Selección múltiple con botones de radio»** se entiende como tarjetas con un indicador circular de selección
    (aspecto de radio) que **sí admiten varias a la vez** (semántica accesible de casilla de verificación).
  - **Generar imágenes** no cambia el estado de ningún envío en Solicitudes.
  - **Plantilla única**: la fija el equipo técnico; no se elige ni se sube desde la página.
  - **Las imágenes generadas no se guardan** en el drive: se ven en la página y se descargan (como las presentaciones
    de Canciones).
  - **El nombre del invitado no se imprime** en la imagen: solo el texto de la petición.
- Q: ¿Qué envíos se muestran en la rejilla? → A: Solo los **aprobados**. Los envíos por revisar, rechazados o
  caducados no aparecen; aprobar en Solicitudes es el paso previo para que una petición llegue a esta página.
- Q: ¿Qué fecha usan el filtro y el orden: la de envío o la de aprobación? → A: La **fecha de aprobación**, para que
  «Hoy» coincida con lo que el equipo aprobó para el servicio de ese día (la tarjeta muestra también cuándo se envió).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver las peticiones como tarjetas y elegir cuáles proyectar (Priority: P1) 🎯 MVP

Un administrador o editor entra a **Peticiones** desde la barra lateral. Ve una **rejilla de tarjetas**, una por cada
imagen **aprobada** de los envíos de los invitados: la foto enviada, la transcripción leída por la IA, el nombre de quien la envió, cuándo
se aprobó (y, como dato secundario, cuándo se envió) y, si la hay, su nota. Cada tarjeta tiene un **indicador circular de selección**; tocar la tarjeta (o ese
indicador, o pulsar Espacio con el foco en ella) la marca o desmarca, y se pueden marcar **varias**. Una barra muestra
cuántas tarjetas están elegidas y permite limpiar la selección. La rejilla se adapta al ancho: una columna en
teléfono, más columnas en pantallas más anchas, siempre sin tabla ni desplazamiento horizontal. Al llegar al final de
lo cargado se cargan más tarjetas automáticamente. En el encabezado hay un botón **Copiar enlace para invitados** que
copia el enlace de la página de subida (`/upload`), igual que en Solicitudes, y el estado vacío lo ofrece junto con un
enlace a **Solicitudes** para aprobar los envíos que esperan revisión.

**Why this priority**: sin ver y elegir las peticiones no hay nada que generar; es la base de la página y entrega valor
por sí sola (el equipo ya puede revisar todas las peticiones del día con su foto y su texto en un solo lugar).

**Independent Test**: con varios envíos con imágenes en el entorno de pruebas (aprobados, por revisar y rechazados),
abrir **Peticiones**, comprobar que solo los aprobados aparecen como tarjetas en rejilla con foto y texto, marcar tres tarjetas, comprobar que la barra dice «3 elegidas»,
desmarcar una y comprobar «2 elegidas», y desplazarse hasta el final para ver cargar más tarjetas.

**Acceptance Scenarios**:

1. **Given** la barra lateral, **When** un administrador o editor abre **Peticiones**, **Then** ve el encabezado, el
   botón **Copiar enlace para invitados**, los controles de búsqueda, fecha y orden, y la rejilla de tarjetas; una
   persona sin sesión o con rol no permitido es tratada como en las demás rutas protegidas.
2. **Given** envíos de invitados con imágenes en distintos estados, **When** se abre la página, **Then** cada imagen de
   un envío **aprobado** aparece como una tarjeta con su foto, su transcripción, el nombre de quien la envió, el tiempo
   transcurrido desde que se aprobó («Aprobada hace…»), la fecha de envío como dato secundario y la nota si existe; las de envíos por revisar, rechazados o caducados no aparecen, y
   un envío recién aprobado en Solicitudes aparece en la rejilla al recargar o volver a la página.
3. **Given** una tarjeta con transcripción, **When** la persona la toca, pulsa su indicador circular o pulsa Espacio con
   el foco en ella, **Then** la tarjeta queda marcada de forma visible (no solo por color) y se anuncia como marcada a
   las tecnologías de asistencia; al repetirlo se desmarca; abrir la foto en grande **no** cambia la selección.
4. **Given** varias tarjetas marcadas, **When** la persona mira la barra de selección, **Then** ve el número de
   peticiones elegidas, el número de imágenes que se generarían y un botón para limpiar la selección.
5. **Given** una imagen cuya lectura aún está en curso, falló, no encontró texto o no es elegible para lectura, **When**
   se ve su tarjeta, **Then** muestra su estado en español («Leyendo…», «No se pudo leer», «No se reconoció texto») y
   no se puede marcar hasta que tenga texto (la persona puede escribirlo a mano, ver Historia 3).
6. **Given** más tarjetas de las que caben en la primera carga, **When** la persona se acerca al final de la rejilla,
   **Then** se cargan más tarjetas sin pulsar nada, con un indicador de carga, y al agotarse la lista un aviso de fin;
   la selección ya hecha se conserva.
7. **Given** la carga inicial, **When** está en curso, falla o no hay ninguna petición, **Then** se ve respectivamente
   un esqueleto de tarjetas, un error con botón **Reintentar** y un estado vacío («Todavía no hay peticiones aprobadas») que ofrece ir a **Solicitudes** y copiar el enlace para
   invitados; si falla la carga de una página posterior, el error con **Reintentar** aparece al final de la rejilla sin
   perder lo ya cargado.
8. **Given** la página en teléfono (360 px) y en escritorio (≥ 1280 px), **When** se ve la rejilla y la barra de
   selección, **Then** no hay desplazamiento horizontal, los objetivos táctiles miden al menos 44 px y nada depende de
   pasar el cursor.

---

### User Story 2 - Generar las imágenes de peticiones a partir de la selección (Priority: P2)

Con varias tarjetas elegidas, la persona pulsa **Generar imágenes**. Cloudy le muestra un resumen («8 peticiones →
2 imágenes»), avisa si alguna petición elegida todavía tiene texto ilegible y pide confirmar (cada generación consume
crédito del proveedor). Al confirmar, el servidor reparte las peticiones en grupos de **hasta 4** —las primeras 4 a la
primera imagen, de la quinta a la octava a la segunda, etc.— y para cada grupo pide al modelo de generación de imágenes
que **rellene el espacio vacío del cuerpo de la plantilla** con ese texto. Cada imagen aparece en una bandeja de
resultados en cuanto está lista, con vista previa, y se puede **descargar**. Si una imagen falla, las demás no se
pierden y esa se puede reintentar sola.

**Why this priority**: es el resultado que el equipo busca y depende de poder elegir peticiones (US1). Juntas, US1 y US2
forman el recorrido completo: peticiones → selección → imágenes para proyectar.

**Independent Test**: elegir 5 peticiones con texto, pulsar **Generar imágenes**, confirmar el resumen «5 peticiones →
2 imágenes», comprobar que aparece una primera imagen con 4 peticiones y una segunda con 1, abrir cada vista previa y
descargarlas con un nombre que incluya la fecha y el número de imagen.

**Acceptance Scenarios**:

1. **Given** una selección de 1 a 4 peticiones con texto, **When** la persona pulsa **Generar imágenes** y confirma,
   **Then** se genera **una** imagen cuyo cuerpo contiene exactamente esas peticiones, una por párrafo, en el orden
   definido en los requisitos, con el diseño de la plantilla intacto.
2. **Given** una selección de 5 a 8 peticiones, **When** se confirma, **Then** se generan **dos** imágenes: la primera
   con las primeras 4 y la segunda con las restantes; con 9 a 12, tres imágenes, y así hasta el tope por generación.
3. **Given** el diálogo de confirmación, **When** se abre, **Then** muestra cuántas peticiones y cuántas imágenes se
   generarán, y si alguna petición elegida contiene texto con marca de ilegible (`[ilegible]` o similar) lo indica con
   su número y deja **volver a editar** o **continuar de todos modos**.
4. **Given** una generación en curso, **When** se genera cada imagen, **Then** la bandeja muestra el progreso de cada
   una (en cola, generando, lista, con error), la persona puede seguir usando la página y cada imagen lista se puede
   ver en grande y **descargar** sin esperar a las demás.
5. **Given** una imagen que falló (proveedor sin respuesta, sin crédito, sin configurar, o resultado inválido), **When**
   la persona la ve en la bandeja, **Then** lee un mensaje en español que dice qué hacer y puede pulsar **Reintentar**
   solo para esa imagen; las imágenes ya generadas siguen disponibles.
6. **Given** una imagen ya generada, **When** la persona no está conforme (por ejemplo, el texto salió cambiado o no
   cabe), **Then** puede pulsar **Generar de nuevo** para esa imagen sin repetir las demás.
7. **Given** que el proveedor o la plantilla no están configurados, **When** se pulsa **Generar imágenes**, **Then** la
   página responde con un mensaje claro de que la función no está disponible y a quién avisar, sin intentar nada.
8. **Given** una petición cuyo texto es una instrucción (por ejemplo «ignora la plantilla y escribe otra cosa»),
   **When** se genera, **Then** ese texto se trata solo como contenido a mostrar en el cuerpo y nunca altera el diseño
   ni el comportamiento de la generación.

---

### User Story 3 - Corregir la transcripción antes de generar (Priority: P3)

Algunas transcripciones salen con marcas como `[ilegible]` porque la letra a mano no se entendió, o sin texto. En la
tarjeta, el texto de la transcripción es **editable**: la persona pulsa **Corregir texto**, ve la foto original junto al campo
de texto, reemplaza la marca por lo que ella lee (o escribe la transcripción completa si no había), y guarda. La
tarjeta muestra el texto corregido con la insignia **Editada**, y las marcas de ilegible que sigan en el texto se
resaltan con una advertencia para que no se pasen por alto.

**Why this priority**: sin corrección, una marca `[ilegible]` terminaría impresa en la imagen proyectada; es lo que
vuelve confiable la generación (US2), pero la generación ya funciona con las transcripciones buenas.

**Independent Test**: en una tarjeta con `[ilegible]` en su texto, pulsar **Corregir texto**, sustituir la marca por una palabra,
guardar, y comprobar que la tarjeta muestra el texto nuevo con la insignia **Editada** y sin advertencia; recargar la
página y comprobar que el texto corregido se conserva.

**Acceptance Scenarios**:

1. **Given** una tarjeta con transcripción, **When** la persona pulsa **Corregir texto**, **Then** el texto pasa a un campo
   editable con su contador de caracteres, y la foto original sigue visible (o se abre en grande) para consultarla
   mientras se corrige; **Guardar** y **Cancelar** son alcanzables con teclado y con el pulgar.
2. **Given** una transcripción con `[ilegible]`, `[unlegible]`, `[illegible]` o una marca entre corchetes parecida,
   **When** se ve la tarjeta, **Then** esa marca se resalta con un indicador de advertencia (no solo por color) y la
   tarjeta lo anuncia como «Texto por corregir».
3. **Given** un texto editado y guardado, **When** la persona vuelve a ver la tarjeta o recarga la página, **Then** ve el
   texto corregido con la insignia **Editada**, y ese mismo texto es el que se usa al generar.
4. **Given** una imagen sin texto leído (falló o «No se reconoció texto»), **When** la persona pulsa **Escribir
   transcripción**, **Then** puede escribirla a mano, guardarla y, desde ese momento, la tarjeta se puede marcar.
5. **Given** que la persona vacía el campo o supera el límite de caracteres, **When** intenta guardar, **Then** ve un
   mensaje de validación en español junto al campo y no se guarda nada; si el guardado falla, el texto escrito no se
   pierde y puede reintentar.
6. **Given** una transcripción editada por el equipo, **When** el sistema vuelve a leer esa imagen de forma automática,
   **Then** el texto editado **no se sobrescribe**.

---

### User Story 4 - Buscar, filtrar por fecha y ordenar las peticiones (Priority: P4)

Cuando hay muchas peticiones, la persona **busca** por texto (nombre de quien envió, nota o contenido de la
transcripción), **filtra por fecha** (hoy, últimos 7 días, un rango personalizado o todas) y **ordena** de la más
reciente a la más antigua o al revés. La rejilla se recarga con esos criterios, el desplazamiento infinito sigue
funcionando sobre el resultado y la selección ya hecha se conserva aunque cambien los filtros.

**Why this priority**: acelera encontrar «las peticiones de hoy» cuando el volumen crece, pero la página ya es útil sin
ello (US1–US3).

**Independent Test**: con peticiones de varios días y varios nombres, buscar un nombre y ver solo sus tarjetas; filtrar
por «Hoy» y ver solo las de hoy; cambiar a orden ascendente y ver la más antigua primero; con tarjetas elegidas, cambiar
el filtro y comprobar que el contador de la barra no cambia.

**Acceptance Scenarios**:

1. **Given** el campo de búsqueda, **When** la persona escribe (con una pequeña espera tras dejar de teclear), **Then**
   la rejilla muestra solo las tarjetas cuyo nombre, nota o transcripción contienen el texto, sin distinguir
   mayúsculas ni tildes («oracion» encuentra «oración»); un botón limpia la búsqueda.
2. **Given** el filtro de fecha, **When** la persona elige **Hoy**, **Últimos 7 días**, **Rango** (desde/hasta) o
   **Todas**, **Then** solo se muestran las tarjetas **aprobadas** en ese periodo según el día local de la persona (una petición enviada ayer
   y aprobada hoy aparece con **Hoy**), y el
   filtro activo se ve resumido y se puede quitar con un toque.
3. **Given** el selector de orden, **When** la persona elige **Más recientes primero** (predeterminado) o **Más
   antiguas primero**, **Then** la rejilla se reordena por fecha de aprobación y el desplazamiento infinito continúa en
   ese orden sin repetir ni omitir tarjetas.
4. **Given** una búsqueda o un filtro sin coincidencias, **When** termina la carga, **Then** se ve un estado vacío que
   dice que no hay coincidencias y ofrece **Quitar filtros**, distinto del estado vacío «aún no hay peticiones».
5. **Given** tarjetas ya marcadas, **When** la persona cambia búsqueda, fecha u orden, **Then** la selección se conserva
   (también las marcadas que dejaron de verse) y la barra sigue mostrando el total elegido, con una forma de revisar
   cuáles son.
6. **Given** los filtros en teléfono (360 px), **When** se usan, **Then** caben sin desplazamiento horizontal, con
   objetivos táctiles de al menos 44 px.

---

### Edge Cases

- **Ninguna petición aprobada todavía** (aunque haya envíos por revisar): estado vacío con enlace a Solicitudes y el
  botón para copiar el enlace de `/upload`.
- **Ninguna petición con texto elegida**: **Generar imágenes** está deshabilitado y explica por qué.
- **Selección muy grande**: hay un tope de peticiones por generación (ver Requisitos); al alcanzarlo, las demás
  tarjetas no se pueden marcar y se explica el tope.
- **Petición con texto muy largo** que probablemente no cabe en el cuerpo de la plantilla: la tarjeta lo advierte
  («Texto largo: puede no caber») sin bloquear; la persona puede acortarlo al editar.
- **Texto con salto de línea, emojis o caracteres no latinos**: se conserva tal cual en la transcripción; en la imagen
  se pide fidelidad al texto.
- **Una imagen del grupo falla y las otras no**: se conservan las listas y solo se reintenta la fallida.
- **La persona cierra o recarga la página durante la generación**: las imágenes no se guardan; al volver, la bandeja
  está vacía y la selección también (se avisa antes de salir si hay una generación en curso o imágenes sin descargar).
- **Dos personas del equipo editan la misma transcripción**: gana el último guardado; el texto que cada persona ve se
  actualiza al recargar.
- **Una imagen aprobada deja de estar disponible mientras su tarjeta está elegida** (por ejemplo, se envía a la
  papelera o se elimina): la tarjeta desaparece de la rejilla al recargar o volver a la página; si ya estaba elegida,
  se detecta al pulsar **Generar imágenes** (el servidor responde que ya no está disponible), se retira de la
  selección con un aviso y esa imagen no se genera.
- **Una petición elegida cambia de texto mientras otra imagen está generándose**: cada imagen usa el texto vigente
  en el momento en que **empieza** a generarse; una vez iniciada, no cambia.
- **Imagen enviada sin vista previa posible o ya eliminada**: la tarjeta muestra un marcador con el nombre del archivo
  y el resto de la tarjeta sigue funcionando.
- **Dos imágenes con exactamente el mismo texto** (por ejemplo, el mismo envío repetido): se tratan como peticiones
  distintas; la persona decide cuál elegir.
- **Sin conexión** al editar, buscar o generar: mensaje accionable; lo escrito en un campo de edición no se pierde.

## Requirements *(mandatory)*

### Functional Requirements

**Página y acceso**

- **FR-001**: El sistema MUST ofrecer una página **Peticiones**, con entrada en la barra lateral, accesible solo para
  administradores y editores; las demás personas MUST ser tratadas como en el resto de rutas protegidas, y **cada
  endpoint** MUST validar sesión y rol en el servidor.
- **FR-002**: La página MUST incluir el botón **Copiar enlace para invitados** que copia el enlace de la página de
  subida y confirma con un aviso.

**Rejilla de tarjetas**

- **FR-003**: El sistema MUST mostrar las peticiones como **tarjetas en una rejilla adaptable** (una columna en
  teléfono, más columnas en pantallas más anchas) y MUST NOT usar una tabla.
- **FR-004**: Cada tarjeta MUST mostrar la **imagen enviada** (con carga diferida), la **transcripción**, el nombre de
  quien la envió, el tiempo transcurrido desde su aprobación, la fecha de envío como dato secundario y la nota del
  envío si existe; la imagen se puede abrir en grande sin alterar la selección.
- **FR-005**: El sistema MUST listar una tarjeta por cada **imagen** de un envío **aprobado**, y MUST NOT listar las
  de envíos por revisar, rechazados o caducados, los archivos que no son imágenes ni los que estén en la papelera o
  eliminados. Estar en esta página MUST NOT cambiar el estado de ningún envío en Solicitudes.
- **FR-006**: Cada tarjeta MUST mostrar el estado de su transcripción (leyendo, lista, sin texto, fallida, no
  disponible) con texto en español, y SOLO las tarjetas con texto no vacío MUST poder marcarse.
- **FR-007**: El sistema MUST cargar las tarjetas **por páginas con desplazamiento infinito**, sin duplicar ni omitir
  tarjetas cuando llegan envíos nuevos o cambia el orden, mostrando indicador de carga, aviso de fin de lista y error
  con **Reintentar** por página.
- **FR-008**: La página MUST cubrir los cuatro estados de toda vista de datos: cargando (esqueleto), vacío, error con
  reintento y contenido; y distinguir «aún no hay peticiones aprobadas» de «sin coincidencias con los filtros».

**Selección**

- **FR-009**: Las tarjetas MUST admitir **selección múltiple** mediante un indicador circular visible, con toque en
  la tarjeta, toque en el indicador o tecla Espacio; el estado MUST ser perceptible sin depender solo del color y MUST
  exponerse a tecnologías de asistencia como marcado/no marcado.
- **FR-010**: Una barra de selección MUST mostrar el número de peticiones elegidas y el de imágenes que se generarían,
  permitir **limpiar** la selección y permitir **revisar** cuáles están elegidas (incluidas las que los filtros
  ocultan).
- **FR-011**: La selección MUST conservarse al buscar, filtrar, ordenar y cargar más tarjetas durante la visita a la
  página; MUST NOT sobrevivir a una recarga completa.
- **FR-012**: El sistema MUST fijar un **tope de peticiones por generación** (valor inicial: 40, es decir, 10
  imágenes) y MUST impedir marcar más allá del tope, explicándolo.

**Edición de la transcripción**

- **FR-013**: Cada tarjeta con transcripción MUST ofrecer **Corregir texto**, con campo de texto, contador y límite de
  caracteres igual al de la lectura de imágenes (10 000), validación en español, **Guardar** y **Cancelar**; una
  imagen sin texto MUST ofrecer **Escribir transcripción** con el mismo campo.
- **FR-014**: Al guardar, el texto corregido MUST reemplazar la transcripción de esa imagen para todo el equipo y en
  todo Cloudy (la tarjeta y el archivo en el drive), marcarse como **Editada** y ser el que se use al
  generar; un fallo al guardar MUST conservar lo escrito y permitir reintentar.
- **FR-015**: El sistema MUST detectar y resaltar con advertencia no solo cromática las **marcas de ilegible**: texto
  entre corchetes que contenga «legible» sin distinguir mayúsculas ni tildes (`[ilegible]`, `[unlegible]`,
  `[illegible]`, `[texto ilegible]`…), y marcar la tarjeta como «Texto por corregir» mientras alguna siga presente.
- **FR-016**: Una transcripción **editada** MUST NOT ser sobrescrita por una nueva lectura automática de la imagen.
- **FR-017**: Las tarjetas con **texto largo** (más de 600 caracteres, valor inicial ajustable con la plantilla real)
  MUST advertir que puede no caber, sin impedir marcarlas.

**Generación de imágenes**

- **FR-018**: Con la selección en la barra, **Generar imágenes** MUST abrir una confirmación con el número de
  peticiones y de imágenes, y avisar de las peticiones elegidas con marca de ilegible, ofreciendo volver a editar o
  continuar; **Generar imágenes** MUST estar deshabilitado, con motivo, si no hay ninguna petición con texto elegida.
- **FR-019**: El sistema MUST repartir las peticiones elegidas en grupos de **a lo sumo 4** (cada petición es un
  párrafo y nunca se parte entre imágenes), en **orden cronológico ascendente de aprobación** (la más antigua primero; en un empate, por fecha de envío y luego
  de forma estable) sin importar el orden de la rejilla, de modo que la quinta petición abre la segunda imagen, la novena la tercera, etc.
- **FR-020**: Para cada grupo, el servidor MUST generar **una imagen** pidiendo a un modelo de generación de imágenes,
  a través del cliente de OpenRouter, con instrucciones de sistema propias y la **plantilla** como parte de la
  entrada, que **solo rellene el espacio vacío del cuerpo** con el texto del grupo, sin cambiar el resto del diseño,
  sin reescribir, resumir ni traducir el texto, y sin añadir contenido.
- **FR-021**: El texto de cada petición MUST tratarse siempre como **contenido literal** a mostrar, nunca como
  instrucciones para el modelo.
- **FR-022**: El nombre del invitado, su nota y cualquier dato personal distinto del texto de la petición MUST NOT
  enviarse al proveedor ni aparecer en la imagen.
- **FR-023**: Las imágenes MUST generarse de forma independiente: cada una MUST aparecer en la bandeja en cuanto esté
  lista, con vista previa ampliable y descarga con un nombre que incluya la fecha y el número de imagen; el fallo de
  una MUST NOT descartar las demás.
- **FR-024**: La bandeja MUST mostrar el estado de cada imagen (en cola, generando, lista, con error), permitir
  **Reintentar** una imagen con error y **Generar de nuevo** una ya lista, sin repetir las demás.
- **FR-025**: Los errores (sin configurar, sin crédito, límite de uso, proveedor sin respuesta, plantilla ausente o
  resultado inválido) MUST llegar al usuario con un mensaje en español que diga qué hacer, y MUST NOT dejar imágenes a
  medias; los mensajes MUST vivir en el catálogo central de mensajes de la interfaz.
- **FR-026** *(enmendado 2026-11-12)*: ~~Las imágenes generadas MUST NOT guardarse en el drive ni en la base de datos; MUST
  descargarse desde el navegador, y la página MUST avisar antes de salir si hay una generación en curso o imágenes sin
  descargar.~~ Las imágenes generadas MUST guardarse en el bucket con su fila en `prayer_images` (no en el drive) y
  aparecer en el **Historial de imágenes generadas**; MUST conservarse 30 días salvo las que estén en una colección; la
  página MUST avisar antes de salir solo si hay una generación en cola o en curso.
- **FR-027**: Cada imagen MUST usar el texto de sus peticiones tal como está guardado cuando **empieza** a generarse
  (el servidor lo lee en ese momento; el navegador solo indica qué peticiones van en la imagen).

**Búsqueda, filtros y orden**

- **FR-028**: El sistema MUST ofrecer un **buscador** (con pequeña espera tras teclear y botón de limpiar) sobre el
  nombre de quien envió, la nota y la transcripción, sin distinguir mayúsculas ni tildes.
- **FR-029**: El sistema MUST ofrecer un **filtro por fecha de aprobación** con **Hoy**, **Últimos 7 días**, **Rango**
  (desde/hasta) y **Todas** (predeterminado), interpretando los días en la zona horaria de la persona, con el filtro
  activo visible y removible.
- **FR-030**: El sistema MUST ofrecer **orden ascendente y descendente** por fecha de aprobación (predeterminado:
  descendente) y MUST mantener un orden total estable para que el desplazamiento infinito no repita ni omita tarjetas.
- **FR-031**: Cambiar búsqueda, fecha u orden MUST reiniciar la carga desde la primera página y MUST NOT perder la
  selección.

**Calidad transversal**

- **FR-032**: Toda la interfaz MUST estar en español, cumplir WCAG 2.2 AA en tema oscuro y claro, ser navegable con
  teclado con foco visible, respetar la preferencia de movimiento reducido y funcionar en 360 px sin desplazamiento
  horizontal con objetivos táctiles de al menos 44 px.
- **FR-033**: La acción **Generar imágenes** y la edición de transcripciones MUST estar limitadas por tasa para
  proteger el crédito del proveedor, informando con un mensaje accionable cuando se alcance el límite. Valores
  iniciales por persona: 60 imágenes por hora (cada reintento y cada **Generar de nuevo** cuenta) y 120 ediciones por hora.

### Key Entities *(include if feature involves data)*

- **Petición (tarjeta)**: una imagen enviada por un invitado dentro de un envío. Atributos visibles: imagen,
  transcripción (con su estado y si fue editada), nombre de quien envió, nota del envío, fecha de aprobación y fecha de envío. Pertenece
  a un envío (feature 003) en estado **aprobado**.
- **Transcripción**: texto leído de la imagen por la IA (feature 002); editable por el equipo; con estado (leyendo,
  lista, sin texto, fallida, no disponible), marca de **Editada** y fecha de edición; hasta 10 000 caracteres.
- **Selección**: conjunto de peticiones elegidas durante la visita a la página; vive solo en el navegador de la persona
  y no se guarda.
- **Plantilla**: imagen base única de «Peticiones de oración del día», con el espacio del cuerpo vacío (el área abierta bajo el título); la
  administra el equipo técnico y no se elige desde la página.
- **Grupo / Imagen de peticiones**: conjunto de hasta 4 peticiones en orden cronológico y la imagen resultante de
  rellenar con ellas la plantilla; existe solo en la bandeja de resultados hasta que se descarga o se cierra la página.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona del equipo pasa de abrir **Peticiones** a tener descargadas las imágenes de 8 peticiones
  (2 imágenes) en **menos de 5 minutos**, sin escribir texto en ninguna otra herramienta.
- **SC-002**: Al menos el **90 %** de las imágenes generadas en una revisión de 20 imágenes contiene **todo** el texto
  de sus peticiones sin palabras cambiadas, omitidas ni añadidas, con el diseño de la plantilla intacto.
- **SC-003**: En el **100 %** de las selecciones, ninguna imagen contiene más de 4 peticiones y ninguna petición queda
  partida entre dos imágenes; con N peticiones se generan exactamente ⌈N / 4⌉ imágenes.
- **SC-004**: Ninguna marca de ilegible llega a una imagen sin que la persona haya sido avisada y haya confirmado
  continuar (**0** imágenes con marca no advertida).
- **SC-005**: Con 200 peticiones en el sistema, la primera pantalla de tarjetas es utilizable en **menos de 2,5 s** en
  una conexión móvil 4G, y cargar la página siguiente al llegar al final tarda **menos de 2 s**.
- **SC-006**: Buscar, cambiar el filtro de fecha o el orden actualiza la rejilla en **menos de 1 s** para el 95 % de las
  consultas con 200 peticiones, sin perder la selección.
- **SC-007**: El **95 %** de las personas del equipo logra corregir una marca de ilegible y generar su imagen en el
  primer intento sin ayuda.
- **SC-008**: Una imagen que falla puede reintentarse sin repetir las demás en el **100 %** de los casos, y una falla
  nunca deja una imagen incompleta visible en la bandeja.
- **SC-009**: La página no tiene desplazamiento horizontal a 360 px ni a 1280 px, todos los controles son operables con
  teclado y cumple WCAG 2.2 AA en ambos temas.

## Assumptions

- **Usuarios**: administradores y editores con sesión (el mismo equipo de Solicitudes, Canciones y YouTube); los
  invitados no ven esta página.
- **Fuente de datos**: las imágenes y transcripciones de los envíos de invitados (features 002 y 003) ya existen y se
  reutilizan; esta feature no cambia cómo suben los invitados ni cómo se aprueban los envíos. Al aprobar un envío su
  transcripción pasa al archivo guardado en el drive: la página lista esos archivos aprobados y su texto es el del
  archivo, por lo que editarlo corrige el texto del archivo.
- **Servicio de imágenes**: el proveedor es OpenRouter, el único usado en el proyecto, con un modelo de generación de
  imágenes configurado como preajuste propio (que lleva el *system prompt* de esta función); es distinto del preajuste
  de lectura de texto de la feature 002. Sin credenciales o sin plantilla, la función responde «no disponible».
- **Plantilla**: una sola, entregada por el equipo de diseño con el espacio del cuerpo vacío bajo el título (hoy `server/assets/peticiones/plantilla.jpg`, paisaje de plastilina de 1376×768); elegir entre
  varias plantillas o subir una desde la página queda fuera de alcance.
- **Orden de las peticiones en la imagen**: cronológico ascendente de aprobación (la más antigua primero), el orden en
  que el equipo las fue aprobando; elegir otro orden dentro de la imagen queda fuera de alcance de v1.
- **Tope y umbrales**: 4 peticiones por imagen (pedido del usuario), 40 por generación y aviso de texto largo a los
  600 caracteres son valores iniciales; los dos últimos se ajustan al validar con la plantilla real.
- **Marca de ilegible**: la IA puede devolver `[ilegible]` o variantes; la detección es por patrón y no depende de un
  texto exacto.
- **Persistencia de las imágenes** *(enmendado 2026-11-12)*: ~~no se guardan~~ se guardan en el bucket y en tablas propias
  (no en el drive); el historial es global del equipo (como Canciones): cualquier editor ve y descarga, solo la autora o
  un administrador elimina; las colecciones guardan imágenes ya generadas (no generan) y son lo que se conserva más allá
  de 30 días. Sin portadas de colección, selección múltiple en el historial ni miniaturas (YAGNI). El nombre de descarga
  usa la fecha en UTC.
- **Tiempo**: el equipo usa la zona horaria de su navegador para «Hoy» y los rangos de fechas.
- **Costo**: cada imagen generada consume crédito del proveedor, por eso hay confirmación, tope por generación y
  límite de uso; reutilizar imágenes ya generadas (caché) queda fuera de alcance.
- **Dependencias**: feature 002 (lectura de texto), feature 003 (envíos de invitados y su aprobación en Solicitudes, que es el paso previo a esta página) y el mecanismo de
  avisos, mensajes centralizados, esqueletos y estados vacíos/error ya existentes en Cloudy.
