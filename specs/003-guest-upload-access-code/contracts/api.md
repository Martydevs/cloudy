# Contrato de API: Subida de invitados con aprobación de acceso

**Feature**: [spec.md](../spec.md) · **Modelo**: [data-model.md](../data-model.md)

Convenciones existentes: validación con `readValid`/`queryValid`/`paramId` (`server/utils/validation.ts`), errores
`createError` con `message` en español (el cliente siempre usa `serverMessage()`), 429 con `Retry-After`.
Los endpoints públicos viven bajo `/api/public/**`, donde `server/middleware/session.ts` no resuelve sesión.

## Públicos (invitado, sin sesión)

### `POST /api/public/access`: pedir acceso (FR-003, FR-004, FR-006)

- **Body**: `{ senderName: string }` (1–80, `senderName()`).
- **Flujo**:
  1. Si la cookie `cloudy-guest-access` apunta a una solicitud en estado `waiting` o `approved`, responde esa
     (200) sin crear otra ni contar en el limitador.
  2. Límites (research B2): lee o crea la cookie `cloudy-guest-device`; `hitRateLimit(event, 'access:device:' +
     deviceKey, ACCESS_REQUEST_LIMIT)` y `hitRateLimit(event, 'access:net:' + senderKey, ACCESS_NETWORK_LIMIT)`
     → 429 + `Retry-After` + `data: { scope: 'device' | 'network' }`.
  3. Inserta la solicitud (`expires_at = now() + 8 min`), genera el token y fija la cookie (research B1).
- **201** → `GuestAccess` (`state: 'waiting'`). **422** nombre inválido. **429** límite.

### `GET /api/public/access/current`: estado en vivo (FR-013)

- Sin body. Lee la cookie; sin cookie o sin fila → `{ state: 'none', senderName: null, expiresAt: null }`.
- **200** → `GuestAccess`. Nunca incluye `decided_by` ni datos del equipo.
- `Cache-Control: no-store`. Sin limitador (una lectura por índice único cada 5 s).

### `POST /api/public/access/submissions`: crear envío con permiso (FR-014, FR-015, FR-016, FR-017)

- **Body**: igual que `POST /api/public/submissions` **sin** `senderName` (se toma de la solicitud):
  `{ note?: string, files: GuestFileInput[] }`.
- **Flujo** (research B4):
  1. `readValid(event, permittedSubmissionInput)`; sin cookie → 403 `data: { state: 'none' }`.
  2. `hitRateLimit(event, 'access:submit:' + tokenHash, ACCESS_SUBMIT_LIMIT)` → 429 + `Retry-After`. **Sin** el
     límite `guest:{senderKey}` del envío abierto (research B2).
  3. `createGuestSubmission(event, input, { origin: 'permission', tokenHash })`: valida los archivos sin escribir y,
     en un solo `db.batch`, inserta el envío de forma condicional (toma `sender_name` y `decided_by` de la solicitud
     aprobada y vigente), luego sus archivos y al final `submission_id` en la solicitud. La FK siempre apunta a una
     fila que ya existe.
  4. Si el envío no se insertó → **403** con `data: { state }` y el mensaje según el estado: `accessExpired` →
     "Tu acceso caducó. Pide acceso de nuevo"; `used` → "Tu acceso ya se usó. Pide uno nuevo para enviar más
     archivos"; `waiting` → "Tu solicitud todavía no está aprobada"; `rejected`/`expired`/`none` → "Necesitas
     pedir acceso para enviar archivos". No se escribe nada.
  5. Reemite la cookie `cloudy-guest-access` con `maxAge` 3 h para que el `complete` la reciba aunque la subida sea
     larga.
- **201** → `{ submissionId, uploads: GuestUploadTicket[] }` (idéntico al endpoint abierto). **403**, **422**
  (cuerpo inválido o con `senderName`), **429**.

### `POST /api/public/submissions/:id/complete` (existente, modificado)

- Si el envío es `origin = 'permission'`: exige la cookie y, antes de marcar `completed_at`, ejecuta
  `UPDATE … SET status = 'used', used_at = now() WHERE submission_id = :id AND token_hash = :h AND status =
  'approved' RETURNING id`. Sin fila → **409** "Tu acceso ya se usó. Pide uno nuevo para enviar más archivos", y se
  descartan los objetos y filas del envío.
  Nota: el mismo 409 aparece si el invitado creó otro envío con la misma solicitud después de este (la reserva pasó
  al envío más reciente). La interfaz no provoca este caso; se acepta el mensaje genérico.
- `origin = 'link'`: sin cambios.

### `POST /api/public/submissions` (existente)

- Sin cambios de contrato; aplica su límite `guest:{senderKey}` (5 por hora) y llama a
  `createGuestSubmission(event, input, { origin: 'link' })`.

## Equipo (`requireRole(event, 'editor')`: administradores y editores activos)

### `GET /api/access-requests`: solicitudes abiertas (FR-008)

- **200** → `AccessRequest[]`: `status = 'open' AND expires_at > now()`, orden `created_at` ascendente
  (la más antigua arriba, porque caduca antes), máximo 50.

### `POST /api/access-requests/:id/approve` · `POST /api/access-requests/:id/reject` (FR-009–FR-011)

- Sin body.
- Una sentencia: `UPDATE` condicionado (`status = 'open' AND expires_at > now()`) + `INSERT` en `activity_log`
  dentro de un CTE (research B5).
- **204** si la decisión ganó.
- **409** si ya estaba decidida → `data: { state: 'approved' | 'rejected' | 'used', decidedBy: { name } | null }`,
  mensaje según `state` (FR-009): `approved`/`used` → "{nombre} ya dio acceso a esta persona"; `rejected` →
  "{nombre} ya rechazó esta solicitud" ("Alguien del equipo" si `decidedBy` es `null`). El servidor es la única
  fuente de este texto: el cliente lo muestra con `serverMessage()` (AGENTS.md, VI).
- **410** si caducó → mensaje "La solicitud caducó antes de atenderla".
- **404** si no existe (ya limpiada).

### `GET /api/realtime/pulse` (existente, ampliado; FR-007)

Suma al `Pulse`:
- `openAccessRequests: number`: abiertas y vigentes.
- `newAccessRequests: { id, senderName, createdAt }[]`: abiertas creadas después de `since` (vacío sin `since`).

Las dos consultas nuevas (conteo y nuevas desde `since`) van en el mismo `db.batch` existente; usan
`guest_access_requests_status_created_idx`.

### `GET /api/dashboard` (existente, ampliado; FR-007, FR-023)

Suma `openAccessRequests: number` (abiertas y vigentes) con `openAccessRequestsSql()` dentro del mismo `db.batch`,
para la estadística "Solicitudes por atender" del inicio (`pendingCount + openAccessRequests`).

### `GET /api/submissions` (existente, ampliado; FR-020, FR-022)

Cada `Submission` suma `origin` y `accessGrantedBy: { name } | null` (un `LEFT JOIN profiles` en la misma
consulta de `listSubmissions`, sin N+1).

### `GET /api/cron/cleanup` (existente, ampliado)

Borra las solicitudes terminadas o vencidas hace más de 24 h (data-model, "Retención") y suma
`accessRequests: number` al resumen.

## Cabeceras

`server/middleware/security-headers.ts`: `Permissions-Policy` pasa de `camera=()` a `camera=(self)`. Sin otros cambios.

## Redirección

`nuxt.config.ts` → `routeRules['/pendientes'] = { redirect: { to: '/solicitudes', statusCode: 301 } }` (FR-024).
