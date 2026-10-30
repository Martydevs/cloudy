---

description: "Task list for Cloudy — Subida de invitados con aprobación de acceso (feature 003)"
---

# Tasks: Subida de invitados con aprobación de acceso

**Input**: Documentos de diseño en `specs/003-guest-upload-access-code/`

**Prerequisites**: plan.md, spec.md, research.md (B1–B12), data-model.md, contracts/api.md, contracts/ui.md, quickstart.md · Constitución v1.0.1 · Base: features 001 y 002

**Tests**: **Requeridos** por la Constitución V y por el plan ("V. Pruebas"). Cada historia tiene tests unitarios (`test/unit`), de componente (`test/nuxt`) y e2e (`test/e2e`). Dentro de cada historia los tests se escriben antes que la implementación y deben fallar primero.

**Organization**: Las tareas se agrupan por historia de usuario en orden de prioridad (US1 P1 → US2 P2 → US3 P3), y **cada historia se puede desplegar sola** una vez terminadas las anteriores (Constitución II). US1 es el MVP completo: pedir acceso, decidir y enviar con permiso. US2 agrega la cámara dentro de Cloudy en `/upload` y `/enviar`. US3 agrega el origen y el aprobador en la cola. El modelo de datos, los tipos, las constantes, la lógica de solicitudes y la extracción de `createGuestSubmission` son fundacionales. El renombrado de Pendientes a Solicitudes va en US1, que es la primera que necesita la página.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede ejecutar en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: la historia de usuario de spec.md a la que pertenece la tarea (US1…US3).

## Convenciones obligatorias para quien implemente (de AGENTS.md, la constitución y el plan)

- **Capas** (plan, "Organización por capas"): los endpoints solo validan, aplican la guardia y llaman a la capa de aplicación. El SQL de `guest_access_requests` vive solo en `server/utils/access-requests.ts`; la creación de envíos, solo en `server/utils/guest-submissions.ts`. S3 solo desde `server/utils/storage.ts`. Funciones simples, sin clases.
- **Reglas compartidas una sola vez**: los tiempos, los límites, la cookie, `accessStateOf()` y `TERMINAL_ACCESS_STATES` viven en `shared/constants/access.ts`; los validadores, en `shared/validation/access.ts` (validadores propios del proyecto, no Zod).
- **Endpoints**: los de equipo llaman `requireRole(event, 'editor')` (deja pasar a admins). Los públicos (`/api/public/**`) validan cuerpo y cookie, y aplican el limitador `hitRateLimit` (salvo `GET /api/public/access/current`, una lectura por índice único).
- **Cookie del invitado** (research B1): `cloudy-guest-access`, `httpOnly`, `secure` fuera de dev, `sameSite: 'lax'`, `path: '/'`, `maxAge` 10800 (3 h; se reemite al crear el envío con permiso). El token es `randomBytes(32)` en base64url. El límite por navegador usa otra cookie, `cloudy-guest-device` (mismos atributos, `maxAge` 86400, valor aleatorio de 32 bytes; en el limitador solo su SHA-256) (research B2). En la base solo se guarda `token_hash = SHA-256(token)`; nunca se registra en logs ni en actividad.
- **Sin carreras**: toda transición de una solicitud es un `UPDATE … WHERE status = <origen> AND <vigencia> RETURNING …`; si no devuelve fila, se responde con el estado actual (409/410/403). Las fechas se comparan con `now()` de Postgres, no con el reloj del servidor.
- **Integridad referencial** (research B4): `guest_access_requests.submission_id` solo se escribe **después** de insertar ese envío, en el mismo `db.batch`. Nunca se reserva un id que todavía no existe.
- **Estados del invitado** (data-model, "Estado visible"): `expired` = la solicitud caducó sin atenderse; `accessExpired` = el acceso aprobado venció sin usarse. Cada uno tiene su texto.
- **Privacidad**: del invitado solo nombre (y nota en el envío); la IP solo como `hashSender(ip)`. `/api/public/access/current` nunca devuelve datos del equipo.
- **Interfaz**: textos en español en `app/utils/messages.ts`; los errores HTTP se muestran solo con `serverMessage(error, fallback)` y su texto lo da el servidor, sin duplicarlo en `messages.ts` (contracts/ui.md, "Mensajes que da solo el servidor"); clases semánticas de daisyUI; iconos `lucide:*`; `btn` base (como máximo `lg:btn-sm`); cuatro estados (`SkeletonList`, `EmptyState`, `ErrorState`, contenido); `ConfirmDialog` antes de rechazar; toasts al terminar acciones.
- **Tests**: seleccionan con `getByRole`/`getByLabel`. Los e2e pasan por `signedInAs`/`ensureAccount`/`login` de `test/e2e/setup/fixtures.ts`, y simulan IPs distintas con `x-forwarded-for` como `test/e2e/guest-queue.spec.ts:15`.
- **Agentes**: nada destructivo contra ninguna base ni bucket (AGENTS.md, "No destructive actions"). Las migraciones se aplican con `bun run db:migrate` / `db:migrate:test`; el e2e reinicia solo su rama de pruebas.
- **Definición de hecho por tarea y por fase**: la de AGENTS.md ("Workflow"): typecheck → tests → verificación en navegador al final → reporte.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Comprobar el punto de partida. Los ajustes de configuración van en la historia que los necesita (la redirección en US1, la cabecera de cámara en US2) para que cada historia se despliegue sola.

- [X] T001 Confirmar que la rama activa es `003-public-photos-upload` (`git branch --show-current`) y que `.specify/feature.json` apunta a `specs/003-guest-upload-access-code`. Si la rama no existe o no es la activa, detenerse y pedir a la persona que la cree o cambie a ella; el agente no crea ni cambia de rama.

**Checkpoint**: rama y feature confirmadas.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Modelo de datos, tipos, constantes, validadores, lógica de solicitudes y creación de envíos reutilizable. Ninguna historia empieza antes de terminar esta fase.

### Tests fundacionales (escribir primero, deben fallar)

- [X] T002 [P] Tests unitarios de `shared/constants/access.ts` en `test/unit/access-state.spec.ts`, con fechas fijas: `accessStateOf(null, now)` → `'none'`; `open` con `now <= expiresAt` → `'waiting'` (incluye exactamente igual); `open` con `now > expiresAt` → `'expired'`; `approved` con `now <= accessExpiresAt` → `'approved'`; `approved` vencido → `'accessExpired'`; `rejected` → `'rejected'`; `used` → `'used'`. Las constantes valen exactamente `ACCESS_WAIT_MINUTES = 8`, `ACCESS_WINDOW_MINUTES = 30`, `ACCESS_REQUEST_LIMIT = { limit: 3, windowSec: 1800 }`, `ACCESS_NETWORK_LIMIT = { limit: 30, windowSec: 1800 }`, `ACCESS_SUBMIT_LIMIT = { limit: 5, windowSec: 1800 }`, `ACCESS_COOKIE = 'cloudy-guest-access'`, `ACCESS_DEVICE_COOKIE = 'cloudy-guest-device'` y `TERMINAL_ACCESS_STATES` contiene exactamente `none`, `rejected`, `expired`, `accessExpired` y `used`.
- [X] T003 [P] Tests unitarios de `shared/validation/access.ts` en `test/unit/validation-access.spec.ts`: `accessRequestInput` acepta `{ senderName }` de 1 a 80 caracteres tras recortar espacios y rechaza vacío, solo espacios y 81 caracteres (mismo validador `senderName()` de `shared/validation/submissions.ts`). `permittedSubmissionInput` acepta `{ note?, files }` con `note` ≤ 500 caracteres y `files` de 1 a `MAX_GUEST_FILES` (20); rechaza un `senderName` presente (campo no permitido), 0 archivos y 21 archivos.
- [X] T004 [P] Tests unitarios de `server/utils/access-requests.ts` y `server/utils/guest-submissions.ts` en `test/unit/access-requests.spec.ts` (con `test/unit/helpers/fake-db.ts` o el patrón de `installNitro` que ya usan los tests de API):
  - `issueAccessToken()` devuelve un token base64url de 43 caracteres y `hashAccessToken(token)` un hex SHA-256 de 64; dos llamadas dan tokens distintos.
  - `setAccessCookie(event, token)` fija `cloudy-guest-access` con `httpOnly`, `sameSite=lax`, `path=/`, `Max-Age=10800`, y `secure` salvo en dev. `readAccessTokenHash(event)` devuelve `null` sin cookie y el hash con cookie.
  - `ensureDeviceKey(event)`: sin cookie `cloudy-guest-device` la crea (`Max-Age=86400`) y devuelve el SHA-256 de su valor; con cookie devuelve el mismo hash sin emitir otra.
  - `toGuestAccess(row, now)` nunca incluye `decidedBy` ni otros datos del equipo; `expiresAt` es `expires_at` en `waiting` y `access_expires_at` en `approved`, `null` en los demás.
  - `decideAccessRequest(id, 'approved' | 'rejected', profile)`: con la solicitud `open` y vigente, una sola sentencia actualiza `status`, `decided_by`, `decided_at`, `access_expires_at` (`decided_at + 30 min` solo al aprobar) e inserta en `activity_log` (`access.approve` o `access.reject`, `target_type = 'access_request'`, `target_label` = nombre del invitado, `meta = null`). Si ya estaba decidida, devuelve `{ conflict: { state, decidedBy: { name } | null } }` sin insertar actividad. Si caducó, `{ expired: true }`. Si no existe, `{ notFound: true }`.
  - `createGuestSubmission(event, input, { origin: 'permission', tokenHash })` (research B4): con la solicitud `approved` y vigente, el `db.batch` ejecuta en este orden el `INSERT` condicional del envío (con `sender_name` y `decided_by` de la solicitud, `origin = 'permission'`), el `INSERT` de los archivos y por último el `UPDATE` de `submission_id`; ninguna sentencia escribe `submission_id` antes de que exista el envío. Sin solicitud vigente (`waiting`, `rejected`, `used`, `expired`, `accessExpired`, sin fila) no queda ningún envío, archivo ni `submission_id` nuevo y devuelve `{ denied: state }`. Si `checkUploadFile` rechaza un archivo, no se ejecuta ninguna escritura. Las URLs firmadas solo se generan con el envío creado.
  - `consumeForSubmission(submissionId, tokenHash)` pasa a `used` (con `used_at`) solo desde `approved` con ese `submission_id` y ese `token_hash`; una segunda llamada devuelve `false`.

### Implementación fundacional

- [X] T005 Ampliar `server/db/schema.ts` (data-model.md):
  - Enum nuevo `access_request_status`: `open`, `approved`, `rejected`, `used` ("Caducada" no es un valor: se deriva en `expired` o `accessExpired`).
  - Enum nuevo `submission_origin`: `link`, `permission`.
  - `activity_action` gana `access.approve` y `access.reject` al final de la lista.
  - Tabla `guest_access_requests`: `id uuid` PK `defaultRandom()`; `sender_name text NOT NULL` ("1–80 car."); `sender_key text NOT NULL` ("hashSender(ip): SHA-256 de IP + sal; nunca la IP"); `token_hash text NOT NULL` único; `status access_request_status NOT NULL DEFAULT 'open'`; `created_at timestamptz NOT NULL DEFAULT now()`; `expires_at timestamptz NOT NULL` (`created_at + 8 min`); `decided_by text REFERENCES profiles(user_id) ON DELETE SET NULL`; `decided_at timestamptz`; `access_expires_at timestamptz` ("solo si `approved`: `decided_at + 30 min`"); `submission_id uuid REFERENCES guest_submissions(id) ON DELETE SET NULL` (se escribe solo después de insertar el envío); `used_at timestamptz`.
  - Índices: `guest_access_requests_token_idx` **único** sobre `token_hash`; `guest_access_requests_status_created_idx` sobre `(status, created_at)`.
  - En `guest_submissions`: `origin submission_origin NOT NULL DEFAULT 'link'` y `access_granted_by text REFERENCES profiles(user_id) ON DELETE SET NULL`.
  - Relaciones Drizzle de la tabla nueva con `profiles` (`decided_by`) y `guest_submissions` (`submission_id`), como las existentes.
- [X] T006 Ejecutar `bun run db:generate` y añadir a mano al final del nuevo `drizzle/0004_*.sql` (como en `0003`) los CHECKs: `guest_access_requests_name_length CHECK (char_length(sender_name) BETWEEN 1 AND 80)`; `guest_access_requests_open_undecided CHECK ((status = 'open') = (decided_at IS NULL))`; `guest_access_requests_window CHECK ((status IN ('approved', 'used')) = (access_expires_at IS NOT NULL))`; `guest_access_requests_used CHECK ((status = 'used') = (used_at IS NOT NULL))`. Revisar que la migración solo agrega (ningún `DROP`). Aplicar con `bun run db:migrate` y `bun run db:migrate:test`.
- [X] T007 En `test/e2e/setup/global-setup.ts`, agregar `guest_access_requests` a la lista `TABLES` que se vacía en la rama de pruebas (el `TRUNCATE … CASCADE` no depende del orden). Depende de T006: la tabla debe existir en la rama de pruebas.
- [X] T008 [P] Crear `shared/constants/access.ts` con `ACCESS_WAIT_MINUTES = 8`, `ACCESS_WINDOW_MINUTES = 30`, `ACCESS_REQUEST_LIMIT = { limit: 3, windowSec: 1800 }`, `ACCESS_NETWORK_LIMIT = { limit: 30, windowSec: 1800 }`, `ACCESS_SUBMIT_LIMIT = { limit: 5, windowSec: 1800 }`, `ACCESS_COOKIE = 'cloudy-guest-access'`, `ACCESS_DEVICE_COOKIE = 'cloudy-guest-device'`, `accessStateOf(row: { status, expiresAt, accessExpiresAt } | null, now: Date): AccessState` según la tabla "Estado visible" de data-model.md y `TERMINAL_ACCESS_STATES = ['none', 'rejected', 'expired', 'accessExpired', 'used']`.
- [X] T009 [P] Ampliar `shared/types/api.ts` (data-model, "Tipos compartidos"): `AccessState` (con `expired` y `accessExpired`), `GuestAccess { state; senderName: string | null; expiresAt: string | null }`, `AccessRequest { id; senderName; createdAt; expiresAt }`, `SubmissionOrigin = 'link' | 'permission'`. El tipo de respuesta de `GET /api/dashboard` gana `openAccessRequests: number`. `Submission` gana `origin: SubmissionOrigin` y `accessGrantedBy: { name: string } | null`. `Pulse` gana `openAccessRequests: number` y `newAccessRequests: { id: string, senderName: string, createdAt: string }[]`.
- [X] T010 [P] Crear `shared/validation/access.ts` con `accessRequestInput = object({ senderName })` (reutiliza `senderName` de `shared/validation/submissions.ts`) y `permittedSubmissionInput = object({ note, files: array(guestFile, { min: 1, max: MAX_GUEST_FILES }) })`, reutilizando `note` y `guestFile` del mismo módulo (`guestFile` hoy no se exporta: exportarlo).
- [X] T011 Crear `server/utils/access-requests.ts` (research B1, B3–B5; contracts/api.md) con lo que prueba T004: `issueAccessToken`, `hashAccessToken`, `setAccessCookie`, `readAccessTokenHash`, `ensureDeviceKey`, `findAccessByTokenHash`, `toGuestAccess`, `createAccessRequest(event, senderName)` (inserta con `expires_at = now() + interval '8 minutes'`, emite la cookie y devuelve `GuestAccess`), `listOpenAccessRequests()` (`status = 'open' AND expires_at > now()`, orden `created_at` ascendente, `LIMIT 50`), `decideAccessRequest` (CTE `WITH decided AS (UPDATE … RETURNING …) INSERT INTO activity_log … SELECT … FROM decided`), `permittedSubmissionQueries(tokenHash, submission)` (devuelve, para el `db.batch` de `createGuestSubmission`, el `INSERT … SELECT … FROM guest_access_requests WHERE token_hash = :h AND status = 'approved' AND access_expires_at > now()` del envío y el `UPDATE … SET submission_id = :id … AND EXISTS (envío)` que va al final), `consumeForSubmission`, `openAccessRequestsSql(since?)` (para el pulso y el dashboard) y `purgeStaleAccessRequests()` (borra `rejected`/`used`, `open` con `expires_at`, y `approved` con `access_expires_at`, anteriores a `now() - interval '24 hours'`; devuelve el número de filas). Usa `now()` de Postgres en todas las condiciones de vigencia.
- [X] T012 Extraer `createGuestSubmission(event, input, opts)` a `server/utils/guest-submissions.ts` con el cuerpo actual de `server/api/public/submissions/index.post.ts` **salvo el limitador** (hash de IP, `checkUploadFile`, filas de envío y archivos con `uploadStatus: 'uploading'`, `presignPut`, copia HEIC con `textSourceKeyFor`). `opts` es `{ origin: 'link' }` (nombre del cuerpo, `access_granted_by = null`) o `{ origin: 'permission', tokenHash }`: valida todos los archivos antes de escribir y luego ejecuta un solo `db.batch` con `permittedSubmissionQueries` (envío condicional → archivos con `WHERE EXISTS` → `submission_id`), lee si el envío quedó insertado y, si no, devuelve `{ denied: state }` sin firmar URLs (research B4). Dejar `server/api/public/submissions/index.post.ts` con su `hitRateLimit(event, 'guest:' + senderKey, { limit: 5, windowSec: 3600 })` y luego `createGuestSubmission(event, input, { origin: 'link' })`, con la misma respuesta. Los tests existentes de `test/unit/api-submissions.spec.ts` deben seguir pasando sin cambios.
- [X] T013 Registrar en `test/unit/helpers/nitro.ts` las funciones de `server/utils/access-requests.ts` y `createGuestSubmission`, como ya se registran las de `image-text.ts`.

**Checkpoint**: `bun run typecheck`, `bun run test:unit` (T002–T004 y la suite existente) en verde; migración `0004` aplicada en desarrollo y pruebas.

---

## Phase 3: User Story 1 — El invitado pide acceso, el equipo lo aprueba y el invitado envía sus archivos (Priority: P1) 🎯 MVP

**Goal**: Desde el inicio de sesión, el invitado llega a `/upload`, pide acceso con su nombre y ve en vivo si lo aprueban, rechazan o caduca. Administradores y editores ven el aviso y la solicitud en la página **Solicitudes** (antes "Pendientes") y deciden. Con la solicitud aprobada, el invitado hace **un** envío iniciado en los 30 min siguientes, solo desde su navegador, con "Elegir archivos".

**Independent Test**: Sin sesión, abrir `/login` → "Enviar archivos" → `/upload`, pedir acceso; en otro navegador, un editor ve el toast y el badge en ≤ 5 s y toca "Dar acceso"; en ≤ 5 s la página del invitado muestra el formulario; el invitado sube una foto y el envío aparece en `/solicitudes` con su nombre; volver a enviar → "Tu acceso ya se usó" (quickstart §3, escenarios 1–11, 13 y 14).

### Tests for User Story 1 ⚠️

- [X] T014 [P] [US1] Tests unitarios de pedir acceso y estado en `test/unit/api-access-public.spec.ts` (vía `installNitro`):
  - `POST /api/public/access`: 201 con `{ state: 'waiting', senderName, expiresAt }` y cabecera `Set-Cookie` de `cloudy-guest-access`; 422 con nombre vacío u 81 caracteres; con una cookie de solicitud `waiting` o `approved` devuelve la misma solicitud (200) sin llamar a `hitRateLimit`; sin cookie `cloudy-guest-device` la emite; la cuarta solicitud nueva con la misma cookie de dispositivo en 30 min → 429 con `Retry-After` y `data.scope = 'device'`; con cookies de dispositivo distintas desde la misma IP, las primeras 30 pasan y la 31.ª → 429 con `data.scope = 'network'`.
  - `GET /api/public/access/current`: sin cookie → `{ state: 'none', senderName: null, expiresAt: null }`; con cookie → el estado derivado, incluidos `expired` (solicitud sin atender vencida) y `accessExpired` (aprobada y vencida); la respuesta nunca contiene `decidedBy` ni nombres del equipo; cabecera `Cache-Control: no-store`.
- [X] T015 [P] [US1] Tests unitarios del envío con permiso en `test/unit/api-access-public.spec.ts` (ampliar) y `test/unit/api-submissions.spec.ts`:
  - `POST /api/public/access/submissions` con cookie de solicitud aprobada y vigente → 201 con `{ submissionId, uploads }`, envío con `origin = 'permission'`, `access_granted_by` = quien aprobó, `sender_name` de la solicitud y `submission_id` de la solicitud apuntando a ese envío. Sin cookie → 403 `data.state = 'none'`; `waiting`, `rejected`, `used`, `expired` y `accessExpired` → 403 con `data.state` y el mensaje de contracts/api.md, **sin** ninguna fila nueva ni `submission_id` cambiado. Cuerpo con `senderName` → 422 sin escrituras. Un archivo no admitido → 422 sin escrituras y con la solicitud intacta. La respuesta 201 reemite `cloudy-guest-access` con `Max-Age=10800`. No llama al limitador `guest:` (6 envíos con permiso de solicitudes distintas desde la misma IP en una hora → todos 201); la 6.ª creación con la **misma** solicitud en 30 min → 429 con `Retry-After` (`ACCESS_SUBMIT_LIMIT`).
  - Dos creaciones seguidas con la misma solicitud → la segunda reemplaza `submission_id` (la primera queda sin completar).
  - `POST /api/public/submissions/:id/complete` de un envío `permission`: con la cookie correcta pasa la solicitud a `used`; un segundo `complete` de otro envío de la misma solicitud → 409 con el mensaje "Tu acceso ya se usó. Pide uno nuevo para enviar más archivos" y borra sus objetos y filas (`deleteMany` llamado); sin la cookie → 409 y descarte; un `complete` hecho después de `access_expires_at` (reloj adelantado) con la cookie vigente también pasa a `used`, porque la vigencia solo se comprueba al crear. Un envío `link` completa igual que antes.
  - `POST /api/public/submissions` (abierto) sigue creando `origin = 'link'` con `access_granted_by = null` y sigue aplicando su límite de 5 por hora por IP.
- [X] T016 [P] [US1] Tests unitarios de los endpoints de equipo en `test/unit/api-access-requests.spec.ts`: `GET /api/access-requests` devuelve solo `open` vigentes, la más antigua primero, máximo 50; `POST /api/access-requests/:id/approve` y `/reject` → 204 e insertan actividad; segunda decisión → 409 con `data.state` y `data.decidedBy.name`, y mensaje "{nombre} ya dio acceso a esta persona" o "{nombre} ya rechazó esta solicitud" según `state` ("Alguien del equipo" si no hay nombre); caducada → 410 "La solicitud caducó antes de atenderla"; id inexistente → 404; id no uuid → 404 (`paramId`). Los tres endpoints → 401 sin sesión y 403 con cuenta pendiente.
- [X] T017 [P] [US1] Ampliar `test/unit/api-core.spec.ts` (pulso y dashboard) y `test/unit/api-cron.spec.ts`: el pulso devuelve `openAccessRequests` (solo abiertas vigentes) y `newAccessRequests` creadas después de `since` (vacío sin `since`); `GET /api/dashboard` devuelve `openAccessRequests` (solo abiertas vigentes); el cron borra con `purgeStaleAccessRequests()` las solicitudes terminadas o vencidas hace más de 24 h, conserva las recientes y suma `accessRequests` al resumen.
- [X] T018 [P] [US1] Ampliar `test/unit/endpoint-guards.spec.ts` para que los tres endpoints de `server/api/access-requests/**` exijan `requireRole`, y que los de `server/api/public/access/**` queden en la lista de públicos permitidos.
- [X] T019 [P] [US1] Tests de componente de `/upload` en `test/nuxt/pages-upload.spec.ts` (con `test/nuxt/helpers/api.ts` → `mockApi`): estados cargando (`SkeletonList`), `none` (campo "Tu nombre" con etiqueta y botón "Pedir acceso"; nombre vacío muestra el error sin llamar a la API), `waiting` ("Esperando…", nombre y "Caduca en 8 min"), `approved` (alerta "¡Listo! Ya puedes enviar tus archivos", `GuestUploadForm` con el nombre de solo lectura y "Tienes N min para empezar el envío"), `rejected` ("El equipo no aceptó tu solicitud"), `expired` ("Tu solicitud caducó sin que nadie la atendiera") y `accessExpired` ("Tu acceso caducó antes de empezar el envío"), los tres con "Pedir acceso de nuevo", `used` ("¡Gracias! Recibimos tu envío" y "Pedir acceso para otro envío"), error de red (`ErrorState` con "Reintentar"); 429 con `data.scope = 'device'` muestra "Ya pediste acceso varias veces. Intenta de nuevo en N min" y con `'network'` "Hay muchas solicitudes desde esta red. Intenta de nuevo en N min", a partir de `Retry-After`; al vencer `expiresAt` (temporizadores falsos) pasa de `waiting` a `expired` y de `approved` a `accessExpired` sin esperar al sondeo; 403/409 al enviar muestran el mensaje del servidor con `serverMessage()` y "Pedir acceso de nuevo"; con un envío en curso, al vencer `expiresAt` el formulario sigue visible, la subida termina y el estado final es `used`; la región `role="status"` cambia su texto al pasar de `waiting` a `approved`; el sondeo se detiene en `TERMINAL_ACCESS_STATES`; la página nunca muestra un nombre del equipo.
- [X] T020 [P] [US1] Tests de componente de `AccessRequestCard` y `AccessRequestList` en `test/nuxt/AccessRequestCard.spec.ts`: muestra nombre, "hace N min" y "caduca en N min"; "Dar acceso" (un toque) → POST approve, toast "Diste acceso a {nombre}", emite `decided` y llama `refreshPulse`; "Rechazar" pide confirmación ("¿Rechazar la solicitud de {nombre}?") y solo al confirmar hace POST reject con toast "Rechazaste la solicitud de {nombre}"; 409 → toast `info` con el `message` del servidor tal cual (vía `serverMessage()`, sin texto propio del cliente) y emite `decided`; 410 y 404 → toast de error con el mensaje del servidor y emite `decided`; sin `message` en la respuesta → `messages.access.decideFailed`; los botones se deshabilitan durante la petición. `AccessRequestList` cubre sus cuatro estados (vacío: "Nadie está pidiendo acceso ahora").
- [X] T021 [P] [US1] Tests de componente de `GuestUploadForm` en `test/nuxt/GuestUploadForm.spec.ts` y `test/nuxt/pages-guests.spec.ts` (ampliar): con `senderName` muestra el nombre de solo lectura y envía a `createUrl` sin `senderName` en el cuerpo; sin `senderName` el campo es editable y obligatorio, como hoy en `/enviar`; `/enviar` sigue pasando sus tests existentes.
- [X] T022 [P] [US1] Actualizar los tests que usan Pendientes: en `test/nuxt/pages-guests.spec.ts` y `test/nuxt/four-states.spec.ts` importar `~/pages/solicitudes.vue`, esperar el título "Solicitudes" y los vacíos "No hay envíos por revisar"; en `test/nuxt/AppSidebar.spec.ts`, `a[href="/solicitudes"]` y el badge con la suma de envíos y solicitudes; en `test/nuxt/pages-app.spec.ts`, los textos y enlaces del inicio ("Ver solicitudes", "Solicitudes por atender"). Añadir en `test/nuxt/pages-guests.spec.ts` que `/solicitudes` muestra la sección "Solicitudes de acceso" solo en la pestaña "Por revisar".
- [X] T023 [P] [US1] E2E en `test/e2e/access-upload.spec.ts` (invitado a 360 px, editor a 1280 px, cada invitado con su `x-forwarded-for`):
  - `/login` muestra "Enviar archivos" y lleva a `/upload`; pedir acceso → "Esperando"; recargar `/upload` → sigue en "Esperando" con el mismo nombre (SSR con la cookie) y el editor sigue viendo una sola solicitud.
  - El editor ve el toast "{nombre} pide permiso para enviar archivos" y la solicitud en `/solicitudes` en ≤ 5 s; "Dar acceso" → el invitado ve el formulario en ≤ 5 s sin recargar.
  - El invitado envía `nota.jpg` → confirmación; en `/solicitudes` el envío aparece con su nombre; volver a enviar → "Tu acceso ya se usó…"; otro contexto sin la cookie en `/upload` ve "Pedir acceso".
  - Otra solicitud rechazada → el invitado ve "El equipo no aceptó tu solicitud".
  - Caducidad de la solicitud adelantando `expires_at` con `testSql()` (`UPDATE guest_access_requests SET expires_at = now() - interval '1 second' WHERE id = …`, solo en la rama de pruebas) → "Tu solicitud caducó sin que nadie la atendiera".
  - Caducidad del acceso aprobado adelantando `access_expires_at` con `testSql()` → en el siguiente sondeo, "Tu acceso caducó antes de empezar el envío" con "Pedir acceso de nuevo".
  - Dos editores deciden a la vez → uno ve "{nombre} ya dio acceso a esta persona".
  - Desde el mismo navegador, 4 solicitudes nuevas en 30 min (el editor rechaza cada una) → la 4.ª muestra "Ya pediste acceso varias veces…", y otro contexto con la misma `x-forwarded-for` sí puede pedir.
  - `/actividad` como admin muestra "dio acceso a {nombre}" y "rechazó la solicitud de {nombre}".
- [X] T024 [P] [US1] Ampliar `test/e2e/routes-guard.spec.ts`: `/solicitudes` en `PRIVATE_ROUTES` (sin sesión → `/login`, cuenta pendiente → `/pendiente`); `/upload` accesible sin sesión; `GET /api/access-requests` y los dos POST → 401 sin sesión y 403 con cuenta pendiente; `/pendientes` con sesión redirige a `/solicitudes`. Actualizar `test/e2e/guest-queue.spec.ts` y `test/e2e/responsive-theme.spec.ts` para navegar a `/solicitudes` en lugar de `/pendientes`.

### Implementation for User Story 1

- [X] T025 [P] [US1] Crear `server/api/public/access/index.post.ts` (contracts/api.md): `readValid(event, accessRequestInput)`; si `readAccessTokenHash(event)` apunta a una solicitud en `waiting` o `approved`, devolverla con 200; si no, `hitRateLimit(event, 'access:device:' + ensureDeviceKey(event), ACCESS_REQUEST_LIMIT)` y `hitRateLimit(event, 'access:net:' + hashSender(ip), ACCESS_NETWORK_LIMIT)` (cada 429 con `data: { scope: 'device' | 'network' }`; research B2), y `createAccessRequest` → 201.
- [X] T026 [P] [US1] Crear `server/api/public/access/current.get.ts`: `setResponseHeader(event, 'Cache-Control', 'no-store')`; lee la cookie y devuelve `toGuestAccess(row, now)` o el estado `none`.
- [X] T027 [P] [US1] Crear `server/api/access-requests/index.get.ts` (`requireRole(event, 'editor')` → `listOpenAccessRequests()` como `AccessRequest[]`) y `server/api/access-requests/[id]/approve.post.ts` y `reject.post.ts` (`requireRole`, `paramId`, `decideAccessRequest`; 204, o `createError` 409 con `data: { state, decidedBy }` y mensaje según `state` ("{nombre} ya dio acceso a esta persona" / "{nombre} ya rechazó esta solicitud", "Alguien del equipo" sin nombre; FR-009), 410 "La solicitud caducó antes de atenderla", 404 "La solicitud ya no existe"). Estos textos solo viven aquí (contracts/ui.md).
- [X] T028 [US1] Crear `server/api/public/access/submissions.post.ts` (contracts/api.md): `readValid(event, permittedSubmissionInput)`; `readAccessTokenHash(event)` (sin cookie → 403 `data: { state: 'none' }`); `hitRateLimit(event, 'access:submit:' + tokenHash, ACCESS_SUBMIT_LIMIT)`, **sin** el límite `guest:{senderKey}` del envío abierto (research B2); `createGuestSubmission(event, input, { origin: 'permission', tokenHash })`; si devuelve `{ denied: state }` → `createError` 403 con `data: { state }` y el mensaje de contracts/api.md según el estado; si no → 201 y reemitir `cloudy-guest-access` con `setAccessCookie` (`maxAge` 3 h) para que el `complete` la reciba aunque la subida sea larga.
- [X] T029 [US1] Modificar `server/api/public/submissions/[id]/complete.post.ts` (research B4): si el envío es `origin = 'permission'`, antes de marcar `completed_at` llamar `consumeForSubmission(id, readAccessTokenHash(event))`; si devuelve `false`, borrar los objetos (`storageKey` y `textSourceKey`) y las filas del envío como en el caso "todos rechazados", y lanzar 409 "Tu acceso ya se usó. Pide uno nuevo para enviar más archivos". Los envíos `link` no cambian.
- [X] T030 [US1] Ampliar `server/api/realtime/pulse.get.ts`: dentro del mismo `db.batch`, el conteo de `openAccessRequestsSql()` y, con `since`, las solicitudes abiertas creadas después de `since`; devolver `openAccessRequests` y `newAccessRequests`. Ampliar `server/api/cron/cleanup.get.ts` con `purgeStaleAccessRequests()` y `accessRequests` en el resumen. Ampliar `server/api/dashboard.get.ts` (hoy devuelve `pendingCount`, línea 39) con `openAccessRequests`, usando `openAccessRequestsSql()` dentro del mismo `db.batch`.
- [X] T031 [P] [US1] Agregar a `app/utils/messages.ts` la sección `access` según la tabla "Copy" de contracts/ui.md (`requested`, `granted`, `rejected`, `decideFailed`, `tooMany`, `networkBusy`, `requestFailed`, `submitFailed` y `state.*` con `waiting`, `approved`, `window`, `rejected`, `expired`, `accessExpired`, `used`, `retry`, `another`), y `load.accessRequests`. **No** agregar los textos que da el servidor (409/410/404 de decisión, 403 de envío, 409 de `complete`). Renombrar el copy de "pendientes" en `submissions` y `load` a "Solicitudes" / "envíos por revisar". En `app/utils/activity-labels.ts`, agregar `access.approve` → "dio acceso a", `access.reject` → "rechazó la solicitud de" (FR-011), icono `lucide:door-open`, y sumarlos a `ACTIVITY_ACTIONS`.
- [X] T032 [US1] Crear `app/composables/useGuestAccess.ts` (contracts/ui.md): `useFetch('/api/public/access/current')` con SSR; `state`, `senderName`, `expiresAt`; `request(name)` (POST, maneja 429 con `Retry-After` → `messages.access.tooMany(min)` o, con `data.scope = 'network'`, `messages.access.networkBusy(min)`); `refresh()`; sondeo cada `POLL_INTERVAL_MS` con `useIntervalFn`, pausado si `useDocumentVisibility()` no es `visible` o `useOnline()` es `false`, y detenido en `TERMINAL_ACCESS_STATES`; al vencer `expiresAt` en el cliente pasa a `expired` (desde `waiting`) o `accessExpired` (desde `approved`) sin esperar al sondeo, **salvo** si hay un envío en curso (`holdWhileUploading(active: boolean)`): entonces solo el sondeo cambia el estado (spec, edge case "el acceso caduca mientras sube").
- [X] T033 [US1] Extraer `app/components/guests/GuestUploadForm.vue` de `app/pages/enviar.vue` (props `createUrl`, `senderName?`, `disabled?`; emite `done`) con nombre, nota, `DropZone`, `UploadQueue` y el estado final. Modificar `app/composables/useGuestSubmission.ts` para aceptar `{ createUrl }` (por defecto `/api/public/submissions`) y omitir `senderName` del cuerpo cuando se usa `/api/public/access/submissions`; los errores se muestran con `serverMessage(error, messages.access.submitFailed)`. `app/pages/enviar.vue` queda usando `GuestUploadForm` con el comportamiento de hoy.
- [X] T034 [US1] Crear `app/pages/upload.vue` (`definePageMeta({ layout: 'public', access: 'public' })`, `useHead({ title: 'Subir archivos · Cloudy' })`) con los estados de contracts/ui.md (tabla `/upload`, textos de `messages.access.state.*`), la región `role="status" aria-live="polite"` y `motion-reduce:animate-none` en la animación de espera. En `approved`, montar `GuestUploadForm` con `createUrl="/api/public/access/submissions"` y el `senderName` de la solicitud, y mostrar `messages.access.state.window(min)`. El formulario se muestra si `state === 'approved'` **o** si hay un envío en curso, para no desmontarlo a mitad de la subida: marcar el envío en curso con `holdWhileUploading` desde que se crea hasta `done` o error; en `done` llamar `refresh()` (pasa a `used`). Un 403/409 al enviar muestra el mensaje del servidor y "Pedir acceso de nuevo".
- [X] T035 [P] [US1] En `app/pages/login.vue`, bajo el formulario, agregar un `divider`, el texto "¿Eres invitado?" y un `NuxtLink` `btn btn-outline btn-block` "Enviar archivos" con icono `lucide:cloud-upload` hacia `/upload` (FR-001).
- [X] T036 [P] [US1] Crear `app/components/guests/AccessRequestCard.vue` y `app/components/guests/AccessRequestList.vue` según contracts/ui.md (tabla "Componentes"), con `useRelativeTime`, `useConfirm`, `useToast`, `useApi`, `serverMessage(error, messages.access.decideFailed)` y `refreshPulse()`. Botones `btn btn-primary` "Dar acceso" (un toque) y `btn btn-outline` "Rechazar" (con confirmación), en una fila en móvil, de al menos 44 px (FR-025).
- [X] T037 [US1] `git mv app/pages/pendientes.vue app/pages/solicitudes.vue`. En la página: `h1` y `useHead` "Solicitudes"; arriba un `h2` "Solicitudes de acceso" con `AccessRequestList`, visible solo en la pestaña "Por revisar" y recargada cuando cambia `openAccessRequests` del pulso; debajo un `h2` "Envíos" con lo de antes; pestañas "Por revisar" (antes "Pendientes"), "Aprobados", "Rechazados"; vacíos "No hay envíos por revisar". Conservar el botón "Copiar enlace para invitados" (`useGuestLink`), que sigue copiando el enlace de `/enviar`.
- [X] T038 [US1] En `nuxt.config.ts`, agregar `routeRules: { '/pendientes': { redirect: { to: '/solicitudes', statusCode: 301 } } }` (research B10; FR-024), fusionando con `routeRules` si ya existiera. Depende de T037: la ruta destino debe existir.
- [X] T039 [US1] Actualizar las referencias a Pendientes (plan, "Cambios a la base existente", punto 2): `app/utils/navigation.ts:17` → `{ to: '/solicitudes', label: 'Solicitudes', icon: 'lucide:inbox', roles: TEAM }`; `app/layouts/dashboard.vue:12` → badge `'/solicitudes': pendingCount + openAccessRequests`; `app/pages/index.vue:33-51` → "Ver solicitudes", estadística "Solicitudes por atender" = `pendingCount + openAccessRequests` del dashboard, y enlaces a `/solicitudes`; comentarios en `app/composables/useImageText.ts:7`, `app/components/files/ImageTextPanel.vue:11,15` y `app/components/app/AppSidebar.vue:2`.
- [X] T040 [US1] Ampliar `app/composables/usePulse.ts`: estado compartido `openAccessRequests` (`useState('pulse-access', () => 0)`); en `poll()` asignar `pulse.openAccessRequests` y mostrar `toast.info(messages.access.requested(senderName), { action: { label: 'Ver', to: '/solicitudes' } })` por cada `newAccessRequests`; el toast de envío nuevo (línea 41) también enlaza a `/solicitudes`.

**Checkpoint**: US1 completa y **desplegable sola** (MVP): `bun run typecheck`, `test:unit`, `test:nuxt`, `test:e2e` (access-upload, routes-guard, guest-queue) en verde, y verificación en navegador de quickstart §3 escenarios 1–11, 13 y 14 a 360 px y 1280 px, en ambos temas, con los tiempos objetivo de los escenarios 1 y 5 anotados.

---

## Phase 4: User Story 2 — El invitado toma fotos con la cámara dentro de Cloudy (Priority: P2)

**Goal**: En teléfonos y tabletas, `/upload` (con acceso aprobado) y `/enviar` ofrecen "Abrir cámara" dentro del selector de archivos; las fotos se añaden al envío como cualquier archivo. En computadoras no aparece.

**Independent Test**: En un teléfono, en `/enviar` y en `/upload` aprobado, tomar dos fotos con "Abrir cámara" y enviarlas; verlas en `/solicitudes`. En escritorio, a cualquier ancho, no aparece el botón (quickstart §3 escenario 15 y §4 C1–C8).

### Tests for User Story 2 ⚠️

- [X] T041 [P] [US2] Tests unitarios de `app/utils/camera.ts` en `test/unit/camera-utils.spec.ts`: `photoFileName(new Date('2026-10-29T14:05:09'))` → `'foto-20261029-140509.jpg'`; `cameraErrorKey` mapea `NotAllowedError`/`SecurityError` → `'denied'`, `NotFoundError`/`OverconstrainedError` → `'notFound'`, `NotReadableError`/`AbortError` → `'busy'` y cualquier otro → `'failed'`; `encodeJpeg(canvas)` usa calidad 0.85 y, si el blob pasa de 5 242 880 bytes, reintenta una vez con 0.7 (canvas simulado).
- [X] T042 [P] [US2] Tests de componente de `DropZone` en `test/nuxt/DropZone.spec.ts` (nuevo): sin `camera` no hay botón "Abrir cámara"; con `camera` y `useCameraAvailability` disponible (simulado) aparece dentro de la zona y abrir no dispara el selector de archivos (`@click.stop`); con `camera` y no disponible no aparece; `cameraDisabled` lo deshabilita con la misma indicación de límite que el selector.
- [X] T043 [P] [US2] Tests de componente de `CameraCapture`, `useCameraCapture` y `useCameraAvailability` en `test/nuxt/CameraCapture.spec.ts`, con `navigator.mediaDevices` simulado: abrir pide `getUserMedia` con `video.facingMode = { ideal: 'environment' }` y `audio: false`; muestra "Abriendo la cámara…" y luego el video; "Tomar foto" pasa a revisión con "Repetir" y "Usar foto"; "Repetir" vuelve al video sin emitir; "Usar foto" emite `photo` con un `File` JPEG llamado `foto-….jpg` y anuncia "Foto agregada"; al llegar a `maxPhotos` se cierra y avisa; `NotAllowedError` → texto de `messages.camera.denied` con "Cerrar"; `NotFoundError` → `notFound`; cerrar, ocultar la pestaña o desmontar detiene todas las pistas (`track.stop` llamado); `Esc` cierra y el foco vuelve a "Abrir cámara". `useCameraAvailability`: `true` solo con `(pointer: coarse)` + `getUserMedia` + al menos un `videoinput`; `false` si falta cualquiera (incluido `(pointer: fine)`, el caso del iPad con trackpad aceptado en la spec). Con un `getUserMedia` simulado que devuelve una pista sin `facingMode: 'environment'` (solo cámara frontal), la cámara se abre igual y "Tomar foto" funciona (edge case "solo ofrece cámara frontal"). En `test/nuxt/pages-upload.spec.ts`, si el estado deja de ser `approved` con la cámara abierta, la cámara se cierra.
- [X] T044 [P] [US2] E2E en `test/e2e/camera.spec.ts` (research B12): `setup` con `browserOptions: { type: 'chromium', launch: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } }`. Contexto teléfono (`viewport: viewports.phone`, `hasTouch: true`, `isMobile: true`, `permissions: ['camera']`); si `matchMedia('(pointer: coarse)')` no coincide con esa emulación, inyectarlo con `addInitScript` y anotarlo en un comentario. Casos: `/enviar` en teléfono → "Abrir cámara" → tomar 2 fotos → aparecen 2 `foto-….jpg` en la cola → enviar → el editor ve el envío en `/solicitudes`; `/upload` aprobado en teléfono → foto enviada; `getUserMedia` forzado a `NotAllowedError` con `addInitScript` → mensaje de permiso y "Elegir archivos" sigue funcionando; contexto de escritorio sin táctil a 360 px y a 1280 px → no hay "Abrir cámara" en `/enviar` ni en `/upload`; la respuesta de `/upload` lleva `Permissions-Policy` con `camera=(self)`.

### Implementation for User Story 2

- [X] T045 [P] [US2] En `server/middleware/security-headers.ts`, cambiar `Permissions-Policy` de `camera=()` a `camera=(self)` (el resto: `microphone=(), geolocation=(), payment=(), usb=(), display-capture=()` sin cambios) y actualizar el comentario a "Solo subidas de archivos, reproducción y la cámara de invitados (feature 003): ningún otro sensor ni pago". En `test/unit/api-core.spec.ts`, actualizar la aserción de la cabecera al nuevo valor exacto.
- [X] T046 [P] [US2] Crear `app/utils/camera.ts` con `photoFileName(date)`, `cameraErrorKey(error)` y `encodeJpeg(canvas)` (calidad 0.85, segunda pasada a 0.7 si pasa de 5 242 880 bytes; mismo criterio que `app/utils/heic-copy.ts`). Agregar a `app/utils/messages.ts` la sección `camera` (`open` "Abrir cámara", `opening` "Abriendo la cámara…", `take` "Tomar foto", `retake` "Repetir", `use` "Usar foto", `close` "Cerrar cámara", `added(n)` "{n} fotos agregadas", `limit` (límite de archivos), `denied` "Cloudy no tiene permiso para usar la cámara. Actívalo en los ajustes del navegador o usa «Elegir archivos»", `notFound` "No encontramos una cámara en este dispositivo", `busy` "Otra app está usando la cámara", `failed` "No pudimos abrir la cámara. Usa «Elegir archivos»").
- [X] T047 [P] [US2] Crear `app/composables/useCameraAvailability.ts` (research B9): `useMediaQuery('(pointer: coarse)')`, `useSupported(() => !!navigator.mediaDevices?.getUserMedia)` y, en `onMounted`, `navigator.mediaDevices.enumerateDevices()` con al menos un `kind === 'videoinput'`; devuelve `available: ComputedRef<boolean>`, `false` en SSR.
- [X] T048 [US2] Crear `app/composables/useCameraCapture.ts` (research B8) con `useUserMedia({ enabled: false, constraints: { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false } })`; `start()` (atrapa el error y lo expone como `errorKey` con `cameraErrorKey`), `stop()`, y `capture(video: HTMLVideoElement): Promise<File>` (canvas al tamaño real de la pista → `encodeJpeg` → `new File([blob], photoFileName(new Date()), { type: 'image/jpeg' })`). Detener cuando `useDocumentVisibility()` deja de ser `visible`.
- [X] T049 [US2] Crear `app/components/upload/CameraCapture.vue` según contracts/ui.md ("CameraCapture"): `<dialog class="modal">` a pantalla completa en móvil (`h-dvh`) y centrado en `lg:`; `<video autoplay muted playsinline>`; botón de disparo circular ≥ 64 px con `aria-label="Tomar foto"` y "Cerrar cámara" ≥ 44 px; vista de revisión con `useObjectUrl` y "Repetir"/"Usar foto"; contador "N fotos agregadas"; estados de carga y error; `aria-live="polite"`; foco inicial en "Tomar foto" y retorno al botón que lo abrió; `Esc` cierra; detiene el stream al cerrar y al desmontar. Props `open`, `maxPhotos`; emite `photo` y `close`.
- [X] T050 [US2] Modificar `app/components/upload/DropZone.vue`: props `camera?: boolean` (default `false`) y `cameraDisabled?: boolean`; si `camera` y `useCameraAvailability().available`, mostrar dentro de la zona un `btn btn-outline` con `lucide:camera` y el texto "Abrir cámara" (`@click.stop`), y montar `LazyCameraCapture` al abrirlo; cada `photo` se emite por el mismo evento `files` como `[file]`. Reservar el espacio del botón para no mover el diseño al hidratar. `UploadDialog.vue` (equipo) no pasa `camera`.
- [X] T051 [US2] En `app/components/guests/GuestUploadForm.vue`, pasar `camera` a `DropZone` y `:camera-disabled` cuando la cola llega a `MAX_GUEST_FILES`, con `maxPhotos` = espacio restante (así `/upload` y `/enviar` ganan el botón). En `app/pages/upload.vue`, si el estado deja de ser `approved` con la cámara abierta, cerrarla (FR-016c).

**Checkpoint**: US1 + US2 funcionan y US2 se despliega sola sobre el MVP: `bun run typecheck`, `test:unit`, `test:nuxt`, `test:e2e` (camera, access-upload) en verde; verificación en navegador de quickstart §3 escenario 15 y, en un teléfono real por túnel HTTPS, §4 C1–C8 con el tiempo objetivo de C2 anotado.

---

## Phase 5: User Story 3 — Administradores y editores revisan lo enviado con su origen (Priority: P3)

**Goal**: En Solicitudes, cada envío muestra su origen ("Por enlace" o "Por permiso") sin abrirlo y, si llegó por permiso, quién aprobó el acceso. Aprobar y rechazar envíos funciona igual que hoy.

**Independent Test**: Con un envío por permiso y otro por enlace en la cola, el editor distingue ambos por su insignia (también a 360 px), ve "Acceso aprobado por {editor}" en el primero y lo aprueba en una carpeta; el archivo aparece allí con origen "invitado" (quickstart §3, escenarios 5 y 12).

### Tests for User Story 3 ⚠️

- [X] T052 [P] [US3] Tests unitarios en `test/unit/api-submissions.spec.ts` (ampliar): `GET /api/submissions` devuelve `origin` y `accessGrantedBy: { name }` para envíos `permission` y `null` para `link`; si el perfil aprobador ya no existe, `accessGrantedBy` es `null`; la lista hace una sola consulta de envíos con `LEFT JOIN profiles` (sin una consulta por envío). Aprobar y rechazar un envío `permission` se comporta igual que uno `link`.
- [X] T053 [P] [US3] Tests de componente de `SubmissionCard` en `test/nuxt/pages-guests.spec.ts` (ampliar): envío `link` → insignia con icono y texto "Por enlace"; `permission` → "Por permiso" y la línea "Acceso aprobado por {nombre}"; `accessGrantedBy: null` en un envío `permission` → "Acceso aprobado por una persona del equipo"; las insignias tienen texto visible (no dependen del color).
- [X] T054 [P] [US3] E2E en `test/e2e/guest-queue.spec.ts` (ampliar): con un envío desde `/enviar` y otro desde `/upload` aprobado, en `/solicitudes` a 360 px cada tarjeta muestra su insignia; el de permiso dice "Acceso aprobado por {editor}"; aprobarlo en una carpeta deja el archivo allí con origen invitado y el nombre del remitente.

### Implementation for User Story 3

- [X] T055 [US3] Ampliar `server/utils/submissions.ts`: `listSubmissions` hace `LEFT JOIN profiles ON profiles.user_id = guest_submissions.access_granted_by` en la misma consulta y `toSubmission` devuelve `origin` y `accessGrantedBy: row.grantedByName ? { name: row.grantedByName } : null`.
- [X] T056 [US3] Modificar `app/components/guests/SubmissionCard.vue`: junto al nombre del remitente, `badge badge-outline` con `lucide:link` + "Por enlace" o `lucide:shield-check` + "Por permiso"; en envíos `permission`, la línea "Acceso aprobado por {nombre}" (o "por una persona del equipo"). Que la insignia no desborde a 360 px.

**Checkpoint**: las tres historias funcionan juntas; `bun run typecheck`, `test:unit`, `test:nuxt`, `test:e2e` en verde; verificación en navegador de la cola con ambos orígenes a 360 px y 1280 px, ambos temas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T057 [P] Actualizar `AGENTS.md` (plan, "Cambios a la base existente", punto 6): en "Rules by principle" I, las cookies `cloudy-guest-access` y `cloudy-guest-device` (límite por navegador + tope por red + `ACCESS_SUBMIT_LIMIT` por solicitud) y el sondeo de `/upload`; en "Known gotchas", `Permissions-Policy` con solo `camera=(self)`, que `getUserMedia` exige HTTPS (túnel para probar desde un teléfono en dev), que la e2e de cámara usa las banderas de Chromium y que `submission_id` se escribe después de insertar el envío (FK no diferible); mencionar las rutas `/upload` y `/solicitudes`. No tocar `.claude/settings.json` ni los hooks.
- [X] T058 [P] Accesibilidad (skill `accessibility`): revisar `/upload`, `CameraCapture`, `AccessRequestCard` y las insignias con teclado y lector de pantalla en ambos temas: contraste ≥ 4.5:1 (sin `text-warning` sobre `base-100` en el tema claro), foco visible, nombres accesibles y anuncios de `aria-live`. Corregir lo que falle con su test.
- [X] T059 Rendimiento: `bun run analyze` y confirmar que el JS inicial de `/upload`, `/enviar` y `/solicitudes` sigue ≤ 200 KB gzip y que `CameraCapture` está en un chunk diferido (quickstart §5). Registrar los números en el reporte de la fase.
- [X] T060 Buscar referencias sueltas con `grep -rn "pendientes" app server shared test` y dejar solo las que hablan del estado interno `pending` del envío o de la página de cuenta `/pendiente`.
- [X] T061 Suite completa y cobertura: `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:nuxt`, `bun run test:e2e` y `bun run test:coverage` (umbral 92 % en statements, branches, functions y lines). Corregir sin debilitar tests.
  - Resultado (2026-10-30): typecheck 0 errores · build OK · unit 716/716 · nuxt 377/377 · e2e 101/101 · cobertura 98,23 % statements, 93,09 % branches, 95,16 % functions, 98,76 % lines. Corregido: `/archivos/<carpeta>` con 200 elementos medía LCP 3,4–5,7 s (TTFB hasta 5 s) y SC-002 llegaba a 6,1–6,2 s. Ahora `children.get` hace un solo `db.batch` (antes cuatro consultas HTTP en paralelo, cada una con su conexión) y el pulso lee el perfil en el mismo batch que sus conteos (perfil diferido en `server/middleware/session.ts`). Desde esta estación cada conexión TLS nueva de Node a Neon cuesta ~1,2 s (una reutilizada ~75 ms), así que las pruebas con 5 s de sondeo + 1 s de margen (SC-002, comentarios) y el LCP de la carpeta (2,5 s en la última corrida) siguen al límite en este laboratorio: en una corrida completa falló una vez `comments.spec` y pasó al repetirla.
- [X] T062 Verificación final en navegador (skill `agent-browser`) contra `bun run dev` con datos de `.env.development`: todos los escenarios de quickstart §3 a 360 px y 1280 px, temas oscuro y claro, estados de carga, vacío, error y contenido, foco con teclado y consola sin errores. **Cronometrar** los criterios con tiempo objetivo y anotar la medición: SC-001 (de `/login` a "Esperando" < 30 s, escenario 1), SC-003 (de ver el formulario a la confirmación < 1 min, escenario 5), SC-007 (de "Abrir cámara" a la foto en la cola < 15 s, §4 C2, en teléfono real), además de SC-002 y SC-005 (siguiente ciclo de sondeo, < 6 s). Reportar lo que corrió, lo que se omitió y por qué, antes de marcar la feature como terminada.
  - Marcada por decisión de la persona (2026-10-30): la verificación la hace ella misma en navegador y en su teléfono (incluido SC-007). El agente no ejecutó esta verificación ni cronometró SC-001/002/003/005/007.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Setup; bloquea todas las historias.
- **US1 (Phase 3)**: depende de Foundational. Es el MVP y se despliega sola.
- **US2 (Phase 4)**: depende de US1 (la cámara se monta en `GuestUploadForm`, que US1 extrae, y en `/upload`). Se despliega sola sobre el MVP. Sus tests e2e de `/upload` necesitan una solicitud aprobada, que se aprueba desde la UI de US1.
- **US3 (Phase 5)**: depende de Foundational (`origin`, `access_granted_by`) y, para ver un envío "Por permiso" de punta a punta, de US1. Es independiente de US2. Sus tests unit y de componente no necesitan US1.
- **Polish (Phase 6)**: después de las historias que se vayan a entregar.

### Dependencias clave dentro de las fases

- T005 → T006 (generar y aplicar la migración) → T007 (global-setup), T011, T012.
- T008, T009, T010 → T011 → T012 → T025–T030.
- T012 → T028 (crear envío con permiso) y T033 (el formulario lo usa a través de la API).
- T031 → T032–T040 (copy).
- T032 → T034; T033 → T034 (el formulario se monta en `/upload`).
- T037 (mover la página) → T038 (redirección), T039, T040 y T022.
- T046 → T048 → T049 → T050 → T051; T047 → T050.
- T055 → T056.
- Dentro de cada historia: los tests (marcados ⚠️) se escriben primero y deben fallar.

### Parallel Opportunities

- Foundational: los tests T002–T004; luego T008, T009, T010 en paralelo.
- US1: todos los tests T014–T024 en paralelo; T025, T026, T027, T031, T035, T036 en paralelo.
- US2: tests T041–T044 en paralelo; T045, T046 y T047 en paralelo.
- US3: T052–T054 en paralelo; US3 completa puede ir en paralelo con US2.
- Polish: T057 y T058 en paralelo.

---

## Parallel Example: User Story 1

```text
# Tests (archivos distintos):
T014 test/unit/api-access-public.spec.ts
T016 test/unit/api-access-requests.spec.ts
T019 test/nuxt/pages-upload.spec.ts
T020 test/nuxt/AccessRequestCard.spec.ts
T023 test/e2e/access-upload.spec.ts

# Implementación sin dependencias entre sí:
T025 server/api/public/access/index.post.ts
T026 server/api/public/access/current.get.ts
T027 server/api/access-requests/**
T035 app/pages/login.vue
T036 app/components/guests/AccessRequestCard.vue + AccessRequestList.vue
```

## Parallel Example: User Story 2

```text
T045 server/middleware/security-headers.ts
T046 app/utils/camera.ts  +  T047 useCameraAvailability.ts  →  T048 → T049 → T050 → T051
```

## Parallel Example: User Story 3

```text
T052 test/unit/api-submissions.spec.ts
T053 test/nuxt/pages-guests.spec.ts
T054 test/e2e/guest-queue.spec.ts
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 + Phase 2.
2. Phase 3 (US1): el invitado pide acceso, el equipo decide en Solicitudes, el invitado ve el resultado en vivo y hace su envío con permiso.
3. **Parar y validar** US1 con la definición de hecho de AGENTS.md → desplegar el MVP.

### Incremental Delivery

1. US1 → validar → desplegar (MVP).
2. US2 → cámara en `/upload` y `/enviar` → validar (incluido un teléfono real por túnel HTTPS) → desplegar.
3. US3 → origen y aprobador visibles en la cola → validar → desplegar (puede ir antes que US2).
4. Polish → documentación, accesibilidad, rendimiento, tiempos objetivo y suite completa.

### Notes

- [P] = archivos distintos, sin dependencias pendientes.
- Las tareas que tocan migraciones o la base de pruebas siguen la regla de AGENTS.md: nada destructivo fuera del reinicio propio del e2e.
- Hacer commit solo cuando la persona lo pida, con Conventional Commits.
