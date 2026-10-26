# Contrato HTTP: texto extraído de imágenes

Extiende [001 contracts/api.md](../../001-shared-media-drive/contracts/api.md). Las convenciones no cambian:

- **Autorización**: `requireRole(event, 'editor')`, que también deja pasar a admins.
- **Validación**: con `readValid`/`paramId`.
- **Errores**: `createError` con `message` en español; el cliente los muestra solo con `serverMessage()`.

DTO `ImageText`: ver [data-model.md](../data-model.md#dto-compartido-sharedtypesapits).

## Subidas con copia JPEG para HEIC (research A4)

### `POST /api/uploads` (existente, cambia)

- **Body**: gana `withTextSource?: boolean`. Solo se acepta si el archivo es una HEIC apta (`isImageTextEligible`).
  En cualquier otro caso se ignora.
- **Respuesta**: `UploadTicket` gana `textSourceUploadUrl?: string`, un PUT prefirmado a `textsrc/<id>.jpg` con
  `content-type: image/jpeg`.

### `POST /api/uploads/:fileId/complete` (existente, cambia)

La respuesta no cambia y su latencia no varía de forma perceptible: la validación de la copia es un `head` y una
lectura de 4 KB, y la lectura de la imagen nunca se espera. Además de lo que ya hace:

1. Si el archivo es HEIC apta, valida la copia con `head` (0 < tamaño ≤ 5 MB, 5 242 880 bytes) y
   `matchesSignature('jpg', readRange(0, 4095))`:

   | Copia | Resultado |
   |-------|-----------|
   | Válida | `text_source_key = textsrc/<id>.jpg`; la imagen es apta y se lee en segundo plano (paso 2). |
   | Ausente o inválida | Si existe, se borra el objeto; `text_status = 'unavailable'`. |

2. Si la imagen es apta (`isImageTextEligible`, con copia válida en el caso HEIC), programa la lectura con
   `runInBackground(() => readFileImage(fileId))` (research A6): la tarea reclama la fila (`NULL` → `reading`)
   y la lee después de responder. Varias subidas a la vez → una tarea por `complete`, en paralelo.

La subida **nunca** falla ni espera por la copia ni por la lectura (FR-004, FR-023).

### `DELETE /api/uploads/:fileId` y `discardUpload` (existentes, cambian)

Borran también `textsrc/<id>.jpg`.

## Archivos del disco (equipo)

### `GET /api/files/:id/text`

- **Auth**: editor.
- **Respuesta**: `200 ImageText` de un archivo visible: subida completa (`files.status = 'ready'`), en una carpeta y fuera de la papelera.
- **Errores**:
  - `404` si el archivo no existe, no es visible o no es imagen.
  - `401`/`403` según la sesión.
- **Uso**: consulta cada 3 s mientras la lectura sigue en `reading` (en segundo plano tras la subida, o en
  otra petición).

### `POST /api/files/:id/text`

Lee la imagen en la misma petición y devuelve el resultado. Es el **respaldo** de la lectura en segundo plano
(imagen que quedó sin leer al abrir la vista previa, FR-001b) y cubre el reintento y "Volver a leer" (FR-006).

- **Auth**: editor.
- **Body**: `{ force?: boolean }` (por defecto `false`).

**Sin `force`** (el panel lo llama solo si el estado es `pending`):

| Estado actual | Respuesta |
|---------------|-----------|
| `ready`, `empty`, `failed` o `unavailable` | Lo devuelve tal cual, sin llamar al modelo. |
| `NULL`, o `reading` con más de 90 s | Reclama la fila con `readFileImage`, lee en la misma petición (≤ 45 s) y responde con el estado final. |
| `reading` vigente (por ejemplo, la lectura de segundo plano aún en curso) | `200 { status: 'reading' }` de inmediato. |

**Con `force: true`** (Reintentar o Volver a leer): reclama la fila desde `failed`, `ready` o `empty`, y la lee
igual que arriba, en la petición.

**Errores**:
- `404` si el archivo no existe, no es visible o no es imagen.
- `409` si se usa `force` sobre `unavailable` o sobre una lectura vigente.

La confirmación antes de reemplazar una corrección manual la pide el cliente; el servidor no la exige.

La imagen no apta se marca `unavailable` en la primera llamada y se devuelve así.

Un fallo de lectura **no** es un error HTTP: responde `200` con `status: 'failed'` y `error`, para que la UI
muestre su estado con el botón Reintentar (FR-005).

### `PATCH /api/files/:id/text`

Corrección manual (FR-014, FR-018).

- **Auth**: editor.
- **Body**: `{ text: string }`, con 1–10 000 caracteres tras `trim`.
- **Respuesta**: `200 ImageText`, con `status: 'ready'` y `editedAt`/`editedBy` llenos.
- **Efectos**: en un mismo `db.batch` se actualiza la fila y se registra `activityInsert(user, 'file.text_edit', file, { length })`.
- **Errores**:
  - `404` si el archivo no existe o no es visible.
  - `409` si el estado es `reading` o `unavailable`.
  - `422` si la validación falla.

## Envíos de invitados

### `POST /api/public/submissions` (existente, cambia)

- **Body**: cada archivo gana `withTextSource?: boolean`, con la misma regla que en `/api/uploads`.
- **Respuesta**: `GuestUploadTicket` gana `textSourceUploadUrl?: string`, un PUT prefirmado a
  `textsrc/<fileId>.jpg`.

### `POST /api/public/submissions/:id/complete` (existente, cambia)

La respuesta no cambia y su latencia no varía de forma perceptible: responde de inmediato y la lectura sigue en
segundo plano.

1. **Copias**: igual que hoy acepta o rechaza cada archivo. Para las HEIC aptas valida la copia JPEG como en
   `/api/uploads/:id/complete` (las validaciones de todas las HEIC del envío corren en paralelo, no una tras
   otra): si es válida guarda `text_source_key`; si no, marca `unavailable`.
2. **Lectura**: programa `runInBackground(() => readSubmissionImages(submissionId, { concurrency: 4 }))`, que
   lee las imágenes **aptas** del envío después de responder (FR-009, research A6).
   - **Pool**: 4 lecturas a la vez; cada una con los tiempos de `extractImageText` (research A11: principal 20 s
     sin reintento si hay respaldo, último candidato 30 s + 1 reintento, tope de 45 s), sin tope propio por lectura.
   - **Límite**: tras reclamar la fila, cada lectura pasa por `hitRateLimit(null, 'guest-text:<senderKey>', 20/h)`.
     Si se excede, la fila vuelve a `NULL` sin contar el intento.
   - **Presupuesto**: `AbortSignal.timeout(min(240 s, plazo real de la función - 15 s))` compartido; al vencer no
     se inician más lecturas: las no iniciadas quedan en `NULL` y las abortadas en `failed`/`timeout`. Se leerán
     cuando un revisor abra el envío.
   - **Cortacircuito**: un proveedor caído deja de usarse durante esa ejecución; si ambos lo están, las imágenes
     restantes quedan en `NULL` (research A6).
   - **Errores**: `readSubmissionImages` nunca lanza; ningún fallo de lectura cambia el código ni el cuerpo de
     la respuesta (FR-004).

A los servicios de lectura solo se envían los bytes de la imagen; nunca el nombre, la nota ni la IP (FR-019).

### `GET /api/submissions?status=` (existente, cambia)

Cada `SubmissionFile` gana `text: ImageText | null` (`null` si no es imagen).

### `GET /api/submissions/:id/files/:fileId/text`

- **Auth**: editor.
- **Respuesta**: `200 ImageText` del archivo del envío.
- **Errores**: `404` si el envío o el archivo no existen. No exige que el envío siga `pending`.
- **Uso**: consulta cada 3 s mientras una lectura sigue en `reading` (tarjeta de Pendientes).

### `POST /api/submissions/:id/files/:fileId/text`

Igual que `POST /api/files/:id/text`, pero sobre `guest_submission_files`. Es la red de seguridad de la lectura
en segundo plano al recibir (imágenes en `NULL` por el presupuesto o el límite) y sirve también para
Reintentar. La tarjeta lo llama sin `force` solo si el estado es `pending`; con `force: true` solo tras un
Reintentar del usuario.

- **Auth**: editor.
- **Condición**: el envío debe estar `pending`.
- **Errores**:
  - `404` si el envío o el archivo no existen.
  - `409` si el envío ya no está pendiente.

### `POST /api/submissions/:id/approve` (existente, cambia)

El `INSERT INTO files … SELECT` copia `text_status`, `text_content`, `text_error`, `text_attempts`,
`text_started_at`, `text_read_at` y `text_source_key`.

Si una lectura de invitado (red de seguridad en Pendientes) termina después de aprobar, su escritura actualiza
también `files` cuando el id coincide y el estado sigue en `reading` (ver research A5).

### `POST /api/submissions/:id/reject` y cron `/api/cron/cleanup` (existentes, cambian)

Las claves que se borran del bucket incluyen `text_source_key`. Para las subidas que nunca se completaron se
borra además `textsrc/<id>.jpg` (data-model, ciclo de vida). La purga de papelera hace lo mismo con `files`.

## Búsqueda

### `GET /api/files/search` (existente, cambia)

- **Coincidencia**: `files.name ILIKE $q OR files.text_content ILIKE $q`. Los filtros, el orden y el cursor no
  cambian.
- **Respuesta**: cada archivo gana `matchedIn: 'name' | 'text'`.

## Configuración

- Proveedor de IA (research A11): OpenAI es el principal y Gemini el respaldo; no hay variable para elegir. Un
  proveedor sin clave (`NUXT_OPENAI_APIKEY` o `NUXT_GOOGLE_APIKEY` vacías) se omite. Los endpoints y sus
  respuestas son los mismos con cualquiera de los dos: el DTO `ImageText` no dice quién leyó. Si ninguno está
  disponible o ambos fallan, la lectura termina en `failed` con Reintentar.
- `runtimeConfig.openaiBaseUrl` (`NUXT_OPENAI_BASE_URL`) es opcional. Vacío significa la URL de OpenAI. Solo los
  e2e lo usan, para apuntar al stub (research A9). No existe un equivalente para Google.
