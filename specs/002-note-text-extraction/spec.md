# Feature Specification: Extracción del texto de notas e intenciones de oración

**Feature Branch**: `002-note-text-extraction`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Heres a new feature to implement, using the vercel ai sdk and openai as ai provider, i require to extract the content of uploaded images when staff team or public users uploads sticky notes or requests for praying as notes too. The defined llm for this task will be gpt-4o normal. I have already setup openai client, prompt and instructions. when starting implementing the task, i would like you to organize the ai related code cleanly and as the project style"

## Clarifications

### Session 2026-10-19

- Q: ¿Qué imágenes se procesan? → A: Toda imagen apta para lectura (ver la aclaración de formatos y tamaño), sin que quien sube tenga que marcarla como nota.
- Q: ¿Cuándo se pide la lectura del texto? → A: Las imágenes de invitados se leen al recibir el envío (el equipo ve el texto al revisar en Pendientes); las imágenes del equipo se leen la primera vez que alguien abre su vista previa. El resultado se guarda y se reutiliza en las siguientes aperturas.
- Q: ¿Qué forma tiene la respuesta del servicio de lectura? → A: Un resultado estructurado (si hay texto y cuál es), validado contra un esquema Zod; no se interpreta una cadena especial como "[texto no reconocido]".
- Q: ¿Qué pasa con HEIC (fotos de iPhone), que el servicio no lee directamente? → A: Se convierten a JPEG antes de leerlas; dónde se convierten se fija en la aclaración sobre la biblioteca de conversión.
- Q: ¿Se mantiene la búsqueda por texto extraído aunque las imágenes del equipo se lean al abrirse? → A: Sí; la búsqueda solo encuentra por su texto las imágenes ya leídas, y la interfaz lo indica.
- Directiva del usuario: dentro del flujo de extracción, la entrada (imagen, tipo, tamaño, archivo) y la salida del servicio se validan con esquemas Zod.
- Q: ¿Los formatos JPEG/JPG/PNG/HEIC y el máximo de 5 MB limitan solo la lectura del texto o también lo que Cloudy acepta al subir? → A: Solo la lectura del texto: se leen únicamente imágenes JPEG/JPG, PNG o HEIC de hasta 5 MB (tamaño del archivo original). Cloudy sigue aceptando al subir todos los formatos y hasta 100 MB, como define la feature 001; WEBP, GIF e imágenes de más de 5 MB quedan como "No disponible para este archivo".
- Directiva del usuario: la conversión HEIC usa la biblioteca `heic-to` (ya instalada) y no se agrega ninguna biblioteca de procesos en segundo plano o concurrentes (como `@vercel/functions`).
- Q: `heic-to` solo funciona en el navegador; ¿dónde se convierte una HEIC a JPEG para leer su texto? → A: Al subir: el navegador de quien sube (equipo o invitado) convierte la HEIC y sube una copia JPEG junto al original, como ya se hace con las miniaturas; la lectura usa esa copia. Las HEIC subidas antes de esta feature, sin copia, quedan como "No disponible para este archivo".
- Q: Sin una biblioteca de segundo plano, ¿cómo se leen las imágenes de invitados "al recibir el envío"? → A: Dentro de la misma petición de envío: el servidor lee hasta 4 imágenes a la vez antes de confirmar, con un tope total de unos 40 s; lo que quede sin leer o falle se lee cuando un revisor abre el envío en Pendientes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Texto extraído de las imágenes que sube el equipo (Priority: P1)

Un editor o administrador sube a Cloudy la foto de una nota adhesiva (por ejemplo, las notas que deja el
grupo de Skykids o una petición de oración escrita a mano). La primera vez que alguien del equipo abre la
vista previa de esa imagen, la app lee su texto y lo muestra debajo o al lado de la imagen; desde entonces
el texto queda guardado y aparece al instante. El equipo puede copiarlo y ve claramente si se está leyendo,
si no se reconoció texto o si falló.

**Why this priority**: es el núcleo de la feature. El equipo deja de transcribir notas a mano para usarlas
en presentaciones, listas de oración o anuncios; sin esta historia no hay valor.

**Independent Test**: un editor sube la foto de una nota adhesiva legible desde su teléfono, abre su vista
previa, ve "Leyendo texto…" y, en menos de 30 segundos, el texto de la nota sin el logotipo de Skykids, en
el orden original; lo copia con un botón. Al cerrar y volver a abrir la vista previa, el texto aparece al
instante.

**Acceptance Scenarios**:

1. **Given** una imagen del equipo cuyo texto aún no se ha leído, **When** un editor abre su vista previa,
   **Then** ve "Leyendo texto…" y, sin recargar la página, el texto transcrito tal como está escrito, con sus
   saltos de línea y nombres, sin el logotipo ni la palabra "Skykids" ni elementos decorativos.
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
   imágenes del equipo que nadie ha abierto todavía no aparecen por su texto, y la búsqueda lo indica.
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
- Envío de invitado con muchas imágenes o servicio lento: el invitado recibe su confirmación como máximo unos
  40 s después; las imágenes que no alcanzaron a leerse se leen cuando un revisor abre el envío.
- Imágenes WEBP o GIF, o de más de 5 MB: se suben y se ven con normalidad (la subida nunca falla por ello),
  no se leen y su sección de texto indica "No disponible para este archivo", sin botón de reintentar.
- Imagen de exactamente 5 MB: se lee; el límite incluye los 5 MB.
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
  de hasta 5 MB) subida por el equipo o recibida en envíos de invitados, sin que quien sube tenga que marcarla.
  Las demás imágenes (WEBP, GIF o de más de 5 MB) MUST quedar como "no disponible"; estos límites no cambian
  los formatos ni el tamaño que Cloudy acepta al subir.
- **FR-001b**: Una imagen del equipo MUST leerse la primera vez que un administrador o editor abre su vista
  previa; el texto se guarda y las aperturas siguientes lo muestran sin volver a leer la imagen. Las imágenes
  subidas antes de esta feature siguen la misma regla, salvo las HEIC, que no tienen copia JPEG (FR-023).
- **FR-023**: Al subir una imagen HEIC apta (equipo o invitado), el navegador MUST generar una copia JPEG de hasta
  5 MB y subirla junto al original; la lectura usa esa copia. Una HEIC sin copia MUST quedar como "no
  disponible", y un fallo de la conversión MUST NOT impedir la subida del original.
- **FR-002**: La transcripción MUST respetar el texto tal como está escrito (orden, saltos de línea, nombres e
  idioma original), sin interpretar, corregir, resumir, traducir ni añadir nada, y MUST omitir el logotipo y la
  palabra "Skykids" y los elementos decorativos.
- **FR-003**: Cuando el resultado estructurado indique que no hay texto legible, el sistema MUST registrarlo
  como "sin texto reconocido" y no mostrar texto inventado.
- **FR-004**: La lectura MUST NOT hacer fallar la subida, la apertura de la vista previa, el envío de un
  invitado, la aprobación o el rechazo, ni retrasar la subida del equipo, la aprobación o el rechazo. La vista
  previa muestra "Leyendo texto…" de inmediato. El envío de un invitado espera a sus lecturas como máximo unos
  40 s (FR-009).
- **FR-005**: Cada imagen MUST tener un estado de extracción visible: pendiente (aún no leída), leyendo,
  listo, sin texto, error o no disponible; un fallo MUST indicar qué puede hacer el usuario a continuación.
- **FR-006**: Administradores y editores MUST poder reintentar una extracción en error y volver a leer
  cualquier imagen apta para lectura; volver a leer un texto corregido a mano MUST pedir confirmación.
- **FR-007**: Una extracción MUST tener un tiempo máximo; superado, pasa a "error" con opción de reintentar.
- **FR-008**: El sistema MUST limitar las extracciones por remitente invitado y por ventana de tiempo, igual que
  ya limita los envíos, para evitar abusos que generen costos.
- **FR-021**: Antes de leer una imagen, el sistema MUST validar contra un esquema definido que la entrada es
  válida (archivo existente al que el usuario tiene acceso, tipo JPEG/JPG, PNG o HEIC según su contenido real y
  tamaño original de hasta 5 MB); una entrada inválida no se envía al servicio: un formato o tamaño no apto queda
  como "no disponible" y cualquier otro fallo de validación como "error".
- **FR-022**: El servicio de lectura MUST devolver un resultado estructurado (si hay texto y el texto) que el
  sistema valida contra un esquema definido antes de guardarlo; un resultado que no cumpla el esquema se
  registra como "error" y nunca se muestra.

**Envíos de invitados**

- **FR-009**: Las imágenes aptas de un envío de invitado MUST leerse al confirmar el envío, dentro de la misma
  petición, con hasta 4 lecturas a la vez y un tope total de unos 40 s, para que el equipo vea su texto al revisarlo
  en Pendientes. Las que no alcancen a leerse o fallen MUST leerse cuando un revisor abra el envío.
- **FR-010**: Al aprobar un envío, el texto extraído MUST acompañar al archivo sin volver a procesarlo; al
  rechazarse o caducar, el texto MUST eliminarse definitivamente junto con los archivos.
- **FR-011**: La página pública MUST informar brevemente a los invitados que el texto de sus imágenes se lee de
  forma automática.

**Consulta, corrección y búsqueda**

- **FR-012**: La vista previa de una imagen y la revisión de un envío pendiente MUST mostrar el texto extraído y
  su estado, actualizándose sin recargar la página cuando termine la lectura.
- **FR-013**: Los usuarios del equipo MUST poder copiar el texto extraído con una sola acción y recibir
  confirmación.
- **FR-014**: Administradores y editores MUST poder editar el texto extraído (hasta 10,000 caracteres); el
  sistema MUST registrar que fue editado, quién y cuándo.
- **FR-015**: La búsqueda del disco MUST encontrar imágenes por palabras de su texto ya extraído, excluyendo lo
  que está en la papelera y lo pendiente de aprobación, e indicar que solo se buscan por su texto las imágenes
  ya leídas.

**Privacidad, permisos y consistencia**

- **FR-016**: El texto extraído MUST tener exactamente los mismos permisos que su archivo: solo administradores y
  editores lo ven; los invitados nunca ven texto extraído, ni el suyo después de enviar.
- **FR-017**: El texto extraído MUST seguir el ciclo de vida de su archivo: se conserva en la papelera, se
  restaura con él y se elimina definitivamente con él.
- **FR-018**: El sistema MUST registrar en el registro de actividad las ediciones manuales del texto extraído.
- **FR-019**: El sistema MUST NOT guardar ni enviar al servicio de lectura más datos del invitado que la imagen
  misma (ni nombre, ni nota, ni IP).
- **FR-020**: Toda la interfaz nueva MUST estar en español, funcionar desde 360 px en ambos temas, usarse con
  teclado y cubrir los estados de carga, vacío, error con reintento y contenido.

### Key Entities *(include if feature involves data)*

- **Texto extraído**: transcripción del texto de una imagen. Pertenece a un único archivo (aprobado o de un envío
  de invitado pendiente). Se crea al recibir un envío de invitado o la primera vez que se abre una imagen del
  equipo. Contiene el texto, el estado (pendiente, leyendo, listo, sin texto, error, no disponible), número de
  intentos, fecha de la última lectura, motivo del último error y, si se corrigió a mano, quién y cuándo.
- **Archivo** (existente): gana una relación opcional con su texto extraído; solo las imágenes la tienen. Las
  imágenes HEIC subidas con esta feature guardan además la referencia a su copia JPEG, que se elimina junto con el
  archivo.
- **Envío de invitado** (existente): sus imágenes tienen texto extraído desde que se recibe el envío, que pasa al
  archivo al aprobarse o se elimina al rechazarse o caducar.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 90 % de las imágenes aptas para lectura muestran su texto en menos de 30 segundos desde que se abre por primera vez
  su vista previa (equipo) o desde que llega el envío (invitados).
- **SC-002**: En un conjunto de prueba de 20 fotos de notas adhesivas y peticiones de oración legibles, al menos
  el 95 % de las palabras se transcriben correctamente y ninguna incluye el logotipo o la palabra "Skykids".
- **SC-003**: El 100 % de las imágenes sin texto se marcan como "sin texto reconocido", sin texto inventado.
- **SC-004**: Ninguna subida, apertura de vista previa, envío de invitado ni aprobación falla por causa de la
  extracción, incluso con el servicio de lectura caído; las subidas del equipo y las aprobaciones no tardan más, y
  la confirmación de un envío de invitado tarda como máximo 40 s más.
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
- Solo se procesan imágenes JPEG/JPG, PNG y HEIC de hasta 5 MB; las fotos de notas desde el celular suelen
  estar dentro de ese tamaño. Las notas en texto (TXT, MD, DOCX) y los PDF no entran en esta feature.
- El texto extraído no se envía a los invitados ni se publica fuera de Cloudy.
- Leer las imágenes del equipo solo al abrirlas limita el costo a las imágenes que alguien realmente consulta;
  el volumen esperado es de unos cientos de imágenes al mes, y el límite de FR-008 acota el de invitados.
- Las imágenes ya subidas antes de esta feature se leen cuando alguien las abre (FR-001b), excepto las HEIC, que
  quedan como "no disponible" por no tener copia JPEG.
- La espera adicional de hasta 40 s al enviar sigue dentro del objetivo de la feature 001 de que un invitado
  complete su envío desde el teléfono en menos de 1 minuto para envíos típicos (1–3 fotos).
- La lectura debe funcionar en el entorno sin estado de la plataforma de despliegue; el "sin recargar" de
  FR-012 usa el mismo mecanismo de actualización periódica que ya usa Pendientes.
