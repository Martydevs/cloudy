# Contrato de UI: Subida de invitados con aprobación de acceso

**Feature**: [spec.md](../spec.md) · **API**: [api.md](./api.md)

Reglas de siempre: mobile first (360 px base, `lg:` amplía), `btn` base (nunca `btn-sm`/`btn-xs` como base),
iconos lucide, colores solo con clases semánticas de daisyUI, copy en `app/utils/messages.ts`, errores HTTP con
`serverMessage()`, cuatro estados con `SkeletonList`/`EmptyState`/`ErrorState`.

## Páginas

### `/login` (modificada, FR-001)

Bajo el formulario, separado por un `divider`: texto "¿Eres invitado?" y enlace `btn btn-outline btn-block`
"Enviar archivos" (icono `lucide:cloud-upload`) → `/upload`.

### `/upload` (nueva, `layout: 'public'`, `access: 'public'`, FR-002, FR-013)

Datos: `useGuestAccess()` (abajo). Primera vista con SSR (la cookie llega al servidor).

| Estado | Qué se ve |
|--------|-----------|
| cargando | `SkeletonList` de 2 filas |
| `none` | Título "Envía tus archivos", texto "Pide permiso al equipo; en cuanto alguien lo apruebe podrás subir tus archivos aquí mismo.", campo "Tu nombre" (`input` con `label`) y `btn btn-primary btn-block` "Pedir acceso" |
| `waiting` | Tarjeta con `loading loading-dots` (sin animación con `motion-reduce`), "Esperando a que alguien del equipo revise tu solicitud", el nombre enviado y "Caduca en N min" |
| `approved` | `alert alert-success` "¡Listo! Ya puedes enviar tus archivos" + `GuestUploadForm` con el nombre de solo lectura y "Tienes N min para empezar el envío". Con un envío en curso (creado y sin terminar), el formulario sigue montado aunque venza `expiresAt`: la vigencia solo se comprueba al iniciar (spec, edge cases) |
| `rejected` | `EmptyState` (icono `lucide:circle-x`) "El equipo no aceptó tu solicitud" + `btn` "Pedir acceso de nuevo" |
| `expired` | `EmptyState` (icono `lucide:clock`) "Tu solicitud caducó sin que nadie la atendiera" + "Pedir acceso de nuevo" |
| `accessExpired` | `EmptyState` (icono `lucide:clock`) "Tu acceso caducó antes de empezar el envío" + "Pedir acceso de nuevo" |
| `used` | Confirmación de `GuestUploadForm` ("¡Gracias! Recibimos tu envío") + "Pedir acceso para otro envío" |
| error de red | `ErrorState` con "Reintentar" |

- Región `role="status" aria-live="polite"` que anuncia cada cambio de estado (FR-013).
- 429 al pedir acceso (de `Retry-After` y `data.scope`): `device` → "Ya pediste acceso varias veces. Intenta de
  nuevo en N min"; `network` → "Hay muchas solicitudes desde esta red. Intenta de nuevo en N min".
- Al recargar, el SSR con la cookie pinta el mismo estado (spec, edge cases); no se crea otra solicitud.
- Nunca muestra nombres del equipo.

### `/enviar` (modificada, FR-016a, FR-021)

Mismo comportamiento que hoy, ahora con `GuestUploadForm` (nombre editable). Gana el botón de cámara a través de
`DropZone`.

### `/solicitudes` (antes `/pendientes`, FR-008, FR-019, FR-022, FR-023, FR-025)

- `h1` "Solicitudes"; `useHead` "Solicitudes · Cloudy".
- **Sección 1, "Solicitudes de acceso"** (`h2`, `AccessRequestList`): solo con la pestaña "Por revisar" activa.
  - Cargando: `SkeletonList` de 2 filas. Vacía: `EmptyState` compacto "Nadie está pidiendo acceso ahora".
    Error: `ErrorState` con "Reintentar". Contenido: lista de `AccessRequestCard`.
  - Se recarga cuando cambia `openAccessRequests` del pulso (como hoy con `pendingCount`).
- **Sección 2, "Envíos"** (`h2`): lo que hoy es la página. Pestañas "Por revisar" (antes "Pendientes"),
  "Aprobados" y "Rechazados". Los vacíos dicen "No hay envíos por revisar", etc.
- `/pendientes` redirige con 301.
- El botón existente "Copiar enlace para invitados" (`useGuestLink`, también en el inicio) se conserva y sigue
  copiando el enlace de `/enviar` (FR-021).

### Barra lateral, inicio y avisos

- `app/utils/navigation.ts`: `{ to: '/solicitudes', label: 'Solicitudes', icon: 'lucide:inbox' }`.
- Badge: `pendingCount + openAccessRequests` (`app/layouts/dashboard.vue`).
- `app/pages/index.vue`: "Ver solicitudes" y la estadística "Solicitudes por atender".
- Toast por solicitud nueva: `messages.access.requested(nombre)` = "{nombre} pide permiso para enviar archivos",
  acción "Ver" → `/solicitudes`. El toast de envío nuevo también enlaza a `/solicitudes`.

## Componentes

| Componente | Props / emits | Notas |
|------------|---------------|-------|
| `guests/AccessRequestCard.vue` | `request: AccessRequest` · emits `decided` | `card` con nombre, "hace N min" (`useRelativeTime`, ya existente), "caduca en N min". Botones `btn btn-primary` "Dar acceso" (un toque) y `btn btn-outline` "Rechazar" (≥ 44 px, una fila en móvil). Ambos se deshabilitan mientras corre la petición. Rechazar pide confirmación (`useConfirm` / `ConfirmDialog`: "¿Rechazar la solicitud de {nombre}?"). 409 → toast `info` y 410/404 → toast `error`, ambos con `serverMessage(error, messages.access.decideFailed)` (el texto lo da el servidor; contracts/api.md), y emite `decided` para recargar la lista. Éxito → toast "Diste acceso a {nombre}" / "Rechazaste la solicitud de {nombre}" y `refreshPulse()` |
| `guests/AccessRequestList.vue` | — | Datos con `useApiFetch('/api/access-requests')`; cuatro estados |
| `guests/SubmissionCard.vue` (modificado) | + `origin`, `accessGrantedBy` vía `submission` | Insignia `badge badge-outline` con icono y texto: `lucide:link` "Por enlace" o `lucide:shield-check` "Por permiso" (no depende del color, FR-022). Con permiso: línea "Acceso aprobado por {nombre}" |
| `guests/GuestUploadForm.vue` (extraído de `enviar.vue`) | `createUrl: string`, `senderName?: string` (si viene, el campo es de solo lectura), `disabled?: boolean` · emits `done` | Contiene nombre, nota, `DropZone` (con cámara), `UploadQueue` y el estado final |
| `upload/DropZone.vue` (modificado) | + `camera?: boolean` (default `false`), `cameraDisabled?: boolean` | Si `camera` y `useCameraAvailability().available`, muestra dentro de la zona un `btn btn-outline` "Abrir cámara" (`lucide:camera`) con `@click.stop`. El equipo (`UploadDialog`) no lo pasa: sin cámara |
| `upload/CameraCapture.vue` (nuevo, se carga como `LazyCameraCapture`) | `open: boolean`, `maxPhotos: number` · emits `photo: [File]`, `close` | Ver abajo |

### `CameraCapture` (FR-016a–FR-016d)

- `<dialog class="modal">` a pantalla completa en móvil (`modal-box` sin márgenes, `h-dvh`), centrado con `lg:`.
  Foco al abrir en "Tomar foto"; `Esc` y "Cerrar cámara" cierran; foco de vuelta a "Abrir cámara".
- **Vista en vivo**: `<video autoplay muted playsinline>` con el stream; abajo, botón circular "Tomar foto"
  (`lucide:circle`, `aria-label`, ≥ 64 px) y `btn btn-ghost` "Cerrar cámara" (≥ 44 px), al alcance del pulgar.
- **Revisión**: la foto congelada (`img` con `URL` de `useObjectUrl`) y dos botones: "Repetir" y "Usar foto".
  "Usar foto" emite `photo` y vuelve a la vista en vivo con el contador "N fotos agregadas"; al llegar a
  `maxPhotos`, se cierra sola y avisa.
- **Estados**: "Abriendo la cámara…" (skeleton del recuadro); error de permiso ("Cloudy no tiene permiso para usar
  la cámara. Actívalo en los ajustes del navegador o usa «Elegir archivos»"); sin cámara ("No encontramos una
  cámara en este dispositivo"); cámara ocupada ("Otra app está usando la cámara"). Todos con "Cerrar".
- `aria-live="polite"` anuncia "Foto lista para revisar" y "Foto agregada".
- Se apaga (pistas detenidas) al cerrar, al ocultarse la pestaña y al desmontar.

## Composables y utilidades

| Nombre | Responsabilidad |
|--------|-----------------|
| `useGuestAccess()` | `state`, `senderName`, `expiresAt`, `request(name)`, `refresh()`, `holdWhileUploading(active)`. `useFetch('/api/public/access/current')` + sondeo cada `POLL_INTERVAL_MS` con `useIntervalFn`, pausado con `useDocumentVisibility`/`useOnline`; se detiene en `TERMINAL_ACCESS_STATES`. Cuando vence `expiresAt` en el cliente pasa a `expired` (desde `waiting`) o `accessExpired` (desde `approved`) sin esperar al siguiente sondeo, salvo con un envío en curso: entonces solo el sondeo cambia el estado |
| `useGuestSubmission({ createUrl })` (modificado) | Igual que hoy, pero con la URL de creación como opción; el body omite `senderName` si la URL es la de permiso |
| `useCameraAvailability()` | `available: ComputedRef<boolean>` = `(pointer: coarse)` ∧ `getUserMedia` soportado ∧ hay `videoinput` (research B9). Solo cliente |
| `useCameraCapture()` | Envuelve `useUserMedia` (constraints de research B8), `capture(): Promise<File>` (canvas → JPEG ≤ 5 MB) y `error` traducido a una clave de `messages.camera` |
| `app/utils/camera.ts` | Funciones puras probables en unit: `photoFileName(date)`, `cameraErrorKey(error)` y `encodeJpeg(canvas)` (la segunda calidad si pasa de 5 MB) |

## Copy (`app/utils/messages.ts`)

Secciones nuevas: `access` (invitado y equipo) y `camera`. Se renombra el copy de `submissions` y `load` de
"pendientes" a "solicitudes"/"envíos por revisar". Todo texto de esta tabla vive ahí, no en los componentes.

| Clave | Texto |
|-------|-------|
| `access.requested(name)` | "{name} pide permiso para enviar archivos" |
| `access.granted(name)` | "Diste acceso a {name}" |
| `access.rejected(name)` | "Rechazaste la solicitud de {name}" |
| `access.decideFailed` | "No pudimos guardar tu decisión. Inténtalo de nuevo" (respaldo de `serverMessage()` en `AccessRequestCard`) |
| `access.tooMany(min)` | "Ya pediste acceso varias veces. Intenta de nuevo en {min} min" |
| `access.networkBusy(min)` | "Hay muchas solicitudes desde esta red. Intenta de nuevo en {min} min" |
| `access.requestFailed` | "No pudimos enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo" |
| `access.submitFailed` | "No pudimos iniciar tu envío. Revisa tu conexión e inténtalo de nuevo" (respaldo de `serverMessage()` en `/upload`) |
| `access.state.waiting` | "Esperando a que alguien del equipo revise tu solicitud" |
| `access.state.approved` | "¡Listo! Ya puedes enviar tus archivos" |
| `access.state.window(min)` | "Tienes {min} min para empezar el envío" |
| `access.state.rejected` | "El equipo no aceptó tu solicitud" |
| `access.state.expired` | "Tu solicitud caducó sin que nadie la atendiera" |
| `access.state.accessExpired` | "Tu acceso caducó antes de empezar el envío" |
| `access.state.used` | "¡Gracias! Recibimos tu envío" |
| `access.state.retry` · `access.state.another` | "Pedir acceso de nuevo" · "Pedir acceso para otro envío" |
| `camera.denied` · `camera.notFound` · `camera.busy` · `camera.failed` | ver CameraCapture |
| `load.accessRequests` | "No pudimos cargar las solicitudes de acceso." |

**Mensajes que da solo el servidor** (el cliente los muestra con `serverMessage()`, nunca los duplica en
`messages.ts`): el 409 de decisión ("{nombre} ya dio acceso a esta persona" / "{nombre} ya rechazó esta solicitud"),
el 410 ("La solicitud caducó antes de atenderla"), el 404 ("La solicitud ya no existe"), los 403 de
`POST /api/public/access/submissions` y el 409 de `complete` ("Tu acceso ya se usó. Pide uno nuevo para enviar más
archivos"); ver contracts/api.md.
