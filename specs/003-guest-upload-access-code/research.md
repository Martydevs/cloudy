# Research: Subida de invitados con aprobación de acceso

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Fecha**: 2026-10-29

Cada decisión resuelve una incógnita del Technical Context. Formato: Decisión · Razón · Alternativas.
Las referencias `archivo:línea` son del estado del repositorio el 2026-10-29 (rama `003-guest-upload-access-code`).

## B1. Cómo se liga la solicitud al navegador del invitado (FR-004, FR-014, FR-017)

- **Decisión**: al crear la solicitud, el servidor genera un token aleatorio de 32 bytes (`randomBytes`,
  base64url) y lo envía en la cookie `cloudy-guest-access` (`httpOnly`, `secure` fuera de dev, `sameSite: 'lax'`,
  `path: '/'`, `maxAge` 3 h: 8 min de espera + 30 min para empezar + hasta ~2 h de subida de 20 archivos de 100 MB
  por 4G, para que el `complete` no llegue sin cookie y descarte el envío). En la base solo se guarda `token_hash = SHA-256(token)` con índice único. Toda
  operación pública de la solicitud (consultar estado, crear el envío, completarlo) busca por el hash de la cookie.
- **Razón**: cumple "solo en el navegador que hizo la solicitud" sin cuentas ni datos personales: el token no
  identifica a la persona y en la base solo vive su hash (como `hashSender` con la IP, `server/utils/rate-limit.ts:16`).
  `httpOnly` evita que un script lo lea; `sameSite: 'lax'` impide que otro sitio dispare los POST con la cookie
  (CSRF). `path: '/'` hace que el SSR de `/upload` reciba la cookie y pinte el estado en la primera vista
  (Constitución I).
- **Alternativas**: id de la solicitud en `localStorage` (cualquiera que lo copie a otro navegador podría usarlo;
  y no llega al SSR); huella del dispositivo (frágil e invasiva); IP con sal (cambia en redes móviles y la
  comparten todos en el wifi de la iglesia).

## B2. Límite de solicitudes por navegador y por red (FR-006)

- **Decisión**: dos límites con el mismo limitador de ventana fija en Postgres que usan los envíos
  (`server/utils/rate-limit.ts:24`):
  - **Por navegador**: `hitRateLimit(event, 'access:device:' + SHA-256(deviceId), ACCESS_REQUEST_LIMIT)`
    (3 cada 30 min). `deviceId` es un valor aleatorio de 32 bytes en una segunda cookie, `cloudy-guest-device`
    (`httpOnly`, `secure` fuera de dev, `sameSite: 'lax'`, `path: '/'`, `maxAge` 24 h), que se crea si no existe.
    Es independiente de `cloudy-guest-access` porque esa cambia con cada solicitud.
  - **Por red**: `hitRateLimit(event, 'access:net:' + hashSender(ip), ACCESS_NETWORK_LIMIT)` (30 cada 30 min),
    tope contra el spam.
  - El 429 lleva `Retry-After` y `data.scope: 'device' | 'network'`; la página Subir muestra
    `messages.access.tooMany(min)` o `messages.access.networkBusy(min)`.
  - Los envíos con permiso no aplican el límite `guest:{senderKey}` (5 por hora por IP) del envío abierto: la
    aprobación del equipo ya es el control, y en el wifi de la iglesia bloquearía a invitados aprobados. En su
    lugar, `hitRateLimit(event, 'access:submit:' + tokenHash, ACCESS_SUBMIT_LIMIT)` (5 creaciones cada 30 min por
    solicitud aprobada) evita que un navegador aprobado genere filas y URLs firmadas sin límite; la clave es el hash
    del token, que no identifica a nadie y no se comparte entre invitados.
- **Razón**: con solo la IP, todos los invitados del wifi de la iglesia (o de una red móvil con CGNAT) comparten
  el límite y el 4.º quedaría bloqueado 30 min. La cookie se puede borrar, pero el tope por red acota el abuso y
  cada solicitud necesita que alguien del equipo la apruebe y caduca sola a los 8 min. Pedir de nuevo con una
  solicitud viva en la cookie no cuenta: el endpoint devuelve la existente (idempotente) antes de tocar el limitador.
- **Alternativas**: solo IP (bloquea redes compartidas); solo cookie (se evade sin límite); subir solo el tope por
  IP (un teléfono podría pedir acceso decenas de veces); ventana deslizante (más SQL sin beneficio a esta escala).

## B3. Caducidad sin trabajos programados (FR-005, FR-015)

- **Decisión**: la caducidad se **deriva** al leer, no la escribe un proceso:
  - `expires_at = created_at + 8 min` (espera de aprobación).
  - `access_expires_at = decided_at + 30 min` (solo si se aprueba).
  - Estado visible = `expired` si `status = 'open'` y `now() > expires_at` (nadie la atendió), o `accessExpired`
    si `status = 'approved'`, `now() > access_expires_at` y no se ha usado. Son dos estados para que el invitado
    lea "Tu solicitud caducó" o "Tu acceso caducó" según el caso (spec, US1 escenario 10; FR-018). Las acciones del equipo y del invitado usan `UPDATE … WHERE`
    con esas mismas condiciones, así que una solicitud vencida nunca se aprueba ni habilita un envío.
  - El cron diario (`server/api/cron/cleanup.get.ts`) borra las solicitudes terminadas o vencidas hace más de 24 h.
- **Razón**: Vercel Cron de Hobby no corre cada minuto y Constitución "funciones sin estado": no hay temporizadores.
  Derivar el estado es exacto al segundo y no requiere escritura.
- **Alternativas**: cron cada minuto (no disponible / costo); marcar `expired` en cada lectura (escrituras inútiles).

## B4. "Un solo envío" sin consumir el acceso si la subida falla (FR-015, edge case de reintento)

- **Decisión**: dos pasos atómicos.
  1. **Crear** (`POST /api/public/access/submissions`): primero se validan los archivos (`checkUploadFile`) sin
     escribir nada. Luego, en un solo `db.batch` (transacción en `neon-http`) y en este orden:
     1. `INSERT INTO guest_submissions (id, sender_name, …, origin, access_granted_by) SELECT :id, sender_name, …,
        'permission', decided_by FROM guest_access_requests WHERE token_hash = :h AND status = 'approved' AND
        access_expires_at > now()`: inserta 0 o 1 fila.
     2. `INSERT` de las filas de archivos con `WHERE EXISTS (SELECT 1 FROM guest_submissions WHERE id = :id)`.
     3. `UPDATE guest_access_requests SET submission_id = :id WHERE token_hash = :h AND status = 'approved' AND
        access_expires_at > now() AND EXISTS (SELECT 1 FROM guest_submissions WHERE id = :id)`.

     El envío se inserta **antes** de apuntarle desde `submission_id`, así que la FK nunca falla. Si la solicitud no
     está vigente, ninguna sentencia escribe: se lee el estado actual y se responde 403. Solo con el envío creado se
     firman las URLs (`presignPut`). Un reintento reemplaza `submission_id`; el envío anterior sin completar queda
     como huérfano y lo borra la limpieza existente (pendientes sin `completed_at` > 24 h).
  2. **Completar** (`POST /api/public/submissions/:id/complete`, existente): si el envío es `origin = 'permission'`,
     antes de marcarlo completo hace `UPDATE … SET status = 'used', used_at = now() WHERE submission_id = :id AND
     status = 'approved' AND token_hash = :h RETURNING id`. Sin fila → 409 "Tu acceso ya se usó" y se descarta el
     envío (objetos y filas), igual que hoy con un envío sin archivos válidos.
- **Razón**: la vigencia se comprueba solo al iniciar (spec: "la vigencia solo se comprueba al iniciar un envío"),
  un fallo de red no gasta el acceso y nunca hay dos envíos completos por solicitud.
- **Alternativas**: marcar `used` al crear (un fallo de subida obliga a pedir acceso otra vez); transacción
  interactiva (el driver `neon-http` solo ofrece `batch`, sin lógica entre sentencias); reservar `submission_id`
  antes de insertar el envío (viola la FK, que no es diferible, y deja la solicitud apuntando a un id inexistente si
  la creación falla).

## B5. Aprobar o rechazar sin carreras y con actividad atómica (FR-009, FR-010, FR-011)

- **Decisión**: una sola sentencia con CTE:
  `WITH decided AS (UPDATE guest_access_requests SET status = :s, decided_by = :uid, decided_at = now(),
  access_expires_at = CASE WHEN :s = 'approved' THEN now() + interval '30 minutes' END WHERE id = :id AND
  status = 'open' AND expires_at > now() RETURNING id, sender_name) INSERT INTO activity_log (…) SELECT … FROM
  decided RETURNING …`. Sin fila → se lee la solicitud y se responde 409 con `{ state, decidedBy: { name } }`
  (o 410 si caducó) para que la UI diga "Ya la atendió {nombre}".
- **Razón**: la actividad solo se escribe si la decisión ganó; mismo espíritu que `approve.post.ts` (UPDATE
  condicionado + INSERT dependiente en un lote) pero sin depender del orden del lote.
- **Alternativas**: `db.batch([update, activityInsert])` (insertaría actividad aunque el UPDATE no gane).

## B6. Aviso en vivo al equipo y estado en vivo del invitado (FR-007, FR-013, SC-002, SC-005)

- **Decisión**:
  - **Equipo**: se amplía el pulso existente (`server/api/realtime/pulse.get.ts`, sondeo cada 5 s en
    `app/composables/usePulse.ts`) con `openAccessRequests` (conteo) y `newAccessRequests` (creadas después del
    cursor). `usePulsePolling` muestra un toast por cada nueva ("{nombre} pide permiso para enviar archivos",
    acción "Ver" → `/solicitudes`). El contador de la barra lateral es `pendingCount + openAccessRequests`.
  - **Invitado**: `GET /api/public/access/current` sondeado cada 5 s con `useIntervalFn`, pausado con
    `useDocumentVisibility`/`useOnline` (mismo patrón que `usePulsePolling`). Se detiene en estados terminales.
    Responde solo estado y vencimientos, nunca nombres del equipo.
- **Razón**: Constitución "tiempo real = sondeo cada 5 s"; la consulta usa los índices `(status, created_at)` y el
  único de `token_hash`. `NUXT_NEON_REALTIME_*` queda fuera de alcance (AGENTS.md).
- **Alternativas**: SSE/WebSocket (las funciones de Vercel no mantienen conexiones; servicio nuevo).

## B7. Origen y quién dio acceso en los envíos (FR-019, FR-020, FR-022)

- **Decisión**: dos columnas nuevas en `guest_submissions`: `origin submission_origin NOT NULL DEFAULT 'link'`
  (`'link' | 'permission'`) y `access_granted_by text REFERENCES profiles` (copiado de `decided_by` al crear el
  envío). El DTO `Submission` suma `origin` y `accessGrantedBy: { name } | null`.
- **Razón**: la solicitud se borra a las 24 h (B3) pero el envío vive hasta 7 días; copiar el aprobador evita una
  FK que impida limpiar. Los envíos existentes quedan `link` por el default, que es correcto.
- **Alternativas**: FK `access_request_id` (obliga a conservar solicitudes mientras viva el envío).

## B8. Cámara dentro de Cloudy (FR-016a–FR-016e)

- **Decisión**:
  - **Stream**: `useUserMedia` de VueUse (ya instalado vía `@vueuse/nuxt` 15) con
    `{ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }`.
    `ideal` prefiere la trasera y cae a la frontal si no hay otra (edge case "solo frontal") sin `OverconstrainedError`
    ([MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), "Front and back camera").
    `useUserMedia` detiene las pistas al desmontar (VueUse, "stop stream on scope dispose").
  - **Foto**: se dibuja el fotograma del `<video playsinline muted>` en un `canvas` al tamaño real de la pista y
    `canvas.toBlob('image/jpeg', 0.85)`; si pasa de 5 242 880 bytes, segunda pasada a 0.7 (mismo criterio que
    `app/utils/heic-copy.ts`), para que la lectura de texto de la feature 002 la acepte. Se entrega como `File`
    `foto-AAAAMMDD-HHMMSS.jpg` al mismo `add(files)` que usa `DropZone`.
  - **Cuándo se apaga**: al cerrar, al confirmar o repetir no (sigue abierta para varias fotos), al ocultarse la
    pestaña (`useDocumentVisibility`), al desmontar y cuando el estado del acceso deja de ser `approved`.
  - **Errores**: `NotAllowedError` → cómo activar el permiso; `NotFoundError`/`OverconstrainedError` → "No
    encontramos una cámara"; `NotReadableError` → "La cámara está en uso por otra app"; otro → genérico. Siempre con
    "Elegir archivos" disponible.
  - **Permissions-Policy**: hoy `server/middleware/security-headers.ts:13` envía `camera=()`, que **bloquea**
    `getUserMedia` en todo el sitio. Pasa a `camera=(self)`; el resto (`microphone=()`, etc.) no cambia.
  - **Contexto seguro**: `getUserMedia` solo existe en HTTPS o `localhost`. En producción y en e2e (localhost) se
    cumple; para probar en un teléfono real en dev hace falta un túnel HTTPS (quickstart §4).
- **Razón**: sin dependencias nuevas; la API es estándar en Safari iOS, Chrome Android y navegadores de tableta.
- **Alternativas**: `<input type="file" capture="environment">` (abre la app de cámara del teléfono, justo lo que
  la directiva del usuario quiere evitar); ImageCapture API (sin soporte en Safari).

## B9. "Solo teléfonos y tabletas" (FR-016e, SC-008)

- **Decisión**: composable `useCameraAvailability()`:
  - `useMediaQuery('(pointer: coarse)')`: el **puntero principal** es táctil. Es independiente del ancho, así que
    una ventana angosta de escritorio da `false` y una tableta en horizontal da `true`.
  - `useSupported(() => !!navigator.mediaDevices?.getUserMedia)`: contexto seguro y API disponible.
  - `navigator.mediaDevices.enumerateDevices()` tiene al menos un `videoinput`. Antes del permiso, los navegadores
    exponen como máximo un dispositivo por tipo sin etiqueta, lo que basta para saber si hay cámara sin pedir
    permiso ([W3C Media Capture, "Device information exposure"](https://w3c.github.io/mediacapture-main/#device-information-exposure)).
  - Solo en cliente (`onMounted`): en SSR el botón no se pinta y aparece tras hidratar. El espacio se reserva
    dentro de `DropZone` para no mover el diseño (CLS).
- **Razón**: coincide con la respuesta de la sesión de aclaración (tipo de dispositivo, no ancho de ventana).
- **Riesgo aceptado en la spec**: un iPad con trackpad conectado reporta `pointer: fine` y oculta el botón; queda
  "Elegir archivos" (spec, edge cases y FR-016e). Un teclado sin trackpad no cambia el puntero, así que la tableta
  con teclado sigue mostrando el botón. Se descarta `(any-pointer: coarse)` porque también coincide en laptops
  con pantalla táctil, que la spec trata como computadoras.
- **Alternativas**: user agent (frágil; iPadOS se presenta como Mac); ancho < 1024 px (rechazado en la aclaración).

## B10. Renombrar Pendientes → Solicitudes (FR-023, FR-024)

- **Decisión**: `app/pages/pendientes.vue` pasa a `app/pages/solicitudes.vue` (con `git mv`); en `nuxt.config.ts`,
  `routeRules: { '/pendientes': { redirect: { to: '/solicitudes', statusCode: 301 } } }`. Se actualizan
  `app/utils/navigation.ts:17`, `app/layouts/dashboard.vue:12` (clave del badge), `app/composables/usePulse.ts:41`,
  `app/pages/index.vue:33-51`, textos de `app/utils/messages.ts` y comentarios.
- **Razón**: la redirección en `routeRules` es configuración estática del enrutador en Vercel (rápida, sin
  función); 301 porque el cambio es permanente.
- **Alternativas**: página `/pendientes` que hace `navigateTo` (pinta un SSR inútil).

## B11. Reutilizar el flujo de envío existente (FR-016, Constitución II)

- **Decisión**:
  - **Servidor**: la lógica de `server/api/public/submissions/index.post.ts` (validar, insertar envío y archivos,
    presignar; el limitador se queda en cada endpoint) se mueve a `createGuestSubmission(event, input, { origin: 'link' }
    | { origin: 'permission', tokenHash })` en `server/utils/guest-submissions.ts` (con permiso, la reserva va en el
    mismo `db.batch`, después del `INSERT`; B4). El endpoint abierto y el nuevo con permiso la llaman; `complete` sigue
    siendo uno solo.
  - **Cliente**: el formulario de `app/pages/enviar.vue` pasa a `components/guests/GuestUploadForm.vue` (nombre,
    nota, `DropZone`, `UploadQueue`, estado final). `useGuestSubmission({ createUrl })` recibe la URL de creación.
    En `/upload` el nombre viene de la solicitud y se muestra de solo lectura.
- **Razón**: un solo camino de subida (presignado directo al bucket, Constitución I), una sola validación y una
  sola lectura de texto.
- **Alternativas**: copiar la página `enviar.vue` (duplicaría ~150 líneas y su comportamiento divergiría).

## B12. Pruebas de la cámara y de "táctil" en e2e (Constitución V)

- **Decisión**: el `setup` de `@nuxt/test-utils/e2e` recibe
  `browserOptions: { type: 'chromium', launch: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } }`
  solo en `camera.spec.ts`. El contexto "teléfono" se crea con `{ hasTouch: true, isMobile: true, permissions: ['camera'] }`
  y el de escritorio sin táctil. Si Chromium no hace coincidir `(pointer: coarse)` con esa emulación, la spec
  inyecta con `addInitScript` un `matchMedia` que lo responda (se verifica al implementar la tarea de la spec).
  El permiso denegado se prueba con un contexto sin `permissions` y `--use-fake-ui-for-media-stream` retirado
  (o forzando `NotAllowedError` con un `addInitScript` sobre `getUserMedia`).
- **Razón**: la cámara falsa de Chromium produce un patrón de video real, así que se prueba la captura completa
  (canvas → JPEG → cola → envío → Solicitudes).
- **Alternativas**: probar solo en componente con `getUserMedia` simulado (no cubre `Permissions-Policy` ni el SSR).

## Versiones verificadas

| Pieza | Versión en el repo | Fuente |
|-------|--------------------|--------|
| Nuxt / Vue / Nitro | `^4.6.1` / `^3.5.43` / 2.x | `package.json` |
| VueUse (`useUserMedia`, `useMediaQuery`, `useSupported`, `useIntervalFn`, `useDocumentVisibility`) | `@vueuse/nuxt` 15.0.0 | [vueuse.org/core/useUserMedia](https://vueuse.org/core/useUserMedia/) (2026-10-29) |
| drizzle-orm / drizzle-kit | `^0.45.4` / `^0.31.11` | `package.json` |
| `@nuxt/test-utils` / `playwright-core` | `^4.3.3` / `^1.64.1` | `package.json` |
| `getUserMedia`, `facingMode`, errores | estándar | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) (2026-10-29) |
