# Data Model: Extracción del texto de notas e intenciones de oración

**Fase 1** del plan · 2026-10-19 · Base: [001 data-model](../001-shared-media-drive/data-model.md) ·
Investigación: [research.md](./research.md)

## Decisión: columnas en la fila de la imagen, no una tabla aparte

El "Texto extraído" de la spec se guarda como columnas `text_*` en **`files`** y en **`guest_submission_files`**.

- **Ciclo de vida gratis (FR-010, FR-017)**: la papelera, la restauración, la purga, el rechazo y la caducidad
  ya mueven o borran esas filas. El texto las sigue sin código extra y sin riesgo de huérfanos.
- **Aprobación sin cambios de modelo**: aprobar ya hace `INSERT INTO files … SELECT` desde
  `guest_submission_files` reutilizando `id` y `storage_key`. Basta con copiar también las columnas `text_*`
  (FR-010: no se vuelve a leer).
- **Búsqueda**: la búsqueda filtra directamente sobre `files`, sin JOIN.

Alternativa descartada: una tabla `image_texts` con una FK a cada tabla. Exigiría borrados explícitos en purga,
rechazo y cron, que son justo los flujos donde la Constitución II prohíbe dejar huérfanos.

## Enum nuevo

```text
image_text_status: reading | ready | empty | failed | unavailable
```

- `NULL` significa **pendiente / aún no leída** (FR-005 "pendiente"). Así las imágenes subidas antes de la
  feature no necesitan backfill (FR-001b).
- Los archivos que no son imágenes también quedan en `NULL`, pero la UI no muestra panel para ellos
  (`category <> 'image'`).
- `text_status` es independiente de `files.status` (`upload_status`: `uploading`/`ready`) y de `guest_submissions.status` (`pending`…). En código y tests se nombra siempre la columna completa.

## Cambios en tablas

### `files` (existente) — columnas nuevas

| Columna | Tipo | Nulo | Notas |
|---------|------|------|-------|
| `text_status` | `image_text_status` | sí | `NULL` = pendiente |
| `text_content` | `text` | sí | Solo si `ready`; ≤ 10 000 caracteres (CHECK) |
| `text_error` | `text` | sí | Código interno: `timeout`, `provider`, `rate_limited`, `invalid_input`, `invalid_output` |
| `text_source_key` | `text` | sí | Solo HEIC: clave de la copia JPEG `textsrc/<id>.jpg` que subió el navegador (research A4). Se borra del bucket junto con el archivo |
| `text_attempts` | `smallint` | no, default 0 | Se incrementa en cada reclamación |
| `text_started_at` | `timestamptz` | sí | Momento de la reclamación; una lectura con más de 90 s se puede volver a reclamar (FR-007), incluida una tarea de segundo plano que la plataforma detuvo |
| `text_read_at` | `timestamptz` | sí | Última lectura terminada |
| `text_edited_by` | `uuid` → `profiles.user_id` ON DELETE SET NULL | sí | FR-014 |
| `text_edited_at` | `timestamptz` | sí | FR-014; la UI muestra "editado" si no es nulo |

### `guest_submission_files` (existente) — columnas nuevas

`text_status`, `text_content`, `text_error`, `text_attempts`, `text_started_at`, `text_read_at` y
`text_source_key`, con los mismos tipos. No lleva columnas de edición: en Pendientes el texto solo se lee y se
reintenta; se edita después de aprobar.

### Ciclo de vida del objeto `text_source_key` (Constitución II: sin huérfanos)

La copia JPEG es un objeto más del bucket, como la miniatura. Se borra en los mismos puntos que el original:

| Flujo existente | Cambio |
|-----------------|--------|
| Purga de papelera (`server/utils/trash.ts` → `purge`) | El CTE devuelve también `text_source_key` y se pasa a `deleteMany` |
| Rechazo de envío | Las claves a borrar incluyen `text_source_key` de cada archivo |
| Cron: envíos caducados y subidas huérfanas (equipo e invitados) | Se borra también `textsrc/<id>.jpg`, derivada del id, aunque la columna esté vacía porque la subida nunca se completó |
| Descarte de subida (`discardUpload`, `DELETE /api/uploads/:id`) | Se borra también `textsrc/<id>.jpg` |
| Aprobación | Se copia `text_source_key`: la clave no cambia porque el id se reutiliza |

### `activity_action` (enum existente)

Se agrega `file.text_edit` (FR-018) con `ALTER TYPE … ADD VALUE`. En `meta` se guarda `{ length }`, nunca el
texto: el registro de actividad no debe duplicar contenido sensible.

## Restricciones e índices (SQL manual en la migración, como en `0000`)

```sql
ALTER TABLE files ADD CONSTRAINT files_text_length CHECK (text_content IS NULL OR char_length(text_content) <= 10000);
ALTER TABLE guest_submission_files ADD CONSTRAINT guest_files_text_length CHECK (text_content IS NULL OR char_length(text_content) <= 10000);
CREATE INDEX files_text_trgm_idx ON files USING gin (text_content gin_trgm_ops);   -- FR-015 / SC-006
```

No se indexa `text_status`: solo se consulta por `id`, que es la clave primaria.

## Reglas de validación

| Regla | Dónde |
|-------|-------|
| Apta para lectura: `category = 'image'`, extensión `jpg`/`jpeg`/`png`/`heic` y `size_bytes ≤ 5 242 880`; además, si es `heic`, `text_source_key` no nulo | `shared/constants/image-text.ts` → `isImageTextEligible()` (la parte del archivo, usada también por el cliente para decidir si genera la copia) + `server/utils/image-text.ts` (la copia) |
| Copia JPEG de una HEIC: 0 < tamaño ≤ 5 242 880 y firma JPEG | Al completar la subida (equipo e invitado), con `head` + `matchesSignature('jpg', …)` |
| Entrada y salida del modelo | Zod, `server/ai/schemas.ts` (research A3) |
| Edición manual: 1–10 000 caracteres tras `trim` | `shared/validation/image-text.ts` (validador propio, como el resto de los cuerpos HTTP) + CHECK |
| Solo admin y editor leen, reintentan o editan | `requireRole(event, 'editor')` en cada endpoint |

## Transiciones

| Desde | Acción | Hacia | Quién |
|-------|--------|-------|-------|
| — (subida HEIC sin copia válida) | completar la subida | `unavailable` | sistema |
| `NULL` (no apta) | completar la subida, recibir o abrir | `unavailable` | sistema |
| `NULL` | completar la subida (equipo, en segundo plano) o recibir el envío (invitado, en segundo plano, hasta 4 a la vez) | `reading` | sistema |
| `NULL` | abrir la vista previa o la tarjeta de Pendientes (respaldo: imagen sin leer) | `reading` | sistema |
| `failed` | Reintentar | `reading` | admin/editor |
| `ready`, `empty` | Volver a leer (con confirmación si `text_edited_at` no es nulo) | `reading` | admin/editor |
| `reading` | resultado válido con texto | `ready` | sistema |
| `reading` | `hasText: false` | `empty` | sistema |
| `reading` | error, timeout o salida inválida | `failed` | sistema |
| `NULL`, `ready`, `empty`, `failed` | editar y guardar | `ready` (+ `text_edited_*`, `text_error = NULL`) | admin/editor |

Al **volver a leer**, se limpian `text_edited_by` y `text_edited_at` porque la corrección manual se reemplaza.
`unavailable` es terminal: no ofrece reintento, porque la elegibilidad depende del archivo y no cambia.

## DTO compartido (`shared/types/api.ts`)

```ts
type ImageTextStatus = 'pending' | 'reading' | 'ready' | 'empty' | 'failed' | 'unavailable'
interface ImageText {
  status: ImageTextStatus        // NULL de la BD → 'pending'
  text: string | null            // solo en 'ready'
  error: 'timeout' | 'provider' | 'rate_limited' | 'invalid_input' | 'invalid_output' | null
  readAt: string | null
  editedAt: string | null
  editedBy: string | null        // nombre visible
}
```

- Una fila en `reading` con `text_started_at` de más de 90 s se devuelve como `status: 'failed'`, `error: 'timeout'`
  (FR-007), tanto si la lectura venció en una petición como si la tarea de segundo plano fue detenida. La fila no
  cambia: la siguiente reclamación la toma por la regla de lectura vencida.
- `SubmissionFile` gana `text: ImageText | null` (`null` si no es imagen).
- `FileItem` no cambia: el texto se pide aparte para no inflar listados.
- Los resultados de búsqueda ganan `matchedIn: 'name' | 'text'`.
