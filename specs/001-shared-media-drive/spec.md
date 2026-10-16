# Feature Specification: Cloudy — Disco multimedia compartido del equipo de producción

**Feature Branch**: `001-shared-media-drive`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Sobre esta base existente de codigo en nuxt y vue, necesito que desarolles una aplicacion para mi equipo de multimedia y audio dentro de mi iglesia en la que asisto. la necesidad prioritaria que necesito que supla es una tipo de nube o disco centralizado y compartido en donde miembros de equipo y personas puedan subir imagenes, fotos, presentaciones, audios, notas, basicamente archivos multimedia. necesito que tenga tres roles, administrador, editor e invitado. los administradores tienen el poder de administrar los contenidos que se suben, ademas de los usuarios que se registran, editores, no tienen poder de los usuarios pero si del contenido multimedia y por supuesto, ademas del administrador, entrar a la aplicacion, los invitados, solo podran subir contenido que tendra que ser bajo permiso en tiempo real a traves de una pagina publica de la aplicacion con los formatos admitidos. dado a lo anterior, que incluya autenticacion y autorizacion por roles, el principal metodo sera por correo y contraseña. la prioridad sobre esta aplicacion es que tambien sea responsiva a cualquier formato de pantalla, rapida, eficiente y amigable. para la base de datos se contectara a una base de datos postgresql con neondb como servicio de nube y las consultas se trabajaran con drizzle orm. se requeriran tests unitarios y e2e. para el diseño, tema, fuentes e iconos, ya esta instalado por la biblioteca de nuxt, revisa el package.json." — Actualización: "el aspecto que tiene que mostrarse la aplicacion sera como una aplicacion tipo dashboard con barra lateral, proteccion de rutas, responsiva, con paginas de autenticacion, etcetera".

## Clarifications

### Session 2026-10-14

- Q: ¿Qué significa "subir contenido bajo permiso en tiempo real" para los invitados? → A: Cola de aprobación: lo que sube un invitado queda pendiente; administradores y editores reciben aviso en vivo y aprueban o rechazan cada envío. Solo lo aprobado entra al disco compartido.
- Q: ¿Los invitados necesitan cuenta? → A: No. Suben de forma anónima desde la página pública indicando su nombre (y opcionalmente una nota).
- Q: ¿Cómo se incorporan los miembros del equipo? → A: Registro libre con correo y contraseña; la cuenta queda pendiente hasta que un administrador la active y le asigne rol.
- Q: ¿Tamaño máximo por archivo? → A: 100 MB.
- Q: ¿Cómo debe verse la aplicación? → A: Tipo dashboard con barra lateral, protección de rutas, responsiva y con páginas de autenticación propias.
- Q: ¿Comentarios y papelera entran en la primera versión? → A: Sí, ambos forman parte de la versión 1.
- Q: ¿Cuánto tiempo puede permanecer pendiente un envío de invitado? → A: 7 días; después caduca y sus archivos se eliminan.
- Q: ¿Quién provee archivos, autenticación y correos? → A: Todo lo provee el mismo proveedor de la base de datos en la nube: almacenamiento de objetos para archivos y su servicio de autenticación para registro, inicio de sesión, sesiones, recuperación de contraseña y envío de correos.
- Q: ¿Cuál es la identidad del proyecto? → A: La aplicación se llama **Cloudy**. Su color representativo es el naranja, usando la paleta ya definida por el equipo (naranja principal, cian y verde lima de apoyo, fondos neutros oscuros y esquinas redondeadas). El tema por defecto es oscuro, con una tipografía sans serif amigable, moderna y redondeada.
- Q: ¿Qué tipografía y opciones de apariencia? → A: Tipografía DM Sans. Existe un tema claro derivado del oscuro y un control para cambiar entre ambos, con buena accesibilidad y claridad en los dos temas. No habrá temas de alto contraste.

### Session 2026-10-15

- Q: ¿La barra superior necesita un botón de subida rápida? → A: No. Casi todas las páginas del área privada ya son la sección de subida: Inicio tiene el acceso rápido "Subir archivo" y el explorador de Archivos tiene su botón "Subir" en la carpeta actual. Un segundo botón en la barra superior es redundante. La barra superior queda con el botón de menú (móvil) y la búsqueda global; el control de tema y el menú de cuenta (Mi perfil, Cerrar sesión) viven al pie de la barra lateral.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Subir, organizar y encontrar archivos del equipo (Priority: P1)

Un editor o administrador activo sube imágenes, fotos, presentaciones, audios, notas y documentos al disco compartido. Los organiza en carpetas (por ejemplo, por servicio o por fecha), ve miniaturas y vistas previas, busca por nombre, filtra por tipo, descarga, renombra, mueve y elimina archivos.

**Why this priority**: Es la necesidad central del equipo: un lugar único y compartido para los recursos multimedia de cada reunión. Sin esto la aplicación no aporta valor.

**Independent Test**: Un editor activo sube una foto a una carpeta, la encuentra con la búsqueda, ve su vista previa y la descarga.

**Acceptance Scenarios**:

1. **Given** un editor activo dentro de una carpeta, **When** sube uno o varios archivos de formato admitido, **Then** cada archivo muestra su progreso y, al terminar, aparece en la carpeta con quién lo subió, fecha y tamaño.
2. **Given** un editor activo, **When** intenta subir un archivo de formato no admitido, **Then** el archivo se rechaza con un mensaje claro que indica los formatos admitidos.
3. **Given** un editor activo, **When** selecciona un archivo mayor a 100 MB, **Then** se rechaza antes de iniciar la subida con un mensaje que indica el límite.
4. **Given** una imagen, un audio, un video o un PDF en el disco, **When** el usuario lo abre, **Then** puede verlo o reproducirlo sin descargarlo.
5. **Given** un archivo o carpeta, **When** el usuario elige eliminarlo, **Then** se le pide confirmación y el elemento se envía a la papelera (no se borra definitivamente).
6. **Given** varios archivos en el disco, **When** el usuario busca por nombre o filtra por tipo, **Then** solo ve los resultados que coinciden, ordenables por fecha, nombre o tamaño.

---

### User Story 2 - Registro, inicio de sesión y acceso por rol (Priority: P1)

Una persona del equipo se registra con correo y contraseña. Su cuenta queda pendiente hasta que un administrador la activa y le asigna un rol (administrador o editor). Los usuarios inician y cierran sesión y pueden recuperar su contraseña. Solo administradores y editores activos entran al área privada.

**Why this priority**: Todo el contenido del equipo debe estar protegido; sin autenticación y roles no puede publicarse la aplicación.

**Independent Test**: Una persona se registra, intenta entrar y ve que su cuenta está pendiente; un administrador la activa como editor; la persona vuelve a entrar y accede al dashboard sin ver la gestión de usuarios.

**Acceptance Scenarios**:

1. **Given** una cuenta recién registrada, **When** intenta iniciar sesión, **Then** ve un aviso de "cuenta pendiente de aprobación" y no accede al área privada.
2. **Given** un editor activo, **When** intenta abrir la gestión de usuarios, **Then** se le niega el acceso, tanto en la interfaz como al solicitar los datos directamente.
3. **Given** un usuario que olvidó su contraseña, **When** solicita recuperarla, **Then** recibe un enlace por correo para definir una nueva, válido por tiempo limitado y un solo uso.
4. **Given** un usuario con sesión iniciada, **When** cierra sesión, **Then** ya no puede acceder a ninguna página privada sin volver a iniciar sesión.

---

### User Story 3 - Envío público de invitados con cola de aprobación (Priority: P2)

Cualquier persona con el enlace público entra a una página de subida, escribe su nombre (y opcionalmente una nota) y sube archivos de formatos admitidos. Los envíos quedan "pendientes". Los administradores y editores conectados reciben una notificación en vivo, sin recargar la página, y pueden aprobar cada envío eligiendo la carpeta de destino o rechazarlo con un motivo opcional. Lo pendiente no aparece en el disco compartido.

**Why this priority**: Permite recibir fotos y material de la congregación de forma controlada; depende de que existan el disco (US1) y los roles (US2).

**Independent Test**: Un invitado sin cuenta sube una foto desde su teléfono; un editor conectado ve la notificación, aprueba el envío en una carpeta y la foto aparece allí.

**Acceptance Scenarios**:

1. **Given** la página pública, **When** un invitado envía archivos admitidos con su nombre, **Then** ve una confirmación de que su envío fue recibido y queda pendiente de revisión.
2. **Given** un editor con sesión abierta, **When** un invitado completa un envío, **Then** el editor ve la notificación y el contador de pendientes actualizado en menos de 5 segundos sin recargar.
3. **Given** un envío pendiente, **When** un editor lo aprueba eligiendo una carpeta, **Then** los archivos aparecen en esa carpeta marcados con origen "invitado" y el nombre del remitente.
4. **Given** un envío pendiente, **When** un editor lo rechaza, **Then** los archivos se eliminan definitivamente y nunca aparecen en el disco.
5. **Given** un invitado, **When** intenta enviar sin nombre o con un formato no admitido, **Then** el formulario lo indica antes de enviar.

---

### User Story 4 - Gestión de usuarios (solo administrador) (Priority: P2)

Un administrador ve la lista de usuarios con su estado y rol, activa o desactiva cuentas, cambia el rol entre administrador y editor y elimina usuarios.

**Why this priority**: Necesaria para incorporar al equipo bajo el modelo de registro con aprobación; sin ella solo el primer administrador podría usar la app.

**Independent Test**: Un administrador activa una cuenta pendiente como editor, luego la desactiva, y la persona pierde el acceso en su siguiente acción.

**Acceptance Scenarios**:

1. **Given** cuentas pendientes, **When** el administrador abre la gestión de usuarios, **Then** las ve destacadas y puede activarlas asignando un rol.
2. **Given** un solo administrador activo, **When** intenta desactivarse, quitarse el rol o eliminarse, **Then** el sistema lo impide y explica por qué.
3. **Given** un usuario con sesión abierta, **When** un administrador lo desactiva, **Then** el usuario pierde el acceso en su siguiente navegación o acción.

---

### User Story 5 - Estructura tipo dashboard con navegación protegida (Priority: P1)

El área privada se presenta como una aplicación tipo dashboard:

- **Barra lateral** con las secciones: Inicio (dashboard), Archivos, Pendientes (con contador en vivo), Papelera, Usuarios (solo administrador), Actividad (solo administrador) y Mi perfil.
- **Barra superior** con búsqueda global (y el botón de menú en tableta y teléfono).
- **Pie de la barra lateral** con el menú de cuenta: Mi perfil, control de tema (oscuro/claro) y cerrar sesión.
- **Subida** desde el acceso rápido de Inicio y desde el botón "Subir" del explorador de Archivos (en la carpeta abierta); no hay un botón de subida en la barra superior.
- **Página Inicio** con archivos recientes, número de envíos pendientes, totales por tipo de archivo, espacio utilizado y accesos rápidos.
- En **escritorio** la barra lateral está fija y puede contraerse a solo iconos; en **tableta y teléfono** se convierte en un panel deslizable que se abre con un botón de menú y se cierra al elegir una sección.
- Las secciones a las que el rol del usuario no tiene acceso no se muestran.

**Why this priority**: Es la forma en que el equipo navega todo lo demás; define la experiencia "rápida y amigable" que el usuario pidió en cualquier pantalla.

**Independent Test**: Un editor inicia sesión en un teléfono, abre el menú, va a Archivos y regresa a Inicio, sin ver nunca la sección "Usuarios".

**Acceptance Scenarios**:

1. **Given** un usuario en cualquier sección, **When** mira la barra lateral, **Then** la sección actual aparece resaltada.
2. **Given** un usuario en escritorio, **When** contrae la barra lateral y recarga la página, **Then** la barra sigue contraída en ese dispositivo.
3. **Given** una pantalla de 360 px de ancho, **When** el usuario abre el menú, **Then** el panel cubre el contenido y se cierra al tocar fuera de él o al elegir una sección.
4. **Given** un nuevo envío de invitado, **When** cualquier administrador o editor tiene la app abierta, **Then** el contador de "Pendientes" en la barra lateral se actualiza sin recargar.

---

### User Story 6 - Páginas de autenticación y protección de rutas (Priority: P1)

Las páginas públicas de autenticación usan un diseño propio, centrado y separado del dashboard, con la identidad de Cloudy (nombre y logotipo): Iniciar sesión, Registro, Recuperar contraseña, Restablecer contraseña (desde el enlace del correo) y Cuenta pendiente de aprobación.

Reglas de navegación:

- Toda ruta privada exige una sesión activa; sin ella se redirige a Iniciar sesión y, tras entrar, se regresa a la página solicitada originalmente.
- Un usuario con sesión que visita una página de autenticación es enviado a Inicio.
- Una página no permitida para el rol muestra "Acceso denegado".
- Solo la página pública de subida de invitados y las páginas de autenticación son accesibles sin sesión.
- Existe una página amigable de "Página no encontrada".

**Why this priority**: Garantiza que ningún contenido privado quede expuesto y que la entrada al sistema sea clara.

**Independent Test**: Sin sesión, se abre un enlace directo a una carpeta; se redirige a Iniciar sesión; tras entrar, el usuario aparece en esa carpeta.

**Acceptance Scenarios**:

1. **Given** un editor con sesión, **When** abre directamente la dirección de la gestión de usuarios, **Then** ve "Acceso denegado" y la solicitud de datos también es rechazada.
2. **Given** un visitante sin sesión, **When** abre un enlace directo a una página privada, **Then** es enviado a Iniciar sesión y, tras autenticarse, llega a la página original.
3. **Given** una cuenta pendiente, **When** inicia sesión, **Then** solo ve la página "Cuenta pendiente de aprobación".
4. **Given** los formularios de autenticación, **When** el usuario introduce un correo inválido, una contraseña corta o contraseñas que no coinciden, **Then** ve el error junto al campo antes de enviar.

---

### User Story 7 - Papelera y recuperación de elementos eliminados (Priority: P2)

Cuando un administrador o editor elimina un archivo o carpeta, el elemento va a la Papelera en lugar de borrarse. Desde la Papelera, administradores y editores ven qué se eliminó, quién lo eliminó y cuándo, y pueden restaurarlo a su ubicación original o eliminarlo definitivamente. Los elementos que llevan más de 30 días en la papelera se eliminan automáticamente.

**Why this priority**: Evita la pérdida accidental de material de los servicios, que es difícil de recuperar; protege el valor central del disco compartido.

**Independent Test**: Un editor elimina una foto, la encuentra en la Papelera, la restaura y la foto vuelve a su carpeta original.

**Acceptance Scenarios**:

1. **Given** un archivo eliminado, **When** el usuario abre la Papelera, **Then** lo ve con su ubicación original, quién lo eliminó, fecha de eliminación y días restantes antes de su borrado automático.
2. **Given** un elemento en la Papelera, **When** el usuario lo restaura, **Then** vuelve a su carpeta original con su contenido y comentarios intactos.
3. **Given** un elemento en la Papelera, **When** el usuario lo elimina definitivamente y confirma, **Then** desaparece y ya no puede recuperarse.
4. **Given** una carpeta eliminada con contenido, **When** se restaura, **Then** se restaura completa con todos sus archivos y subcarpetas.
5. **Given** elementos en la Papelera, **When** un administrador elige "Vaciar papelera" y confirma, **Then** todos se eliminan definitivamente.
6. **Given** archivos en la Papelera, **When** se busca o navega en Archivos, **Then** no aparecen en resultados, carpetas ni en los totales de Inicio.

---

### User Story 8 - Comentarios en archivos (Priority: P3)

Administradores y editores pueden dejar comentarios en cualquier archivo para coordinarse (por ejemplo: "esta es la versión final para el domingo", "falta la diapositiva del anuncio"). Cada comentario muestra autor y fecha. Cada autor puede editar o eliminar sus propios comentarios y un administrador puede eliminar cualquiera. La lista de archivos indica cuántos comentarios tiene cada uno.

**Why this priority**: Mejora la colaboración del equipo sobre el material, pero el disco es útil sin ella.

**Independent Test**: Un editor abre una presentación, deja un comentario; otro editor lo ve al abrir el mismo archivo con el autor y la fecha.

**Acceptance Scenarios**:

1. **Given** un archivo abierto, **When** un editor escribe y publica un comentario, **Then** aparece al instante en la lista de comentarios del archivo con su nombre y la fecha.
2. **Given** un comentario propio, **When** el autor lo edita, **Then** se actualiza y se indica que fue editado.
3. **Given** un comentario de otra persona, **When** un editor intenta editarlo o eliminarlo, **Then** no tiene esa opción y el servidor rechaza la acción.
4. **Given** cualquier comentario, **When** un administrador lo elimina, **Then** desaparece para todos.
5. **Given** un comentario vacío o mayor a 2,000 caracteres, **When** se intenta publicar, **Then** el formulario lo indica y no se publica.

---

### User Story 9 - Experiencia rápida y pulida en cualquier pantalla (Priority: P3)

Todos los flujos funcionan en teléfono (desde 360 px de ancho), tableta y escritorio, en tema claro y oscuro, con indicadores de carga mientras llega el contenido, mensajes breves de confirmación tras cada acción y estados vacíos que orientan al usuario.

**Why this priority**: Mejora la adopción y la satisfacción, pero se apoya sobre las historias anteriores.

**Independent Test**: Recorrer subida, búsqueda, aprobación y gestión de usuarios en un teléfono de 360 px y en escritorio, en ambos temas, sin desplazamiento horizontal.

**Acceptance Scenarios**:

1. **Given** una carpeta vacía, **When** el usuario la abre, **Then** ve un mensaje que lo invita a subir su primer archivo.
2. **Given** cualquier acción completada (subir, mover, aprobar), **When** termina, **Then** el usuario ve una confirmación breve no intrusiva.
3. **Given** un usuario que abre la app por primera vez (con cualquier preferencia de tema en su dispositivo), **When** carga cualquier página, **Then** se muestra en tema oscuro; si cambia a tema claro, esa preferencia se recuerda en su dispositivo.

---

### Edge Cases

- Se pierde la conexión a mitad de una subida: se muestra el error, se puede reintentar y no queda ningún archivo incompleto en el disco.
- Dos archivos con el mismo nombre en la misma carpeta: se agrega un sufijo automático y nunca se sobrescribe.
- Eliminar una carpeta con contenido: se pide confirmación indicando cuántos elementos se enviarán a la papelera.
- Restaurar un elemento cuya carpeta original ya no existe o también está en la papelera: se restaura en la raíz del disco (o junto con su carpeta, si esta también se restaura) y se informa al usuario.
- Restaurar un elemento cuyo nombre ya existe en la carpeta destino: se agrega un sufijo automático.
- Se elimina un archivo mientras otra persona lo está viendo o comentando: al intentar comentar se le informa que el archivo fue enviado a la papelera.
- Abuso del formulario público (spam o subidas masivas): se limita la cantidad de envíos por remitente en una ventana de tiempo.
- Un archivo cuya extensión no corresponde a su contenido real: se rechaza.
- Dos editores aprueban o rechazan el mismo envío al mismo tiempo: solo cuenta la primera acción y el segundo recibe un aviso.
- El último administrador intenta quitarse el rol o desactivarse: el sistema lo impide.
- La sesión expira mientras el usuario trabaja: se le lleva a Iniciar sesión y, al volver a entrar, regresa a donde estaba.
- Un administrador desactiva o cambia el rol de un usuario con sesión abierta: en su siguiente navegación o acción es llevado a "Cuenta pendiente" o a "Acceso denegado", según corresponda.
- Se gira o redimensiona la pantalla con el menú lateral abierto: el diseño se adapta y el panel no queda atascado.
- Se usa un enlace de restablecimiento caducado o ya utilizado: se muestra un mensaje claro con la opción de solicitar uno nuevo.
- Un envío de invitado permanece pendiente más de 7 días: caduca y sus archivos se eliminan automáticamente.

## Requirements *(mandatory)*

### Functional Requirements

**Autenticación y cuentas**

- **FR-001**: El sistema MUST permitir registrarse con nombre, correo y contraseña (mínimo 8 caracteres); el correo debe ser único.
- **FR-002**: El sistema MUST dejar toda cuenta nueva en estado "pendiente" hasta que un administrador la active y le asigne un rol, excepto la primera cuenta registrada en el sistema, que queda activa como administrador.
- **FR-003**: Los usuarios MUST poder iniciar y cerrar sesión con correo y contraseña; la sesión persiste entre visitas y expira tras un periodo de inactividad.
- **FR-004**: Los usuarios MUST poder recuperar su contraseña mediante un enlace enviado por correo, de un solo uso y con caducidad.
- **FR-005**: El sistema MUST impedir el acceso al área privada a cuentas pendientes o desactivadas y mostrarles un mensaje claro de su estado.
- **FR-006**: El sistema MUST limitar los intentos fallidos de inicio de sesión para evitar ataques de fuerza bruta.

**Autorización por roles**

- **FR-007**: El sistema MUST soportar los roles Administrador (control total de contenido y usuarios), Editor (control total del contenido y de la cola de invitados, sin acceso a usuarios) e Invitado (sin cuenta, solo la página pública de subida).
- **FR-008**: El sistema MUST aplicar los permisos en el servidor para cada solicitud, no solo ocultando opciones en la interfaz.

**Disco compartido**

- **FR-009**: El sistema MUST aceptar estos formatos: imágenes (JPG, PNG, WEBP, GIF, HEIC), audio (MP3, WAV, M4A, AAC, OGG), video (MP4, MOV), presentaciones (PPTX, PPT, KEY, ODP, PDF) y notas/documentos (TXT, MD, DOCX), validando el contenido real del archivo.
- **FR-010**: El sistema MUST rechazar archivos mayores a 100 MB y permitir subir varios archivos a la vez mostrando el progreso de cada uno.
- **FR-011**: Administradores y editores MUST poder crear carpetas anidadas y renombrar, mover y eliminar archivos y carpetas; eliminar pide confirmación y envía el elemento a la papelera.
- **FR-012**: Los usuarios MUST poder buscar por nombre, filtrar por tipo de archivo y ordenar por fecha, nombre o tamaño.
- **FR-013**: El sistema MUST mostrar miniaturas de imágenes y permitir ver o reproducir imágenes, audio, video y PDF sin descargarlos.
- **FR-014**: Los usuarios MUST poder descargar cualquier archivo aprobado.
- **FR-015**: El sistema MUST registrar en cada archivo su origen (equipo o invitado), quién lo subió (o el nombre del invitado) y la fecha.

**Envíos de invitados**

- **FR-016**: El sistema MUST ofrecer una página pública, sin sesión, donde un invitado indique su nombre (obligatorio) y una nota (opcional) y suba archivos de formatos admitidos.
- **FR-017**: El sistema MUST guardar los envíos de invitados como "pendientes" y no mostrarlos en el disco compartido hasta su aprobación.
- **FR-018**: El sistema MUST notificar en tiempo real a los administradores y editores conectados de cada nuevo envío y mantener un contador de pendientes actualizado.
- **FR-019**: Administradores y editores MUST poder aprobar un envío eligiendo la carpeta de destino, o rechazarlo con un motivo opcional; el rechazo elimina los archivos definitivamente.
- **FR-020**: El sistema MUST limitar la cantidad de envíos por remitente en una ventana de tiempo y hacer caducar (eliminando sus archivos) los envíos pendientes con más de 7 días.

**Gestión de usuarios**

- **FR-021**: Los administradores MUST poder listar usuarios, activarlos o desactivarlos, cambiar su rol y eliminarlos.
- **FR-022**: El sistema MUST garantizar que siempre exista al menos un administrador activo.

**Actividad**

- **FR-023**: El sistema MUST registrar subidas, envíos a papelera, restauraciones, eliminaciones definitivas, aprobaciones, rechazos, eliminación de comentarios por un administrador y cambios de rol o estado de usuarios (quién, qué, sobre qué elemento y cuándo), y los administradores MUST poder consultar ese registro.

**Estructura de la aplicación y navegación**

- **FR-024**: El área privada MUST presentarse como un dashboard con barra lateral (Inicio, Archivos, Pendientes con contador, Papelera, Usuarios, Actividad, Mi perfil) con un menú de cuenta al pie (Mi perfil, cambio de tema, cerrar sesión), y barra superior con búsqueda global; la barra lateral solo muestra las secciones permitidas para el rol. La subida se inicia desde Inicio y desde el explorador de Archivos, no desde la barra superior.
- **FR-025**: La barra lateral MUST ser fija y contraíble en escritorio (recordando su estado en el dispositivo) y convertirse en un panel deslizable en tableta y teléfono.
- **FR-026**: La página Inicio MUST mostrar archivos recientes, número de envíos pendientes, totales por tipo de archivo, espacio utilizado y accesos rápidos.
- **FR-027**: El sistema MUST ofrecer páginas de Iniciar sesión, Registro, Recuperar contraseña, Restablecer contraseña y Cuenta pendiente, con un diseño propio separado del dashboard y validación de campos en línea.
- **FR-028**: El sistema MUST proteger todas las rutas privadas por sesión y rol, redirigir a Iniciar sesión conservando la ruta solicitada para volver a ella, enviar a Inicio a usuarios con sesión que visiten páginas de autenticación, y mostrar páginas de "Acceso denegado" y "Página no encontrada".
- **FR-029**: Solo las páginas de autenticación y la página pública de subida de invitados (con su propio diseño mínimo) MUST ser accesibles sin sesión.
- **FR-030**: Los usuarios MUST poder ver y editar su nombre y cambiar su contraseña desde "Mi perfil".

**Experiencia de usuario**

- **FR-031**: Todos los flujos MUST funcionar sin desplazamiento horizontal desde 360 px de ancho, en tema oscuro (por defecto) y claro, con la interfaz en español.
- **FR-032**: El sistema MUST mostrar indicadores de carga, confirmaciones breves tras cada acción, estados vacíos orientativos y mensajes de error comprensibles.
- **FR-033**: La interfaz MUST poder usarse con teclado y tener etiquetas accesibles en controles y formularios.

**Papelera**

- **FR-034**: El sistema MUST conservar en la papelera todo archivo o carpeta eliminado por un administrador o editor, junto con su ubicación original, quién lo eliminó y cuándo; los elementos en papelera no aparecen en carpetas, búsquedas ni totales.
- **FR-035**: Administradores y editores MUST poder restaurar elementos de la papelera a su ubicación original (con su contenido y comentarios) y eliminarlos definitivamente con confirmación; solo los administradores MUST poder vaciar la papelera completa.
- **FR-036**: El sistema MUST eliminar definitivamente y de forma automática los elementos que lleven más de 30 días en la papelera, mostrando los días restantes de cada uno.
- **FR-037**: El espacio utilizado mostrado en Inicio MUST indicar por separado el espacio ocupado por la papelera.

**Comentarios**

- **FR-038**: Administradores y editores MUST poder publicar comentarios de texto (1 a 2,000 caracteres) en cualquier archivo, mostrando autor y fecha en orden cronológico.
- **FR-039**: Cada autor MUST poder editar (indicándose como "editado") y eliminar sus propios comentarios; los administradores MUST poder eliminar cualquier comentario; estas reglas se aplican en el servidor.
- **FR-040**: La lista de archivos MUST mostrar el número de comentarios de cada archivo, y los comentarios de un archivo MUST conservarse si este se envía a la papelera y se restaura.

**Identidad visual**

- **FR-041**: La aplicación MUST llamarse **Cloudy** y mostrar ese nombre con su logotipo en la barra lateral, las páginas de autenticación, la página pública de invitados, el título de la pestaña del navegador y los correos enviados.
- **FR-042**: La interfaz MUST usar la paleta oficial del equipo, con el **naranja como color representativo** en acciones principales, elemento activo de la navegación, enlaces y elementos de marca; los colores de apoyo (cian y verde lima) y los de estado (información, éxito, advertencia, error) se usan solo para su propósito.
- **FR-043**: El **tema oscuro** MUST ser el predeterminado para todos los usuarios; el tema claro está disponible como alternativa y conserva la misma identidad naranja.
- **FR-044**: La interfaz MUST usar la tipografía **DM Sans** (sans serif amigable y moderna), legible en todos los tamaños, y componentes con esquinas redondeadas coherentes con ese estilo.
- **FR-045**: Todo texto y control MUST mantener un contraste suficiente sobre su fondo en ambos temas (al menos 4.5:1 en texto normal y 3:1 en texto grande y elementos de interfaz), con un indicador de foco visible para la navegación con teclado.
- **FR-046**: La aplicación MUST incluir un **control de tema** (tonalidad), accesible desde el menú de cuenta al pie de la barra lateral del dashboard y desde las páginas de autenticación y de invitados, que permita cambiar entre tema oscuro y claro. La elección se aplica al instante, sin parpadeo al recargar, y se recuerda en el dispositivo.
- **FR-047**: La aplicación MUST reducir animaciones cuando el dispositivo del usuario lo solicite.

### Key Entities *(include if feature involves data)*

- **Usuario**: miembro del equipo. Nombre, correo, rol (administrador o editor), estado (pendiente, activo o desactivado) y fecha de registro.
- **Carpeta**: agrupa archivos. Nombre, carpeta padre (opcional) y creador.
- **Archivo**: recurso multimedia aprobado. Nombre, categoría (imagen, audio, video, presentación, documento), tamaño, carpeta, origen (equipo o invitado), quién lo subió o nombre del invitado, fecha y, si está en la papelera, quién lo eliminó y cuándo. Las carpetas también registran si están en la papelera.
- **Comentario**: nota de un miembro del equipo sobre un archivo. Archivo, autor, texto, fecha de creación y fecha de última edición.
- **Envío de invitado**: paquete enviado desde la página pública. Nombre del remitente, nota, archivos, estado (pendiente, aprobado, rechazado o caducado), revisor, fecha de decisión y motivo de rechazo.
- **Registro de actividad**: evento auditable. Quién lo hizo, qué acción, sobre qué elemento y cuándo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un miembro del equipo encuentra y descarga un archivo buscado en menos de 30 segundos.
- **SC-002**: Un invitado completa un envío desde su teléfono en menos de 1 minuto.
- **SC-003**: Administradores y editores conectados ven un nuevo envío de invitado en menos de 5 segundos.
- **SC-004**: Las carpetas y los resultados de búsqueda se muestran en menos de 2 segundos con hasta 5,000 archivos.
- **SC-005**: El 100% de los flujos principales se completan en pantallas desde 360 px de ancho sin desplazamiento horizontal.
- **SC-006**: 0 archivos pendientes visibles para usuarios no autorizados y 0 acciones exitosas fuera del rol, verificado por pruebas automatizadas.
- **SC-007**: El 90% de los nuevos miembros sube su primer archivo sin ayuda.
- **SC-008**: Cualquier sección principal se alcanza en un máximo de 2 toques o clics desde cualquier página privada.
- **SC-009**: El 100% de las rutas privadas rechaza el acceso sin sesión o con un rol no permitido, verificado por pruebas automatizadas.
- **SC-010**: El 100% de los elementos eliminados puede restaurarse completo durante sus primeros 30 días en la papelera.
- **SC-011**: Un comentario publicado es visible para otros miembros que abren el archivo en menos de 5 segundos.
- **SC-012**: Cada historia de usuario está cubierta por pruebas automatizadas de extremo a extremo y las reglas de negocio por pruebas unitarias.

## Assumptions

- El equipo es pequeño: hasta unas 50 cuentas internas y unos cientos de envíos de invitados al mes.
- Los archivos se guardan en el servicio de almacenamiento de objetos del mismo proveedor de la base de datos en la nube; la base de datos solo guarda la información descriptiva de cada archivo.
- El registro, inicio de sesión, manejo de sesiones, recuperación de contraseña y los correos asociados los provee el servicio de autenticación del mismo proveedor de la base de datos en la nube; la aplicación añade encima los roles (administrador/editor) y el estado de aprobación de cada cuenta.
- Quedan fuera de la versión 1: historial de versiones, enlaces públicos para compartir, menciones o notificaciones por comentarios, comentarios en carpetas o por invitados, y edición de archivos en el navegador.
- Los envíos de invitados rechazados o caducados se eliminan definitivamente y no pasan por la papelera.
- El contenido de invitados aprobado se trata como cualquier otro archivo, conservando su origen "invitado".
- El enlace de la página pública de invitados es fijo y se comparte por los canales de la iglesia.
- La paleta oficial (tema oscuro y tema claro derivado) ya está definida en el proyecto con contrastes verificados; el naranja original se conserva en el tema oscuro y se oscurece ligeramente en el claro para leerse sobre fondo blanco.
- El logotipo inicial de Cloudy es el nombre acompañado de un ícono de nube; puede reemplazarse después por un diseño propio sin afectar el resto de la aplicación.
- Las decisiones tecnológicas indicadas por el usuario (base de datos, capa de acceso a datos, biblioteca de diseño, iconos, fuentes y herramientas de pruebas) se trasladan a la fase de planificación y no forman parte de esta especificación.
