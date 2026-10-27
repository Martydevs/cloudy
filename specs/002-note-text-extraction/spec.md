# Feature Specification: Extracción del texto de notas e intenciones de oración

**Feature Branch**: `002-note-text-extraction`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Heres a new feature to implement, using the vercel ai sdk and openai as ai provider, i require to extract the content of uploaded images when staff team or public users uploads sticky notes or requests for praying as notes too. The defined llm for this task will be gpt-4o normal. I have already setup openai client, prompt and instructions. when starting implementing the task, i would like you to organize the ai related code cleanly and as the project style"

## Clarifications

### Session 2026-10-19

- Q: ¿Qué imágenes se procesan? → A: Toda imagen apta para lectura (ver la aclaración de formatos y tamaño), sin que quien sube tenga que marcarla como nota.
- Q: ¿Cuándo se pide la lectura del texto? → A: Las imágenes de invitados se leen al recibir el envío (el equipo ve el texto al revisar en Pendientes); las imágenes del equipo se leen la primera vez que alguien abre su vista previa. El resultado se guarda y se reutiliza en las siguientes aperturas. *(Reemplazada en la revisión de arquitectura.)*
- Q: ¿Qué forma tiene la respuesta del servicio de lectura? → A: Un resultado estructurado (si hay texto y cuál es), validado contra un esquema Zod; no se interpreta una cadena especial como "[texto no reconocido]".
- Q: ¿Qué pasa con HEIC (fotos de iPhone), que el servicio no lee directamente? → A: Se convierten a JPEG antes de leerlas; dónde se convierten se fija en la aclaración sobre la biblioteca de conversión.
- Q: ¿Se mantiene la búsqueda por texto extraído aunque las imágenes del equipo se lean al abrirse? → A: Sí; la búsqueda solo encuentra por su texto las imágenes ya leídas, y la interfaz lo indica.
- Directiva del usuario: dentro del flujo de extracción, la entrada (imagen, tipo, tamaño, archivo) y la salida del servicio se validan con esquemas Zod.
- Q: ¿Los formatos JPEG/JPG/PNG/HEIC y el máximo de 5 MB limitan solo la lectura del texto o también lo que Cloudy
  acepta al subir? → A: Solo la lectura del texto: se leen únicamente imágenes JPEG/JPG, PNG o HEIC de hasta 5 MB
  (5 242 880 bytes), el tamaño del archivo original. Cloudy sigue aceptando al subir todos los formatos y hasta
  100 MB, como define la feature 001; WEBP, GIF e imágenes de más de 5 242 880 bytes quedan como "No disponible
  para este archivo".
- Directiva del usuario: la conversión HEIC usa la biblioteca `heic-to` (ya instalada) y no se agrega ninguna biblioteca de procesos en segundo plano o concurrentes (como `@vercel/functions`). *(Reemplazada en la revisión de arquitectura.)*
- Q: `heic-to` solo funciona en el navegador; ¿dónde se convierte una HEIC a JPEG para leer su texto? → A: Al subir: el navegador de quien sube (equipo o invitado) convierte la HEIC y sube una copia JPEG junto al original, como ya se hace con las miniaturas; la lectura usa esa copia. Las HEIC subidas antes de esta feature, sin copia, quedan como "No disponible para este archivo".
- Q: Sin una biblioteca de segundo plano, ¿cómo se leen las imágenes de invitados "al recibir el envío"? → A: Dentro de la misma petición de envío: el servidor lee hasta 4 imágenes a la vez antes de confirmar, con un tope total de unos 40 s; lo que quede sin leer o falle se lee cuando un revisor abre el envío en Pendientes. *(Reemplazada en la revisión de arquitectura.)*

### Session 2026-10-19 (revisión de arquitectura)

- Decisión del usuario: la lectura ocurre **en segundo plano** con `waitUntil` de `@vercel/functions`, que se
  agrega como dependencia y se usa solo a través de un módulo propio (`server/utils/background.ts`). Queda sin
  efecto la directiva anterior de no agregar bibliotecas de segundo plano.
- Q: ¿Cuándo se leen las imágenes del equipo? → A: **Al terminar de subirse**, en segundo plano, sin retrasar la
  respuesta de la subida. Al abrir la vista previa el texto ya está, o se ve "Leyendo texto…" hasta que termine.
  Si una imagen quedó sin leer (subida antes de esta feature o lectura que nunca empezó), se lee al abrirla.
- Q: ¿La confirmación del invitado espera a las lecturas? → A: No. El envío se confirma igual de rápido que
  antes y las lecturas corren en segundo plano (hasta 4 a la vez); lo que no se lea se lee cuando un revisor
  abre el envío en Pendientes.
- Q: ¿Se mantiene la conversión HEIC en el navegador? → A: Sí, con `heic-to`, que solo funciona en el navegador.
  El servidor no procesa imágenes: envía al servicio de lectura los bytes tal como están guardados (el original
  JPEG/PNG o la copia JPEG de una HEIC).

### Session 2026-10-24 (cierre del análisis)

- Decisión (2026-10-26): el aviso informativo de FR-011 basta para la privacidad de invitados; no se enmienda la
  constitución ni se pide consentimiento explícito en `/enviar`.
- Decisión: la lectura usa un servicio principal y, si no responde, un servicio de respaldo; quien sube no elige y el
  texto no indica cuál de los dos lo leyó. Sin respaldo configurado, o si ambos fallan, la imagen queda en error con
  Reintentar. A los servicios de lectura solo se envían los bytes de la imagen (FR-019).
- Aclaración: "5 MB" significa 5 242 880 bytes, también en el caso límite de una imagen de exactamente ese tamaño.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Texto extraído de las imágenes que sube el equipo (Priority: P1)

Un editor o administrador sube a Cloudy la foto de una nota adhesiva (por ejemplo, las notas que deja el
grupo de Skykids o una petición de oración escrita a mano). En cuanto termina de subirse, la app lee su texto
en segundo plano y lo guarda; al abrir la vista previa, el texto aparece debajo o al lado de la imagen (o
"Leyendo texto…" durante unos segundos si la lectura aún no terminó). El equipo puede copiarlo y ve claramente
si se está leyendo, si no se reconoció texto o si falló.

**Why this priority**: es el núcleo de la feature. El equipo deja de transcribir notas a mano para usarlas
en presentaciones, listas de oración o anuncios; sin esta historia no hay valor.

**Independent Test**: un editor sube la foto de una nota adhesiva legible desde su teléfono; la subida termina
igual de rápido que siempre. Abre su vista previa y ve el texto de la nota sin el logotipo de Skykids, en el
orden original (o "Leyendo texto…" y el texto en menos de 30 segundos desde que terminó la subida); lo copia
con un botón. Al cerrar y volver a abrir la vista previa, el texto aparece al instante.

**Acceptance Scenarios**:

1. **Given** una imagen apta que un editor acaba de subir, **When** termina la subida, **Then** la app lee su
   texto sin que el editor espere; al abrir la vista previa ve el texto transcrito tal como está escrito, con
   sus saltos de línea y nombres, sin el logotipo ni la palabra "Skykids" ni elementos decorativos, o
   "Leyendo texto…" que se reemplaza por el texto sin recargar la página.
2. **Given** una imagen cuyo texto ya se leyó, **When** cualquier miembro del equipo abre su vista previa,
   **Then** el texto guardado aparece al instante, sin volver a leer la imagen.
3. **Given** una imagen sin texto legible (por ejemplo, una foto del templo), **When** termina la lectura,
   **Then** la vista previa indica "No se reconoció texto" en lugar de mostrar texto inventado.
4. **Given** que el servicio de lectura falla, no responde o devuelve un resultado inválido, **When** el
   editor tiene abierta la vista previa, **Then** ve un mensaje claro de que no se pudo leer el texto y un
   botón "Reintentar"; el archivo sigue disponible con normalidad.
5. **Given** un texto ya extraído, **When** el editor pulsa "Copiar texto", **Then** el texto queda en el
   portapapeles y ve una confirmación breve.

---

### User Story 2 - Texto extraído de los envíos de invitados (Priority: P2)

Un invitado, desde la página pública, envía la foto de su petición de oración o de una nota. En cuanto llega
el envío, la app lee el texto de cada imagen; al revisar el envío en Pendientes, el administrador o editor ve
ese texto junto a cada miniatura, lo que le permite decidir rápido si aprueba o rechaza. Si lo aprueba, el
texto pasa con el archivo al disco compartido.

**Why this priority**: muchas peticiones de oración llegan por la página pública; leerlas en la cola agiliza
la revisión del domingo. Depende de la misma capacidad de lectura de la historia 1.

**Independent Test**: un invitado sin cuenta envía desde su teléfono la foto de una petición de oración; un
editor abre el envío en Pendientes, lee el texto transcrito, lo aprueba en una carpeta y el texto aparece en
la vista previa del archivo aprobado.

**Acceptance Scenarios**:

1. **Given** un envío de invitado con imágenes, **When** un editor lo abre en Pendientes, **Then** ve el
   texto extraído (o su estado: leyendo, sin texto, error, no disponible) de cada imagen.
2. **Given** un envío aprobado, **When** se abre la vista previa del archivo en su carpeta, **Then** muestra
   el mismo texto extraído sin volver a procesar la imagen.
3. **Given** un envío rechazado o caducado, **When** se eliminan sus archivos, **Then** también se elimina
   definitivamente el texto extraído de sus imágenes.
4. **Given** la página pública de invitados, **When** un invitado va a enviar imágenes, **Then** se le informa
   de forma breve que el texto de sus imágenes se leerá automáticamente para que el equipo lo revise.

---

### User Story 3 - Corregir y buscar por el texto extraído (Priority: P3)

La lectura automática puede equivocarse con letra difícil. Un editor o administrador puede corregir el texto
extraído de un archivo y volver a pedir la lectura. Además, la búsqueda del disco encuentra imágenes por las
palabras de su texto ya leído (por ejemplo, el nombre de la persona por la que se pide oración).

**Why this priority**: mejora la calidad y la utilidad del texto, pero la historia 1 ya entrega valor sin ella.

**Independent Test**: un editor corrige una palabra mal leída en el texto de una nota, guarda, y al buscar esa
palabra en la búsqueda global encuentra la imagen.

**Acceptance Scenarios**:

1. **Given** un texto extraído, **When** un editor lo edita y guarda, **Then** se conserva su versión, se
   indica que fue "editado" y quién lo editó, y se muestra una confirmación.
2. **Given** un texto editado manualmente, **When** un editor pulsa "Volver a leer", **Then** se le pide
   confirmación porque se reemplazará su corrección.
3. **Given** imágenes con texto ya leído, **When** un usuario busca una palabra que aparece en el texto,
   **Then** los resultados incluyen esas imágenes e indican que la coincidencia está en su texto; las
   imágenes cuyo texto aún no se ha leído (se están leyendo, no son aptas o se subieron antes de esta feature
   y nadie las ha abierto) no aparecen por su texto, y la búsqueda lo indica.
4. **Given** una imagen en la papelera, **When** se busca una palabra de su texto, **Then** no aparece en los
   resultados.

---

### Edge Cases

- Imagen sin texto, con texto ilegible o ambiguo: se marca "No se reconoció texto"; nunca se inventa contenido.
- Varias notas en una misma foto: se transcriben en su orden, separadas por una línea en blanco.
- Texto en otro idioma (por ejemplo, inglés): se transcribe en su idioma original, sin traducir.
- Fotos HEIC de iPhone: al subirlas, el navegador genera una copia JPEG que es la que se lee. Si la conversión
  falla en el navegador, o la HEIC se subió antes de esta feature y no tiene copia, la subida se completa igual y
  la imagen queda como "No disponible para este archivo".
- Envío de invitado con muchas imágenes o servicio lento: el invitado recibe su confirmación de inmediato; las
  lecturas siguen en segundo plano y las imágenes que no alcanzaron a leerse se leen cuando un revisor abre el
  envío; las que fallaron muestran "Reintentar".
- La plataforma detiene una lectura en segundo plano (por ejemplo, al agotar el tiempo máximo de la función):
  pasados 90 s la imagen se muestra como error con el botón "Reintentar", igual que una lectura vencida.
- Imágenes WEBP o GIF, o de más de 5 MB (5 242 880 bytes): se suben y se ven con normalidad (la subida nunca
  falla por ello), no se leen y su sección de texto indica "No disponible para este archivo", sin botón de reintentar.
- Imagen de exactamente 5 MB (5 242 880 bytes): se lee; el límite incluye ese tamaño.
- Dos personas abren a la vez una imagen aún no leída: se hace una sola lectura y ambas ven el mismo resultado.
- El servicio de lectura está caído, lento, sin saldo o devuelve un resultado que no cumple el formato
  esperado: la subida, la vista previa y la aprobación funcionan igual; el texto queda en "error" con opción de
  reintentar y nunca se muestra un resultado inválido.
- Se mueve, renombra o envía a la papelera la imagen mientras se lee: el texto queda asociado al mismo
  archivo; si el archivo se elimina definitivamente, el texto se elimina con él.
- Se restaura una imagen de la papelera: recupera su texto sin volver a procesarla.
- Un mismo archivo se sube dos veces: cada archivo tiene su propio texto.
- Lectura que tarda demasiado: tras un tiempo máximo se marca como error en lugar de quedar "leyendo" para
  siempre.
- Archivos que no son imágenes (audio, video, presentaciones, documentos): no se procesan y no muestran
  sección de texto.

## Requirements *(mandatory)*

### Functional Requirements

**Lectura del texto**

- **FR-001**: El sistema MUST extraer el texto legible de toda imagen apta para lectura (JPEG/JPG, PNG o HEIC
  de hasta 5 MB, es decir, 5 242 880 bytes) subida por el equipo o recibida en envíos de invitados, sin que quien
  sube tenga que marcarla. Las demás imágenes (WEBP, GIF o de más de 5 242 880 bytes) MUST quedar como "no
  disponible"; estos límites no cambian los formatos ni el tamaño que Cloudy acepta al subir.
- **FR-001b**: Una imagen del equipo MUST leerse en segundo plano en cuanto termina de subirse, sin retrasar la
  subida; el texto se guarda y cada apertura de la vista previa lo muestra sin volver a leer la imagen. Si al
  abrir la vista previa la imagen sigue sin leer (subida antes de esta feature o lectura que nunca empezó), MUST
  leerse en ese momento; las HEIC antiguas sin copia JPEG quedan como "no disponible" (FR-023).
- **FR-023**: Al subir una imagen HEIC apta (equipo o invitado), el navegador MUST generar una copia JPEG de
  hasta 5 MB (5 242 880 bytes) y subirla junto al original; la lectura usa esa copia. Una HEIC sin copia MUST
  quedar como "no disponible", y un fallo de la conversión MUST NOT impedir la subida del original.
- **FR-002**: La transcripción MUST respetar el texto tal como está escrito (orden, saltos de línea, nombres e
  idioma original), sin interpretar, corregir, resumir, traducir ni añadir nada, y MUST omitir el logotipo y la
  palabra "Skykids" y los elementos decorativos.
- **FR-003**: Cuando el resultado estructurado indique que no hay texto legible, el sistema MUST registrarlo
  como "sin texto reconocido" y no mostrar texto inventado.
- **FR-004**: La lectura MUST NOT hacer fallar la subida, la apertura de la vista previa, el envío de un
  invitado, la aprobación o el rechazo, y ningún flujo MUST esperar a la lectura: ni la subida del equipo, ni la
  confirmación del envío de un invitado, ni la aprobación o el rechazo. La vista previa muestra "Leyendo
  texto…" de inmediato mientras una lectura sigue en curso.
- **FR-005**: Cada imagen MUST tener un estado de extracción visible: pendiente (aún no leída), leyendo,
  listo, sin texto, error o no disponible; un fallo MUST indicar qué puede hacer el usuario a continuación.
- **FR-006**: Administradores y editores MUST poder reintentar una extracción en error y volver a leer
  cualquier imagen apta para lectura; volver a leer un texto corregido a mano MUST pedir confirmación. Si la
  entrada no pasa la validación (FR-021), MUST explicarse el motivo y, cuando volver a subirla en JPG o PNG lo
  resuelva, MUST indicarlo; en ningún caso se ofrece reintento.
- **FR-007**: Una extracción MUST tener un tiempo máximo de 45 s por lectura (sumados todos los intentos); una
  lectura que sigue en "leyendo" pasados 90 s (por ejemplo, una tarea de segundo plano que la plataforma detuvo)
  MUST mostrarse como "error" con opción de reintentar. El presupuesto compartido de las lecturas de un envío de
  invitado no alarga este tope: cada lectura se reclama justo antes de empezar y dura como máximo 45 s.
- **FR-008**: El sistema MUST limitar las extracciones por remitente invitado y por ventana de tiempo, igual que
  ya limita los envíos (20 lecturas por remitente y hora), para evitar abusos que generen costos. El límite aplica a las lecturas automáticas del
  envío; las que un revisor del equipo pide en Pendientes (abrir el envío o Reintentar) quedan fuera del límite.
- **FR-021**: Antes de leer una imagen, el sistema MUST validar contra un esquema definido que la entrada es
  válida (archivo existente al que el usuario tiene acceso, tipo JPEG/JPG, PNG o HEIC según su contenido real y
  tamaño original de hasta 5 MB, es decir, 5 242 880 bytes); una entrada inválida no se envía al servicio: un
  formato o tamaño no apto (incluido un archivo cuyo contenido real no coincide con su extensión) queda como
  "no disponible" y cualquier otro fallo de validación como "error", con un mensaje que indica qué hacer (por
  ejemplo, volver a subirla en JPG o PNG).
- **FR-022**: Los servicios de lectura MUST devolver un resultado estructurado (si hay texto y el texto) que el
  sistema valida contra un esquema definido antes de guardarlo; un resultado que no cumpla el esquema se
  registra como "error" y nunca se muestra.

**Envíos de invitados**

- **FR-009**: Las imágenes aptas de un envío de invitado MUST leerse en segundo plano en cuanto se recibe el
  envío, con hasta 4 lecturas a la vez y sin retrasar la confirmación al invitado, para que el equipo vea su texto
  al revisarlo en Pendientes. Las que no alcancen a leerse (pendientes) MUST leerse cuando un revisor abra el
  envío; las que fallen MUST mostrar su error con la opción de reintentar (FR-006), sin reintentarse solas.
- **FR-010**: Al aprobar un envío, el texto extraído MUST acompañar al archivo sin volver a procesarlo; al
  rechazarse o caducar, el texto MUST eliminarse definitivamente junto con los archivos.
- **FR-011**: La página pública MUST informar brevemente a los invitados que el texto de sus imágenes se lee de
  forma automática, que para ello se procesan con servicios externos de inteligencia artificial solo para
  transcribir su texto (sin enviarles su nombre, su nota ni su IP) y que el texto lo ve únicamente el equipo.

**Consulta, corrección y búsqueda**

- **FR-012**: La vista previa de una imagen y la revisión de un envío pendiente MUST mostrar el texto extraído y
  su estado, actualizándose sin recargar la página cuando termine la lectura.
- **FR-013**: Los usuarios del equipo MUST poder copiar el texto extraído con una sola acción y recibir
  confirmación.
- **FR-014**: Administradores y editores MUST poder editar el texto extraído de un archivo del disco (hasta
  10,000 caracteres); el sistema MUST registrar que fue editado, quién y cuándo. En Pendientes el texto solo se
  lee y se reintenta; se edita después de aprobar el envío.
- **FR-015**: La búsqueda del disco MUST encontrar imágenes por palabras de su texto ya extraído (incluidas las
  recién subidas en cuanto termina su lectura en segundo plano), excluyendo lo que está en la papelera y lo
  pendiente de aprobación, e indicar que solo se buscan por su texto las imágenes cuyo texto ya se leyó (no las
  que se están leyendo, las no aptas ni las subidas antes de esta feature que nadie ha abierto).

**Privacidad, permisos y consistencia**

- **FR-016**: El texto extraído MUST tener exactamente los mismos permisos que su archivo: solo administradores y
  editores lo ven; los invitados nunca ven texto extraído, ni el suyo después de enviar.
- **FR-017**: El texto extraído MUST seguir el ciclo de vida de su archivo: se conserva en la papelera, se
  restaura con él y se elimina definitivamente con él.
- **FR-018**: El sistema MUST registrar en el registro de actividad las ediciones manuales del texto extraído.
- **FR-019**: El sistema MUST NOT guardar ni enviar a los servicios de lectura más datos del invitado que la imagen
  misma (ni nombre, ni nota, ni IP).
- **FR-020**: Toda la interfaz nueva MUST estar en español, funcionar desde 360 px en ambos temas, usarse con
  teclado y cubrir los estados de carga, vacío, error con reintento y contenido.

### Key Entities *(include if feature involves data)*

- **Texto extraído**: transcripción del texto de una imagen. Pertenece a un único archivo (aprobado o de un envío
  de invitado pendiente). Se crea al terminar la subida de una imagen del equipo o al recibir un envío de
  invitado (y, como respaldo, al abrir una imagen que quedó sin leer). Contiene el texto, el estado (pendiente, leyendo, listo, sin texto, error, no disponible), número de
  intentos, fecha de la última lectura, motivo del último error y, si se corrigió a mano, quién y cuándo.
- **Archivo** (existente): gana una relación opcional con su texto extraído; solo las imágenes la tienen. Las
  imágenes HEIC subidas con esta feature guardan además la referencia a su copia JPEG, que se elimina junto con el
  archivo.
- **Envío de invitado** (existente): sus imágenes tienen texto extraído desde que se recibe el envío, que pasa al
  archivo al aprobarse o se elimina al rechazarse o caducar.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con el servicio de lectura respondiendo con normalidad, el 90 % de las imágenes aptas para lectura
  tienen su texto listo en menos de 30 segundos desde que termina su subida (equipo) o desde que llega el envío
  (invitados). En un envío con más imágenes que el turno de lectura simultánea (4), las que esperan turno pueden
  tardar más; el resto se lee al abrir el envío (FR-009). El objetivo de 30 s aplica a envíos de hasta 4 imágenes
  aptas; para 8 imágenes se registra el tiempo medido (T075) sin umbral fijo.
- **SC-002**: En un conjunto de prueba de 20 fotos de notas adhesivas y peticiones de oración legibles, al menos
  el 95 % de las palabras se transcriben correctamente y ninguna incluye el logotipo o la palabra "Skykids".
- **SC-003**: El 100 % de las imágenes sin texto se marcan como "sin texto reconocido", sin texto inventado.
- **SC-004**: Ninguna subida, apertura de vista previa, envío de invitado ni aprobación falla por causa de la
  extracción, incluso con el servicio de lectura caído; ningún flujo tarda más por la lectura: ni las subidas
  del equipo (en las HEIC, la copia JPEG se prepara en paralelo con la subida del original), ni la
  confirmación de un envío de invitado, ni las aprobaciones.
- **SC-005**: Un editor transcribe una petición de oración a una lista o presentación en menos de 15 segundos
  (abrir vista previa y copiar), frente a varios minutos a mano.
- **SC-006**: Buscar una palabra presente en el texto de una imagen ya leída la devuelve en los resultados en
  menos de 2 segundos con 5,000 archivos.
- **SC-007**: El 0 % de los resultados del servicio que no cumplen el formato esperado llegan a mostrarse al
  equipo.

## Assumptions

- La feature extiende Cloudy (`001-shared-media-drive`): reutiliza la subida, la vista previa, la cola de
  Pendientes, la papelera, la búsqueda, el registro de actividad y los roles existentes.
- El proveedor y el modelo de lectura de imágenes ya están decididos por el equipo, y ya existen la
  configuración del cliente, las instrucciones y el mensaje de extracción; el plan los detallará e integrará,
  ajustando las instrucciones al resultado estructurado.
- Solo se procesan imágenes JPEG/JPG, PNG y HEIC de hasta 5 MB (5 242 880 bytes); las fotos de notas desde el
  celular suelen estar dentro de ese tamaño. Las notas en texto (TXT, MD, DOCX) y los PDF no entran en esta
  feature.
- El texto extraído no se envía a los invitados ni se publica fuera de Cloudy.
- El texto extraído de una imagen de invitado es contenido del archivo que la persona ya envió, no un dato personal
  nuevo del invitado; se guarda con el archivo y se elimina con él al rechazarse o caducar (FR-010).
- Toda imagen apta que sube el equipo se lee, no solo las que alguien consulta: el volumen esperado es de unos
  cientos de imágenes al mes, un costo asumible a cambio de tener el texto listo al abrir y de poder buscar por
  él desde el principio; el límite de FR-008 acota el costo de los invitados.
- Las imágenes ya subidas antes de esta feature se leen cuando alguien las abre (FR-001b), excepto las HEIC, que
  quedan como "no disponible" por no tener copia JPEG.
- La confirmación del envío de un invitado no cambia de duración, así que el objetivo de la feature 001 (envío
  desde el teléfono en menos de 1 minuto) se mantiene sin ajustes.
- La lectura debe funcionar en el entorno sin estado de la plataforma de despliegue; el "sin recargar" de
  FR-012 usa consultas periódicas del cliente (cada 3 s mientras una lectura está en curso), el mismo tipo de
  mecanismo que ya usa Pendientes.
