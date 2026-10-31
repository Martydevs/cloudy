# Feature Specification: Actualización en vivo sin sondeo

**Feature Branch**: `004-neon-realtime` (carpeta de documentos: `specs/004-neon-realtime/`)

**Created**: 2026-10-31

**Status**: Draft

**Input**: Plan de migración `neon-realtime-migration-plan.md` (raíz del repositorio): reemplazar el sondeo manual
(consultas repetidas cada 3 o 5 segundos) por actualización en vivo empujada desde la base de datos, para que el equipo y
los invitados vean los cambios al instante, sin consultas repetidas y sin mantener despierta la base de datos mientras
nadie escribe.

## Clarifications

### Directivas de la persona responsable (2026-10-31)

- La migración vive en su **propia rama y feature, `004-neon-realtime`**, para poder descartarse o revertirse sin tocar
  la feature 003. La rama parte de la punta de `003-public-photos-upload`; se rebasa sobre `main` cuando la 003 se integre.
- En producción solo se permiten **orígenes exactos** (sin comodines) para la conexión en vivo.
- **Barra de calidad ≥ 90 %**: tanto la cobertura de pruebas unitarias y de componente como la lista de verificación
  final (SC-010) deben llegar al 90 %, sin ningún fallo en pruebas, tipos, build ni autorización.
- **Sin sondeo de respaldo**: si el canal en vivo no está disponible, la pantalla muestra un estado de error con
  "Reintentar"; no se conserva código de sondeo "por si acaso".
- Ante cualquier comando peligroso o que cambie configuración de Neon (origenes permitidos, secretos, comandos MCP de base
  de datos), el agente pide permiso antes de ejecutarlo (AGENTS.md, "Notes").

## Requisitos de otras features que esta reemplaza

Esta feature cambia **cómo** se logra la actualización en vivo, no qué ve la persona; endurece los tiempos. Donde un
documento anterior fija "≤ 5 s de intervalo de actualización en vivo", **vale esta spec** (< 2 s, sin intervalo).

| Origen | Requisito | Qué cambia |
|--------|-----------|-----------|
| 001 | FR-018, SC-003 (aviso de nuevos envíos "en menos de 5 s"), escenarios con "en menos de 5 segundos" y research R7 (sondeo) | Aviso y contador en < 2 s, sin sondeo (FR-001, SC-001) |
| 001 | Comentarios en vivo (US8) | Se ven en < 2 s (FR-013, SC-003) |
| 002 | FR-012 (consulta cada 3 s mientras una lectura de imagen está en curso) | El estado de la lectura llega en vivo (FR-014) |
| 003 | FR-007, FR-013, SC-002, SC-005 y todo escenario "en el siguiente ciclo de actualización en vivo (≤ 5 s de intervalo)" | Aviso al equipo y estado del invitado en < 2 s (FR-001, FR-009, SC-001, SC-002) |
| 003 | Research B6 (sondeo del pulso y del invitado) | Sustituido por la decisión C1 de esta feature (`research.md`) |

Los documentos de las features 001–003 reciben una nota de una línea "sustituido por la feature 004" (tarea de Polish);
sus contenidos no se reescriben.

## User Scenarios & Testing *(mandatory)*

Hoy Cloudy simula el "tiempo real" preguntando al servidor cada pocos segundos si algo cambió: el contador de la barra
lateral y los avisos del equipo (cada 5 s), el estado de la solicitud del invitado en `/upload` (cada 5 s), el hilo de
comentarios de un archivo (cada 5 s) y la lectura de texto de una imagen (cada 3 s). Cada pregunta cuesta una llamada al
servidor y una consulta a la base de datos, **también cuando no hay nada nuevo**, y como llega más seguido que el tiempo
tras el que la base se duerme (5 minutos), la base **no puede dormirse mientras una pestaña del equipo esté visible**.

Esta feature hace que los cambios lleguen solos, en el momento en que ocurren, y que una pestaña quieta no genere
consultas repetidas ni mantenga despierta la base de datos.

**Terminología** (textos de interfaz y documentos):

- **En vivo**: la pantalla se actualiza sola cuando cambian los datos, sin recargar y sin preguntas periódicas.
- **Canal en vivo**: la conexión que entrega esos cambios. Puede estar *conectando*, *en vivo*, *pausado* (pestaña oculta o sin
  conexión) o *con error*.
- **Permiso de lectura temporal**: autorización breve (≈ 1 minuto) que el servidor entrega a una página para recibir sus
  datos en vivo; la página la renueva sola mientras está visible.

### User Story 1 - El equipo ve las solicitudes y los envíos en vivo (Priority: P1) 🎯 MVP

Un administrador o editor con Cloudy abierta ve, apenas ocurren, las nuevas solicitudes de acceso y los nuevos envíos de
invitados: aparece un aviso, el contador de **Solicitudes** de la barra lateral cambia y la página **Solicitudes** muestra
la novedad. El administrador también ve en vivo las cuentas pendientes de aprobar. Las páginas Inicio, Solicitudes y
Usuarios se mantienen al día sin recargar y sin consultas periódicas.

**Why this priority**: es el mayor consumo (una consulta a la base de datos cada 5 s por pestaña del equipo, todo el
tiempo) y el cambio central: sin él la base de datos sigue despierta. Es un incremento que se puede desplegar solo,
porque el invitado y la página de archivos pueden seguir con su mecanismo actual hasta sus propias historias.

**Independent Test**: con dos navegadores, un editor conectado en Inicio y un invitado sin sesión en `/upload`: el
invitado pide acceso y el editor ve el aviso, el contador y la tarjeta en Solicitudes en menos de 2 s; el invitado
completa un envío y ocurre lo mismo; el editor aprueba y la tarjeta desaparece sola; con el DevTools abierto no se ve
ninguna petición que se repita cada pocos segundos.

**Acceptance Scenarios**:

1. **Given** un administrador o editor con Cloudy abierta, **When** un invitado pide acceso, **Then** en menos de 2 s ve un aviso, el contador de Solicitudes sube en uno y, en la página Solicitudes, la solicitud aparece arriba con el nombre y la hora, sin recargar.
2. **Given** un administrador o editor con Cloudy abierta, **When** un invitado termina un envío, **Then** en menos de 2 s ve el aviso con el nombre y el número de archivos, el contador sube y el envío aparece en Solicitudes.
3. **Given** una solicitud de acceso abierta en la pantalla de dos miembros del equipo, **When** uno la aprueba o la rechaza, **Then** en la pantalla del otro la solicitud desaparece en menos de 2 s, sin recargar.
4. **Given** una solicitud de acceso que nadie atendió, **When** pasan sus 8 minutos de vigencia, **Then** desaparece de la pantalla y del contador a la hora de caducidad, aunque no haya cambiado nada en la base de datos, y con el reloj del dispositivo adelantado o atrasado.
5. **Given** un administrador con Cloudy abierta, **When** una persona nueva crea su cuenta, **Then** el contador de Usuarios sube en menos de 2 s y la persona aparece como pendiente en la página Usuarios sin recargar; un editor no ve ese contador.
6. **Given** el layout del equipo recién abierto, **When** carga con solicitudes y envíos que ya existían, **Then** no se lanza ningún aviso por ellos, pero el contador los incluye.
7. **Given** una novedad ya anunciada, **When** el canal en vivo se reconecta o el layout se vuelve a montar, **Then** no se repite el aviso.
8. **Given** un editor con la pestaña oculta, **When** vuelve a ella, **Then** los datos se ponen al día de inmediato y se anuncian las novedades ocurridas mientras estuvo fuera.
9. **Given** una cuenta de equipo a la que se le quita el rol o se desactiva, **When** tiene Cloudy abierta, **Then** deja de recibir datos de solicitudes y envíos en el siguiente permiso renovado (≤ 1 minuto) y no recibe nada nuevo.
10. **Given** un canal en vivo caído, **When** el equipo abre una pantalla en vivo, **Then** ve un estado de error con "Reintentar"; al reintentar con el canal restablecido, la pantalla vuelve a estar en vivo, y las decisiones (dar acceso, rechazar) y las subidas siguen funcionando.

---

### User Story 2 - El invitado ve la decisión en vivo (Priority: P2)

Un invitado que espera en `/upload` ve cambiar su estado (aprobada, rechazada, caducada) al instante, sin recargar y sin
que su navegador pregunte cada pocos segundos, y se habilita el formulario de envío en cuanto se aprueba.

**Why this priority**: es el segundo mayor consumo de llamadas (hasta 96 mientras espera y 360 con el acceso aprobado, por
invitado) y la experiencia del invitado mejora de "hasta 5 s" a "al instante", pero el equipo y la base de datos ya se
benefician con la historia 1.

**Independent Test**: un invitado sin sesión pide acceso en `/upload`; un editor aprueba o rechaza; en menos de 2 s la
página del invitado cambia sin recargar, un lector de pantalla anuncia el cambio, y no hay peticiones repetidas
mientras espera.

**Acceptance Scenarios**:

1. **Given** un invitado esperando en `/upload`, **When** el equipo aprueba su solicitud, **Then** en menos de 2 s ve el formulario de envío, sin recargar y sin ningún dato del equipo.
2. **Given** un invitado esperando, **When** el equipo la rechaza, **Then** en menos de 2 s ve que no fue aceptada y cómo volver a pedir acceso.
3. **Given** un invitado esperando o con acceso aprobado, **When** vence la vigencia, **Then** ve el mensaje de caducidad en el momento del vencimiento, distinguiendo "solicitud caducada sin atender" de "acceso caducado sin usar".
4. **Given** un invitado cuyo estado ya es final (rechazada, caducada, usada), **When** sigue en la página, **Then** no se mantiene ningún canal en vivo ni petición periódica.
5. **Given** un invitado que pide un acceso nuevo desde una solicitud rechazada, caducada o usada, **When** la nueva solicitud se crea, **Then** la página sigue la **nueva** solicitud en vivo (no la anterior).
6. **Given** la página `/upload` recargada con una solicitud viva, **When** el servidor la dibuja, **Then** la primera vista ya muestra el estado correcto y después sigue en vivo.
7. **Given** un invitado con la pestaña oculta o sin conexión, **When** vuelve, **Then** el estado se pone al día de inmediato.

---

### User Story 3 - Comentarios y lectura de imágenes en vivo (Priority: P3)

En la página de un archivo, los comentarios de otras personas aparecen solos y el estado de la lectura de texto de una
imagen avanza solo, hasta terminar, sin consultas repetidas.

**Why this priority**: son los consumos restantes, pero solo corren en la página de un archivo, y las pruebas de la
historia 1 ya demuestran el mecanismo.

**Independent Test**: dos personas del equipo en el mismo archivo: una comenta y la otra lo ve en menos de 2 s; al
iniciar la lectura de una imagen, el panel pasa de "leyendo" al resultado sin recargar ni peticiones repetidas.

**Acceptance Scenarios**:

1. **Given** dos personas en la página del mismo archivo, **When** una publica, edita o borra un comentario, **Then** la otra lo ve en menos de 2 s, sin recargar.
2. **Given** una persona que publica su propio comentario, **When** el servidor responde, **Then** el comentario aparece de inmediato y no se duplica cuando llega por el canal en vivo.
3. **Given** el hilo de comentarios fuera de la vista de la pantalla, **When** la persona no lo ve, **Then** no se sigue en vivo, y al volver a verlo se pone al día de inmediato.
4. **Given** una imagen cuya lectura de texto está en curso, **When** termina (con texto, vacía o con error), **Then** el panel muestra el resultado en menos de 2 s y deja de seguir el estado.
5. **Given** una lectura de imagen que quedó en curso sin terminar, **When** pasan 90 segundos, **Then** el panel muestra el error de tiempo agotado a esa hora, aunque la base de datos no haya cambiado.
6. **Given** el texto de una imagen corregido por otra persona, **When** la corrección se guarda, **Then** quien tiene el panel abierto la ve en menos de 2 s, con quién la editó.
7. **Given** un archivo de un envío de invitado en Solicitudes y el mismo en la biblioteca, **When** cambia su texto, **Then** ambos paneles se actualizan en vivo.

---

[Fin de historias. El orden de despliegue es P1 → P2 → P3; después, la fase de cierre elimina el código de sondeo y valida todo.]

### Edge Cases

- **Pestaña oculta o sin conexión**: la actualización en vivo y su mantenimiento se detienen; al volver, los datos se ponen al
  día de inmediato (sin esperar un ciclo).
- **Canal en vivo con falla del proveedor** (servicio en beta, sin SLA): estado de error con "Reintentar"; no hay sondeo de
  respaldo. Las acciones que escriben (subir, decidir, comentar) usan el servidor y siguen funcionando; solo se detienen los
  contadores, los avisos y las actualizaciones automáticas.
- **Datos que cambian por tiempo y no por escritura** (caducidad de solicitudes, acceso del invitado, lectura de imagen en
  curso): se resuelven en el dispositivo con la hora del servidor, usando las mismas reglas que el servidor (funciones
  compartidas), porque la base de datos no emite un cambio cuando solo pasa el tiempo.
- **Reconexión**: el canal puede reenviar el resultado completo; ninguna novedad ya anunciada se vuelve a anunciar, y una
  novedad no se pierde si el canal entrega los cambios de forma incompleta (se compara el conjunto de identificadores).
- **Cambio de sesión**: si la sesión caduca o entra otra persona en otra pestaña, la pantalla se recarga por completo una
  sola vez; nunca se mezclan datos de la persona anterior con los de la nueva.
- **Cuenta desactivada con la pestaña abierta**: la autorización se evalúa en cada actualización de datos, no solo al abrir la
  página, así que deja de recibir datos en el siguiente permiso renovado.
- **Invitado que pide un acceso nuevo**: la solicitud nueva cambia la identificación del navegador del invitado, así que la
  página debe volver a pedir su permiso de lectura para seguir la nueva solicitud.
- **Muchas filas**: cada vista en vivo tiene un tope de filas muy por encima del volumen real (decenas por domingo); si se
  alcanzara el tope, el contador muestra el tope y queda documentado como límite (research C12).
- **Varias pestañas del mismo equipo**: cada pestaña mantiene su propio canal y anuncia una vez; el costo por pestaña no
  crece con el tiempo.
- **Fechas y números**: la forma de los datos (fechas como texto ISO, conteos como enteros) es idéntica en la primera vista
  del servidor y en las actualizaciones en vivo, para no provocar desajustes al hidratar.
- **Servicio no configurado** (variables vacías en un entorno): las pantallas en vivo muestran el estado de error con
  reintento y el resto de Cloudy sigue funcionando; ninguna ruta se rompe.
- **Reversión**: la feature no modifica el esquema ni los datos; revertirla (o descartar la rama) restaura el sondeo sin
  migraciones.

## Requirements *(mandatory)*

### Functional Requirements

**Equipo: solicitudes, envíos y cuentas**

- **FR-001**: Los administradores y editores activos con Cloudy abierta MUST ver un aviso por cada nueva solicitud de acceso y por cada nuevo envío de invitado, y el contador de Solicitudes de la barra lateral (solicitudes de acceso abiertas + envíos por revisar), en menos de 2 s y sin consultas periódicas.
- **FR-002**: El administrador MUST ver en vivo el número de cuentas pendientes y la lista de pendientes en Usuarios; un editor MUST NOT recibir ese dato.
- **FR-003**: Cada novedad MUST anunciarse **una sola vez** por pestaña: no al cargar (lo que ya existía no se anuncia), no tras una reconexión y no tras remontar el layout.
- **FR-004**: Inicio, Solicitudes y Usuarios MUST actualizar sus contadores y listas cuando cambian los datos en vivo, sin recargar. Las decisiones (dar acceso, rechazar, aprobar usuario) siguen siendo peticiones al servidor; el resultado se refleja porque el dato sale de la vista en vivo.
- **FR-005**: Las solicitudes de acceso con vigencia vencida MUST salir de la pantalla y del contador a la hora de caducidad, calculada en el dispositivo con la hora del servidor (no la del dispositivo), con la misma regla que usa el servidor.
- **FR-006**: La autorización de los datos en vivo MUST evaluarse en la propia consulta de datos y en cada actualización: una cuenta sin rol o desactivada MUST dejar de recibir datos, y un no-administrador MUST NOT recibir datos de administración.

**Invitado**

- **FR-007**: La página `/upload` MUST actualizar el estado de la solicitud del invitado (esperando, aprobada, rechazada, caducada, acceso caducado, usada) en menos de 2 s y sin recargar, sin mostrar nombres ni datos del equipo, y MUST anunciar cada cambio a lectores de pantalla (como hoy).
- **FR-008**: La primera vista de `/upload` MUST seguir dibujándose con el estado correcto desde el servidor y, después, seguir en vivo; el desfase entre el reloj del servidor y el del dispositivo MUST seguir calculándose.
- **FR-009**: El seguimiento en vivo del invitado MUST detenerse en cuanto el estado es final (ninguna, rechazada, caducada, acceso caducado, usada) y reanudarse al pedir un acceso nuevo, siguiendo la **nueva** solicitud.
- **FR-010**: El permiso de lectura del invitado MUST depender solo de la cookie de su navegador; no puede leer solicitudes ajenas ni datos del equipo.

**Archivo**

- **FR-011**: Los comentarios de un archivo MUST actualizarse en vivo mientras el hilo es visible: nuevos, editados y borrados, en menos de 2 s. El comentario propio MUST aparecer de inmediato y sin duplicarse al llegar por el canal en vivo.
- **FR-012**: Los datos en vivo de un archivo MUST respetar el mismo acceso que su lectura normal: solo equipo activo, solo archivos listos y no en la papelera de otra persona (igual que hoy).
- **FR-013**: El hilo de comentarios MUST seguir mostrando los cuatro estados (cargando, vacío, error con reintento, contenido).
- **FR-014**: El estado de la lectura de texto de una imagen (en curso, listo, vacío, fallido, no disponible) MUST seguirse en vivo solo mientras la lectura está en curso y dejar de seguirse al terminar; una lectura que lleva más de 90 s MUST mostrarse como error de tiempo agotado a esa hora, con la misma regla que usa el servidor (función compartida).
- **FR-015**: Los paneles de texto de imágenes de la biblioteca y de Solicitudes MUST actualizarse en vivo con la corrección manual de otra persona.

**Comportamiento común del canal en vivo**

- **FR-016**: Una pestaña visible y quieta MUST NOT enviar peticiones periódicas de intervalo corto; solo el mantenimiento del permiso de lectura, **una petición por vista en vivo activa** (≈ una vez por minuto cada una). El layout del equipo mantiene una vista siempre activa, así que una pestaña quieta del dashboard hace **una** renovación ≈ cada 50 s; la página de un archivo suma la de su hilo y, mientras una imagen se lee, la de su texto.
- **FR-017**: El mantenimiento del permiso MUST NOT consultar la base de datos de Cloudy (la sesión se valida con la cookie firmada) y MUST pausarse con la pestaña oculta o sin conexión, reanudándose de inmediato al volver (ver puerta G1 en el plan).
- **FR-018**: Si el permiso no se puede renovar por falla de sesión (sesión caducada o **persona distinta de la que cargó la página**), la página MUST recargarse por completo una sola vez; si falla por otra causa, MUST reintentar cada segundo hasta que el permiso venza y entonces mostrar el estado de error.
- **FR-019**: Toda vista en vivo MUST cubrir los cuatro estados: conectando (esqueleto), vacío (con guía), error con "Reintentar" y con contenido, con los textos de error en español en el catálogo de mensajes de la aplicación; "Reintentar" MUST volver a conectar desde cero (autorización nueva y, si falló la conexión, una conexión nueva).
- **FR-020**: El permiso de lectura MUST viajar solo en cuerpos de respuesta: nunca en direcciones URL, registros, almacenamiento del navegador ni en la página dibujada por el servidor; y MUST ser ilegible e inalterable para el navegador.
- **FR-021**: La definición de "envío listo por revisar" y de "solicitud de acceso abierta" MUST ser la misma para el resumen que dibuja el servidor en la primera vista y para la vista en vivo (una sola definición compartida o una prueba de equivalencia), para que ambos contadores coincidan.

**Retiro del sondeo y operación**

- **FR-022**: Al cerrar la feature, Cloudy MUST NOT conservar el sondeo del pulso, el sondeo de `/upload`, el de comentarios ni el de lectura de imágenes, ni las constantes, tipos, parámetros de "desde" y pruebas que solo existían para ellos; sus pruebas se **portan** a la nueva implementación, no se descartan.
- **FR-023**: Cada entorno MUST usar solo su propia configuración de datos en vivo (rama de desarrollo, de pruebas y de producción); los orígenes permitidos MUST ser exactos en producción, y la correspondencia variable ↔ rama MUST comprobarse sin imprimir valores.
- **FR-024**: La feature MUST NOT requerir cambios de esquema ni migraciones, ni nuevas tablas, y MUST poder revertirse sin tocar datos.

### Key Entities *(include if feature involves data)*

- **Vista en vivo**: conjunto de consultas de solo lectura que una página sigue en vivo (p. ej. las del equipo: envíos listos, solicitudes de acceso abiertas, cuentas pendientes). Sin datos nuevos: lee las tablas existentes.
- **Permiso de lectura temporal**: autorización sellada, de ≈ 1 minuto, que cubre todas las consultas de una vista en vivo (el equipo, un archivo, el estado del invitado), ligada a la persona (o, para el invitado, a su cookie) y renovada por la propia página.
- **Estado del canal**: *conectando*, *en vivo*, *pausado* o *con error*; decide cuál de los cuatro estados de interfaz se muestra.
- **Registro de avisos**: conjunto de identificadores ya anunciados en esta pestaña, que evita repetir avisos tras reconexiones o remontajes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una nueva solicitud de acceso o un nuevo envío llega a la pantalla de un administrador o editor conectado (aviso, contador y lista) en menos de 2 s desde que se registra, medido en 95 % de las pruebas.
- **SC-002**: La decisión del equipo llega a la página del invitado en menos de 2 s, sin recargar.
- **SC-003**: Un comentario de otra persona aparece en el hilo en menos de 2 s.
- **SC-004**: Con una pestaña del equipo visible y quieta, el panel de red del navegador no muestra **ninguna petición repetida cada pocos segundos**: solo la conexión en vivo y, como máximo, una petición de mantenimiento por minuto.
- **SC-005**: Con una pestaña oculta o sin conexión, el panel de red no muestra peticiones de mantenimiento.
- **SC-006**: Para una pestaña del dashboard visible y quieta (sin vistas adicionales abiertas, como Inicio): llamadas al servidor de 720 a 72 por hora o menos (−90 %) y consultas a la base de datos en reposo de 4 320 a 0 por hora. Cada vista en vivo adicional (hilo de comentarios, lectura de una imagen) suma una renovación ≈ cada 50 s mientras está activa.
- **SC-007**: Con una pestaña del equipo visible y quieta durante 30 minutos en la rama de desarrollo, el tiempo activo de la base de datos baja de ≈ 1 800 s a ≤ ≈ 360 s (una sola activación y luego se duerme). *Condicionado a la puerta G1 del plan; si no se cumple, esta feature se replantea antes de seguir.*
- **SC-008**: El JavaScript inicial de cada ruta sigue ≤ 250 KB comprimido (la biblioteca en vivo se carga de forma diferida).
- **SC-009**: Los cuatro estados de interfaz (conectando, vacío, error con reintento, contenido) se ven en el 100 % de las vistas en vivo, en ambos temas, a 360 px y a ≥ 1280 px.
- **SC-010**: La lista de verificación final (verificación de tipos, build, pruebas unitarias, de componente y e2e, umbral de cobertura, cobertura por archivo ≥ 90 %, presupuesto de peso por ruta, 4 revisiones en navegador, sin sondeo en red, sin renovación en pestaña oculta, cuatro estados, foco y consola limpios, medición de cómputo) llega a ≥ 90 % de aprobados **con cero fallos** en pruebas, tipos, build y autorización.
- **SC-011**: La cobertura del proyecto se mantiene en el umbral de 92 % (sin bajarlo) y cada archivo nuevo alcanza ≥ 90 % en cada métrica por sí mismo.

## Assumptions

- El servicio de datos en vivo de Neon (en beta, sin SLA y gratuito durante la beta) ya está habilitado en las ramas de producción, desarrollo y pruebas, en una región admitida y con replicación lógica activa (verificado en solo lectura el 2026-10-31; ver el plan). Su precio tras la beta no está publicado.
- Todas las tablas implicadas tienen clave primaria (identidad de réplica estable); no se requieren cambios de esquema.
- Las escrituras siguen siendo peticiones al servidor (subir, comentar, decidir); la feature no agrega escrituras optimistas ni espera de transacciones.
- El resumen que dibuja el servidor (`/api/dashboard`) y el estado inicial del invitado (`/api/public/access/current`) se conservan: dan la primera vista con SSR y el desfase de reloj.
- Los roles y estados son los de hoy: administrador y editor activos para ver solicitudes, envíos, comentarios y textos; solo el administrador para cuentas pendientes.
- La seguridad por filas de la base (RLS) no se usa; la autorización vive dentro de cada consulta.
- Las llamadas a funciones del servidor (invocaciones) no son visibles desde el agente: las cifras de invocaciones se leen en el panel de Vercel antes y después.
- Orígenes permitidos: durante las historias 1–3 la configuración sigue abierta (sin lista, cualquier origen); la fase de cierre los fija por rama y vuelve a correr las pruebas e2e. El dominio exacto de producción lo da la persona responsable en ese paso.
- Fuera de alcance: presencia o indicador de escritura, escrituras optimistas, el listado de carpetas y archivos de la biblioteca en vivo, notificaciones push o por correo, sondeo de respaldo, cambios de esquema, cambios de los permisos por rol, y cambios de diseño visual más allá de los estados de conexión y error.
