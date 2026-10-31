# Implementation Plan: Subida de invitados con aprobación de acceso

**Branch**: `003-public-photos-upload` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-guest-upload-access-code/spec.md`

## Summary

Un invitado entra desde el inicio de sesión a la página pública **Subir** (`/upload`) y pide acceso con su nombre.
Administradores y editores reciben el aviso en vivo y la solicitud aparece arriba en la página **Solicitudes**
(antes "Pendientes"). Ahí la aprueban ("Dar acceso") o la rechazan. Al aprobarse, la página del invitado se
desbloquea sola, solo en su navegador, para **un** envío iniciado en los 30 minutos siguientes. El envío llega a
la misma cola de revisión, marcado **Por permiso**; los de la página abierta `/enviar`, que se mantiene, llevan
**Por enlace**. En teléfonos y tabletas, las dos páginas de invitados muestran **Abrir cámara**: toma fotos con
la cámara trasera dentro de Cloudy, sin pasar por la app de cámara del teléfono.

**Enfoque técnico**:
- **Solicitud ligada al navegador**: tabla `guest_access_requests`. El navegador guarda un token aleatorio en la
  cookie `httpOnly` `cloudy-guest-access`; la base solo guarda su hash SHA-256 (research B1).
- **Caducidad derivada**: 8 min de espera y 30 min de acceso, calculados al leer y aplicados con `UPDATE … WHERE`
  condicionados, sin trabajos programados (B3).
- **Un solo envío**: el acceso se reserva al crear el envío y se consume al completarlo, así que un fallo de
  subida no lo gasta (B4). La reserva va en el mismo `db.batch` que la creación y **después** del `INSERT` del envío,
  así que `submission_id` siempre apunta a una fila existente.
- **Estados del invitado**: `expired` (la solicitud caducó sin atenderse) y `accessExpired` (el acceso aprobado venció
  sin usarse) son estados distintos para que el mensaje diga qué pasó (B3).
- **Decisiones del equipo**: aprobar o rechazar es una sola sentencia (CTE con `UPDATE` + `INSERT` en
  `activity_log`), sin carreras (B5).
- **"Tiempo real"**: el pulso existente de 5 s suma las solicitudes abiertas. El invitado sondea su estado cada
  5 s con el mismo patrón de pausa por visibilidad y conexión (B6).
- **Reutilización**: la creación de envíos se extrae a `createGuestSubmission()` y el formulario a
  `GuestUploadForm`. Las subidas siguen yendo directo al bucket con URLs firmadas (B11).
- **Cámara**:
  - `useUserMedia` de VueUse con `facingMode: { ideal: 'environment' }`; la foto sale de un canvas como JPEG
    ≤ 5 MB, apta para la lectura de texto de la feature 002 (B8).
  - Se muestra solo si el puntero principal es táctil, la API está disponible y hay un `videoinput` (B9).
  - `Permissions-Policy` pasa de `camera=()` a `camera=(self)`, porque hoy bloquea la cámara en todo el sitio.

## Technical Context

**Language/Version**: TypeScript 5 (estricto) · Vue 3.5 · Nuxt 4.6 (Nitro 2, h3 1) · Bun (local) / Node 22 (Vercel)

**Primary Dependencies**:
- **Sin dependencias nuevas.**
- **Reutilizadas**:
  - Servidor: `rate-limit.ts` (`hitRateLimit`, `hashSender`), `session.ts` (`requireRole`), `validation.ts`,
    `activity.ts`, `storage.ts`, `submissions.ts` y `files.ts` (`readyPendingSubmissionsSql`).
  - Cliente: `useApi`, `usePulse`/`refreshPulse`, `useToast`, `useConfirm`, `useRelativeTime`,
    `useGuestSubmission`, `DropZone`, `UploadQueue`, `SubmissionCard`, `SkeletonList`, `EmptyState` y `ErrorState`.
  - VueUse: `useUserMedia`, `useMediaQuery`, `useSupported`, `useIntervalFn`, `useDocumentVisibility`, `useOnline`
    y `useObjectUrl`.

**Storage**:
- **Neon Postgres**: migración `0004` con 2 enums nuevos, 2 valores nuevos de `activity_action`, la tabla
  `guest_access_requests` (2 índices, CHECKs manuales) y 2 columnas en `guest_submissions`
  ([data-model.md](./data-model.md)).
- **Bucket**: sin cambios. Las fotos de la cámara son archivos JPEG como cualquier otro.

**Testing**: Vitest con los proyectos `unit`, `nuxt` y `e2e`.
- E2E de cámara con Chromium y sus banderas de cámara falsa (`--use-fake-device-for-media-stream`,
  `--use-fake-ui-for-media-stream`) y contextos táctil y no táctil (research B12).

**Target Platform**: Vercel (preset `vercel`, Node) y navegadores desde 360 px. Cámara: Safari iOS, Chrome Android
y navegadores de tableta, siempre en HTTPS.

**Project Type**: Aplicación web full-stack, el mismo proyecto Nuxt (`app/`, `server/`, `shared/`).

**Performance Goals**:
- El equipo ve una solicitud nueva y el invitado ve la decisión en ≤ 5 s (SC-002, SC-005), con un sondeo por índice.
- `CameraCapture` se carga como `Lazy*`, sin impacto en el JS inicial (≤ 200 KB por ruta).
- El envío aprobado se completa en < 1 min desde el teléfono (SC-003).
- Una foto se toma y se agrega en < 15 s (SC-007).

**Constraints**:
- Funciones sin estado: la caducidad se deriva y el limitador vive en Postgres.
- La cámara exige un contexto seguro (HTTPS o `localhost`).
- `getUserMedia` se llama solo al tocar "Abrir cámara".
- Del invitado solo se guardan nombre y nota. El token es aleatorio y solo se guarda su hash; la IP, solo con sal.
- La cookie se envía `sameSite: 'lax'` contra CSRF.

**Scale/Scope**:
- Volumen: decenas de solicitudes por domingo y unos cientos de envíos al mes.
- Servidor: 6 endpoints nuevos y 6 modificados (pulso, dashboard, envíos abierto y `complete`, lista de envíos, cron).
- Cliente: 1 página nueva y 1 renombrada; 4 componentes nuevos o extraídos (`GuestUploadForm`, `AccessRequestCard`,
  `AccessRequestList`, `CameraCapture`) y 2 modificados (`SubmissionCard`, `DropZone`); 3 composables nuevos
  (`useGuestAccess`, `useCameraAvailability`, `useCameraCapture`) y 2 modificados (`useGuestSubmission`, `usePulse`).
- 3 historias: US1 (P1, MVP) pedir acceso, aprobar y enviar con permiso; US2 (P2) cámara dentro de Cloudy; US3 (P3)
  revisión con origen.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluado contra la constitución **v1.0.1**.

| Principio | Pre-diseño | Post-diseño: cómo se cumple |
|-----------|------------|-----------------------------|
| **I. Rendimiento** | ✅ | Ver el detalle bajo la tabla. |
| **II. Funcional y efectivo** | ✅ | Ver el detalle bajo la tabla. |
| **III. Mobile first** | ✅ | `/upload` y la cámara se diseñan a 360 px: botones `btn-block` y disparo ≥ 64 px al alcance del pulgar. `AccessRequestCard` con "Dar acceso" y "Rechazar" en una fila de botones `btn` base. Nada depende de `hover`. Verificación a 360 px y ≥ 1280 px (quickstart §3). |
| **IV. Calidad de código** | ✅ | Ver el detalle bajo la tabla. |
| **V. Pruebas** | ✅ | Ver el detalle bajo la tabla. |
| **VI. Consistencia de UX** | ✅ | Ver el detalle bajo la tabla. |
| **Restricciones técnicas** | ✅ | Ver el detalle bajo la tabla. |
| **Flujo y gates** | ✅ | Rama `003-public-photos-upload` (creada por la persona; la carpeta de documentos sigue siendo `specs/003-guest-upload-access-code/`). Conventional Commits. DoD de AGENTS.md por fase (typecheck → tests → navegador). |

**Detalle de los principios**:

- **I. Rendimiento**:
  - Índices para todo filtro nuevo: `token_hash` único y `(status, created_at)`.
  - El pulso suma dos consultas al mismo `db.batch`, y `accessGrantedBy` llega con un `LEFT JOIN`, sin N+1.
  - Binarios siempre por URL firmada; la foto se sube como cualquier archivo.
  - `CameraCapture` es diferido, y `/upload` hace SSR de la primera vista con la cookie.
- **II. Funcional y efectivo**:
  - 3 historias que se pueden desplegar por separado, en orden de prioridad: US1 (P1, MVP) pedir acceso, decidir y
    enviar con permiso; US2 (P2) cámara en `/upload` y `/enviar`; US3 (P3) revisión con origen. Pedir y enviar van
    juntas porque una aprobación sin formulario dejaría al invitado sin salida (resultado de `/speckit-analyze`).
  - El renombrado a Solicitudes va en US1, que es la primera que necesita la página.
  - Sin dependencias nuevas; todo sale de VueUse, Nuxt, daisyUI y los utils existentes.
  - Sin huérfanos:
    - Un envío no completado deja el acceso intacto; el envío viejo lo borra la limpieza existente.
    - Un `complete` que pierde la carrera descarta su envío.
    - Las solicitudes vencidas se borran a las 24 h.
  - Cada error dice qué hacer ("Pide acceso de nuevo", "Intenta en N min", "usa Elegir archivos").
- **IV. Calidad de código**:
  - `requireRole(event, 'editor')` en los 3 endpoints de equipo.
  - Los públicos validan cuerpo y cookie, y aplican limitador (`current` no: es una lectura por índice único).
  - Los mensajes de error los da el servidor y el cliente los muestra con `serverMessage()`, sin duplicarlos.
  - Las reglas compartidas viven una sola vez en `shared/`: `shared/constants/access.ts` (tiempos, cookie y
    `accessStateOf`) y `shared/validation/access.ts`.
  - Fronteras:
    - La lógica de solicitudes vive en `server/utils/access-requests.ts`.
    - La de envíos, en `server/utils/guest-submissions.ts`.
    - Los endpoints solo orquestan.
  - La cámara queda en un composable y un componente, sin `any`.
- **V. Pruebas**:
  - **Unit**: `accessStateOf` (todas las filas de la tabla del data-model, con reloj fijo) y validadores.
  - **Unit, utils directos**: `access-requests.ts` y `createGuestSubmission` (token, cookie, `decideAccessRequest`, orden del
    `db.batch`, `consumeForSubmission`).
  - **Unit, endpoints vía `installNitro`**: pedir (idempotencia, 429), estado, crear con permiso (403 por estado),
    `complete` (409 al reusar), aprobar y rechazar (204, 409, 410, actividad), pulso, lista con origen, cron y
    cabecera `Permissions-Policy`.
  - **Unit, utils de cámara**: `photoFileName`, `cameraErrorKey` y `encodeJpeg`.
  - **Componente**:
    - `/upload` en sus 9 estados (incluidos `expired` y `accessExpired`) y su región `aria-live`.
    - `AccessRequestCard` (éxito, 409, 410, confirmación) y `SubmissionCard` (insignias).
    - `DropZone` (con y sin cámara, disponible o no) y `CameraCapture` (permiso, error, repetir, usar, máximo,
      apagado al ocultar; `getUserMedia` simulado).
    - `GuestUploadForm`.
  - **E2E**:
    - `access-upload.spec`: US1 de punta a punta (pedir, aprobar, enviar), rechazo, caducidad de la solicitud y del
      acceso con reloj de la base adelantado vía `testSql`, y otro navegador sin acceso.
    - `camera.spec` (US2): teléfono con foto falsa enviada y escritorio sin botón.
    - `guest-queue.spec`: `/solicitudes` (US1) y origen (US3); `routes-guard`: redirección de `/pendientes`.
    - `routes-guard`: `/api/access-requests*` sin sesión y con cuenta pendiente.
  - Cobertura ≥ 92 %.
- **VI. Consistencia de UX**:
  - Cuatro estados en `/upload`, en la sección de solicitudes y en `CameraCapture`.
  - `ConfirmDialog` antes de rechazar; toasts al dar acceso, rechazar y agregar foto.
  - Copy en `messages.access` y `messages.camera`; errores con `serverMessage()`.
  - Insignias de origen con icono y texto, sin depender del color.
  - `aria-live` en el estado del invitado y en la cámara; foco gestionado en el `<dialog>`; `motion-reduce` en la
    animación de espera.
  - Iconos lucide (`camera`, `link`, `shield-check`, `door-open`).
- **Restricciones técnicas**:
  - Sin estado en memoria: estados derivados del reloj de Postgres.
  - Migración Drizzle con SQL manual para los CHECK.
  - Del invitado solo nombre y nota. El token no es un dato personal (es aleatorio y solo se guarda su hash); IP
    solo con sal.
  - `Permissions-Policy` abre solo `camera` y solo para el propio origen.

**Resultado**: **PASS**, sin excepciones ni dependencias nuevas.

## Project Structure

### Documentation (this feature)

```text
specs/003-guest-upload-access-code/
├── spec.md
├── plan.md              # este archivo
├── research.md          # Fase 0 (B1–B12)
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/
│   ├── api.md           # endpoints nuevos y modificados
│   └── ui.md            # páginas, componentes, composables y copy
├── checklists/requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
server/
├── db/schema.ts                              # enums access_request_status, submission_origin; tabla guest_access_requests;
│                                             # guest_submissions.origin y access_granted_by; activity 'access.approve' | 'access.reject'
├── utils/access-requests.ts                  # NUEVO: token/cookie (crear, leer hash), findByToken, toGuestAccess,
│                                             # decide(id, 'approved' | 'rejected', profile) con CTE + actividad,
│                                             # permittedSubmissionQueries (INSERT condicional + reserva, para el batch),
│                                             # consumeForSubmission, openAccessRequestsSql
├── utils/guest-submissions.ts                # NUEVO (extraído): createGuestSubmission(event, input, { origin: 'link' } | { origin: 'permission', tokenHash })
├── utils/submissions.ts                      # + origin y accessGrantedBy en toSubmission/listSubmissions (LEFT JOIN)
├── middleware/security-headers.ts            # camera=(self)
├── api/public/access/index.post.ts           # NUEVO: pedir acceso
├── api/public/access/current.get.ts          # NUEVO: estado del invitado
├── api/public/access/submissions.post.ts     # NUEVO: crear envío con permiso
├── api/public/submissions/index.post.ts      # usa createGuestSubmission (origin 'link')
├── api/public/submissions/[id]/complete.post.ts  # + consumir el acceso si origin = 'permission'
├── api/access-requests/index.get.ts          # NUEVO: abiertas (equipo)
├── api/access-requests/[id]/approve.post.ts  # NUEVO
├── api/access-requests/[id]/reject.post.ts   # NUEVO
├── api/realtime/pulse.get.ts                 # + openAccessRequests, newAccessRequests
├── api/dashboard.get.ts                      # + openAccessRequests (estadística del inicio)
└── api/cron/cleanup.get.ts                   # + borrar solicitudes vencidas > 24 h

shared/
├── constants/access.ts                       # NUEVO: ACCESS_WAIT_MINUTES, ACCESS_WINDOW_MINUTES, ACCESS_REQUEST_LIMIT, ACCESS_NETWORK_LIMIT,
│                                             # ACCESS_SUBMIT_LIMIT, ACCESS_DEVICE_COOKIE, ACCESS_COOKIE, accessStateOf(), TERMINAL_ACCESS_STATES
├── validation/access.ts                      # NUEVO: accessRequestInput, permittedSubmissionInput
└── types/api.ts                              # AccessState, GuestAccess, AccessRequest, SubmissionOrigin; Pulse y Submission ampliados

app/
├── pages/upload.vue                          # NUEVO
├── pages/solicitudes.vue                     # git mv desde pendientes.vue + sección de solicitudes de acceso
├── pages/enviar.vue                          # usa GuestUploadForm
├── pages/login.vue · index.vue               # enlace de invitado · textos y enlaces a /solicitudes
├── components/guests/GuestUploadForm.vue     # NUEVO (extraído de enviar.vue)
├── components/guests/AccessRequestCard.vue · AccessRequestList.vue   # NUEVOS
├── components/guests/SubmissionCard.vue      # insignia de origen y "Acceso aprobado por"
├── components/upload/DropZone.vue            # prop camera → botón "Abrir cámara"
├── components/upload/CameraCapture.vue       # NUEVO (se usa como LazyCameraCapture)
├── composables/useGuestAccess.ts · useCameraAvailability.ts · useCameraCapture.ts   # NUEVOS
├── composables/useGuestSubmission.ts         # opción createUrl
├── composables/usePulse.ts                   # + solicitudes de acceso y toast; enlace /solicitudes
├── layouts/dashboard.vue                     # badge /solicitudes = envíos + solicitudes
├── utils/navigation.ts · messages.ts · activity-labels.ts · camera.ts (NUEVO)
nuxt.config.ts                                # routeRules /pendientes → /solicitudes (301)
drizzle/0004_*.sql                            # generada + CHECKs manuales
test/
├── unit/   access-state · validation-access · access-requests (utils) · api-access-public · api-access-requests · api-submissions (origen, complete)
│           api-cron · api-core (pulso y Permissions-Policy) · camera-utils · endpoint-guards
├── nuxt/   pages-upload · AccessRequestCard · pages-guests (GuestUploadForm, SubmissionCard) · DropZone · CameraCapture
│           AppSidebar (badge y ruta)
└── e2e/    access-upload · camera · guest-queue (/solicitudes) · routes-guard
```

**Structure Decision**: el mismo proyecto Nuxt de las features 001 y 002.
- La lógica de solicitudes vive en `server/utils/access-requests.ts`; es auto-importada como el resto de utils
  porque no encapsula un proveedor externo.
- No hace falta una frontera como `server/ai/`.

### Organización por capas

| Capa | Archivos | Hace | No hace |
|------|----------|------|---------|
| UI | `upload.vue`, `solicitudes.vue`, `AccessRequestCard`, `GuestUploadForm`, `CameraCapture`, `DropZone` | Pinta estados y emite acciones | Reglas de vigencia, SQL |
| Estado del cliente | `useGuestAccess`, `useGuestSubmission`, `useCameraCapture`, `useCameraAvailability`, `usePulse` | Peticiones, sondeo, stream de cámara, toasts | Decidir vigencia (usa `accessStateOf` de `shared/`) |
| Reglas compartidas | `shared/constants/access.ts`, `shared/validation/access.ts`, `shared/types/api.ts` | Tiempos, estado derivado, validadores, DTO | Código de servidor o Vue |
| HTTP | `server/api/public/access/**`, `server/api/access-requests/**`, endpoints modificados | Guardia, validación, una llamada a la capa de aplicación | SQL de solicitudes |
| Aplicación | `server/utils/access-requests.ts`, `server/utils/guest-submissions.ts` | Token, UPDATE condicionados, CTE con actividad, creación de envíos | h3 más allá de la cookie y el limitador |

## Cambios a la base existente

1. `server/middleware/security-headers.ts`: `camera=()` → `camera=(self)`, y actualizar el comentario ("Solo
   subidas de archivos, reproducción y cámara de invitados").
2. `app/pages/pendientes.vue` → `git mv` a `app/pages/solicitudes.vue`. Actualizar referencias:
   - `app/utils/navigation.ts:17`
   - `app/layouts/dashboard.vue:12`
   - `app/composables/usePulse.ts:41`
   - `app/pages/index.vue:33-51`
   - copy en `messages.ts`
   - comentarios que digan "Pendientes" (`useImageText.ts:7`, `ImageTextPanel.vue:11,15`, `AppSidebar.vue:2`)
   - specs de e2e y nuxt que naveguen a `/pendientes`
3. `server/api/public/submissions/index.post.ts`: mover su cuerpo a `createGuestSubmission`; el endpoint queda en
   unas líneas y su contrato no cambia.
4. `test/unit/helpers/nitro.ts`: registrar las funciones nuevas de `access-requests.ts` y `guest-submissions.ts`.
5. `test/e2e/setup/global-setup.ts`: agregar `guest_access_requests` a la lista de tablas que se vacían en la
   rama de pruebas, que es la única que el e2e reinicia.
6. `AGENTS.md`:
   - En "Rules by principle", I: la cookie del invitado y el sondeo de `/upload`.
   - En "Known gotchas":
     - `Permissions-Policy` abre solo `camera=(self)`.
     - `getUserMedia` exige HTTPS; en dev desde un teléfono hace falta un túnel.
     - La e2e de cámara usa las banderas de Chromium.
   - Las rutas `/upload` y `/solicitudes`.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Alguien pide acceso con un nombre falso | El equipo decide (spec, Assumptions); "Rechazar" está a un toque, y el envío igual pasa por revisión |
| Un navegador aprobado crea muchos envíos sin completar (filas y URLs firmadas) | `ACCESS_SUBMIT_LIMIT`: 5 creaciones cada 30 min por solicitud (research B2); los huérfanos los borra la limpieza existente |
| La reserva apunta a un envío que no existe (FK) o queda a medias si la creación falla | Archivos validados antes de escribir; `INSERT` del envío antes de la reserva y todo en un `db.batch` (research B4) |
| Spam de solicitudes desde muchas IP | Cada solicitud caduca sola a los 8 min y se borra a las 24 h; 3 cada 30 min por navegador y 30 por red (research B2); la lista muestra máximo 50 |
| Muchos invitados en el wifi de la iglesia (misma IP) | El límite principal es por navegador (cookie `cloudy-guest-device`); el de red es un tope alto, y los envíos con permiso no usan el límite por IP del envío abierto |
| Subida larga que termina después de que vence la cookie | La cookie dura 3 h y se reemite al crear el envío con permiso (research B1) |
| Safari iOS en modo de baja energía o con la cámara en uso | `NotReadableError` → "Otra app está usando la cámara"; "Elegir archivos" siempre disponible |
| `(pointer: coarse)` falso en un iPad con trackpad | Riesgo aceptado en la spec (edge cases, FR-016e): el botón se oculta y queda "Elegir archivos" (research B9) |
| El invitado borra cookies a mitad del flujo | Pierde el acceso en ese navegador; vuelve a pedirlo (cuenta para el límite de 3 cada 30 min del navegador, o solo para el tope por red si también borró `cloudy-guest-device`) |
| Emulación táctil de Chromium sin `(pointer: coarse)` en e2e | `addInitScript` que responde `matchMedia` en `camera.spec` (research B12) |
| Renombrar la ruta rompe accesos guardados | 301 de `/pendientes` a `/solicitudes` |
| Reloj del navegador desfasado | Las vigencias las decide el servidor; el cliente solo adelanta el "caducada" visual y el siguiente sondeo lo corrige |

## Complexity Tracking

La feature en sí no añade dependencias ni servicios. Esta rama sí incorporó dos cambios de dependencias (Constitución II),
registrados aquí con su justificación:

| Dependencia | Por qué | Costo y alternativa descartada |
|-------------|---------|--------------------------------|
| `@regle/core`, `@regle/nuxt`, `@regle/schemas` + `zod/mini` (zod ya era dependencia por `server/ai`) | Un solo contrato de validación por formulario, con errores al salir del campo o al enviar y en español, en lugar de validar a mano en cada componente. La persona responsable definió `@regle/schemas` como la base de todos los formularios de la interfaz. | El plugin de `@regle/nuxt` se carga con normalidad, así que Regle viaja en el chunk de entrada de todas las rutas; aun así la ruta más pesada (`/archivos/:folderId`) queda en ≈ 158 KiB gzip, bajo el presupuesto de 250 KB (Constitución v1.1.0). `@regle/rules` ya no es dependencia directa. |
| `@openrouter/ai-sdk-provider` (sustituye a `@ai-sdk/openai` y `@ai-sdk/google`) | OpenRouter como único proveedor de IA para la lectura de imágenes; el preset elige modelo y enrutamiento. | Se eliminan dos proveedores y el respaldo con Gemini: menos superficie, una sola clave. |

## Siguientes pasos

1. Ejecutar `/speckit-tasks`.
