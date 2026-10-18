# Data Model: Cloudy

**Fase 1** · 2026-10-14 · Fuente: [spec.md](./spec.md) (Key Entities) + [research.md](./research.md)

PostgreSQL (Neon) vía Drizzle ORM. Esquema en `server/db/schema.ts` (se elimina el `usersTable` de ejemplo). Identidad de usuarios en el esquema `neon_auth` administrado por Neon Auth — **Cloudy no escribe en él**; solo guarda el id (`text`).

Convenciones: ids `uuid` (`defaultRandom()`), tiempos `timestamptz` con `defaultNow()`, nombres de tabla/columna en `snake_case`, enums de Postgres.

---

## Enums

| Enum | Valores |
|------|---------|
| `user_role` | `admin`, `editor` |
| `user_status` | `pending`, `active`, `disabled`, `removed` |
| `file_category` | `image`, `audio`, `video`, `presentation`, `document` |
| `file_origin` | `team`, `guest` |
| `upload_status` | `uploading`, `ready` |
| `submission_status` | `pending`, `approved`, `rejected`, `expired` |
| `activity_action` | `file.upload`, `file.rename`, `file.move`, `file.trash`, `file.restore`, `file.purge`, `folder.create`, `folder.rename`, `folder.move`, `folder.trash`, `folder.restore`, `folder.purge`, `trash.empty`, `submission.approve`, `submission.reject`, `comment.admin_delete`, `user.activate`, `user.disable`, `user.role_change`, `user.remove` |

---

## `profiles` — Usuario (miembro del equipo)

| Columna | Tipo | Reglas |
|---------|------|--------|
| `user_id` | text **PK** | id de Neon Auth |
| `email` | text not null **unique** | copiado de la sesión; minúsculas |
| `name` | text not null | 1–80 caracteres |
| `role` | `user_role` null | null mientras `pending` |
| `status` | `user_status` not null default `pending` | |
| `created_at` / `updated_at` | timestamptz | |
| `approved_by` | text null → `profiles.user_id` | |

**Reglas**
- Primer perfil del sistema ⇒ `status='active', role='admin'` (FR-002) — decidido en una sola sentencia `INSERT … SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM profiles) …`.
- Acceso al área privada solo con `status='active'` y `role IS NOT NULL` (FR-005).
- Invariante: `COUNT(*) WHERE role='admin' AND status='active' ≥ 1` (FR-022) — toda mutación de rol/estado usa `UPDATE … WHERE NOT (target es el último admin activo)`; si afecta 0 filas ⇒ 409. Va precedida de `pg_advisory_xact_lock` en el mismo lote (`server/utils/users.ts`) para que dos admins no se quiten el rol a la vez.
- `removed`: se anonimiza `name` → "Usuario eliminado", el email se conserva para bloquear re-entrada.

**Transiciones**: `pending → active` (admin, asigna rol) · `active ⇄ disabled` · `pending|active|disabled → removed` (terminal) · `role: admin ⇄ editor` solo si `active`.

**Índices**: `(status, created_at)` (lista de usuarios con pendientes primero y conteo del pulso; migración 0001).

---

## `folders` — Carpeta

| Columna | Tipo | Reglas |
|---------|------|--------|
| `id` | uuid PK | |
| `parent_id` | uuid null → `folders.id` (on delete cascade) | null = raíz |
| `name` | text not null | 1–120 car., sin `/ \ : * ? " < > \|` |
| `created_by` | text → `profiles.user_id` | |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz null | en papelera si no es null |
| `deleted_by` | text null → `profiles.user_id` | |
| `trash_root_id` | uuid null | id del elemento que el usuario envió a la papelera (él mismo si es la raíz) |

**Índices**: `unique (parent_id, lower(name)) where deleted_at is null` (con `parent_id` coalesce a uuid nulo para la raíz); `(deleted_at)`; `(trash_root_id)`.

**Reglas**: mover una carpeta no puede crear ciclos (validado con CTE recursivo de ancestros). Nombre duplicado en destino ⇒ sufijo ` (2)`, ` (3)`… (edge case).

---

## `files` — Archivo (aprobado o del equipo)

| Columna | Tipo | Reglas |
|---------|------|--------|
| `id` | uuid PK | |
| `folder_id` | uuid null → `folders.id` | null = raíz |
| `name` | text not null | nombre visible con extensión, 1–200 car. |
| `extension` | text not null | de la lista permitida (FR-009) |
| `mime_type` | text not null | |
| `category` | `file_category` not null | derivado de la extensión |
| `size_bytes` | bigint not null | 1 … 104 857 600 (FR-010) |
| `storage_key` | text not null unique | `files/{uuid}` o `guest/{submissionId}/{uuid}` |
| `thumb_key` | text null | `thumbs/{uuid}.webp` |
| `upload_status` | `upload_status` not null default `uploading` | solo `ready` es visible |
| `origin` | `file_origin` not null | |
| `uploaded_by` | text null → `profiles.user_id` | null si `origin='guest'` |
| `guest_name` | text null | requerido si `origin='guest'` |
| `submission_id` | uuid null → `guest_submissions.id` | |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` / `deleted_by` / `trash_root_id` | igual que `folders` | |

**Índices**: `unique (folder_id, lower(name)) where deleted_at is null and upload_status='ready'`; `(folder_id, created_at desc)`; `(category)`; búsqueda por nombre: índice `gin (name gin_trgm_ops)` (extensión `pg_trgm`) para `ILIKE '%q%'` rápido (SC-004 con 5 000 archivos); `(deleted_at)`; `(upload_status, created_at)` para limpieza.

**Visibilidad (FR-017, FR-034)**: listados, búsquedas y totales filtran siempre `deleted_at IS NULL AND upload_status='ready'`.

**Estados**: `uploading → ready` (endpoint `complete` tras validar tamaño + firma) · `uploading → (borrado)` (validación fallida o >24 h, cron) · `ready → en papelera (deleted_at)` · `papelera → ready (restaurar)` · `papelera → purgado` (manual o cron >30 d; borra objetos S3 + fila).

---

## `guest_submissions` — Envío de invitado

| Columna | Tipo | Reglas |
|---------|------|--------|
| `id` | uuid PK | |
| `sender_name` | text not null | 1–80 car. (FR-016) |
| `note` | text null | ≤ 500 car. |
| `status` | `submission_status` not null default `pending` | |
| `sender_key` | text not null | hash SHA-256 de IP + sal (rate limit; no se guarda la IP) |
| `created_at` | timestamptz | |
| `completed_at` | timestamptz null | cuando el invitado cerró la subida (`complete`); el aviso en vivo y la cola usan esto, no `created_at` (migración 0002) |
| `reviewed_by` | text null → `profiles.user_id` | |
| `reviewed_at` | timestamptz null | |
| `target_folder_id` | uuid null → `folders.id` | al aprobar |
| `rejection_reason` | text null | ≤ 300 car. |

**Índices**: `(status, created_at)`.

**Transiciones**: `pending → approved` | `rejected` | `expired` (cron, `created_at < now() − 7 d`). Todas con `UPDATE … WHERE id=$1 AND status='pending' RETURNING` — si 0 filas ⇒ 409 "ya fue revisado por otra persona" (edge case de concurrencia).
- **approve**: en `db.batch`: actualizar envío + `INSERT INTO files … SELECT` desde `guest_submission_files` (`origin='guest'`, `guest_name`, `storage_key` reutilizado, nombres con sufijo si chocan) + `activity_log`.
- **reject/expire**: borrar objetos S3 (`DeleteObjects`) y filas hijas; no pasa por papelera.

## `guest_submission_files`

| Columna | Tipo | Reglas |
|---------|------|--------|
| `id` | uuid PK | |
| `submission_id` | uuid → `guest_submissions.id` (cascade) | |
| `original_name` / `extension` / `mime_type` / `category` / `size_bytes` | como `files` | |
| `storage_key` | text unique | `guest/{submissionId}/{uuid}` |
| `upload_status` | `upload_status` | el envío solo se notifica cuando todos sus archivos están `ready` |

Límite: máx. 20 archivos por envío.

---

## `comments` — Comentario

| Columna | Tipo | Reglas |
|---------|------|--------|
| `id` | uuid PK | |
| `file_id` | uuid → `files.id` (cascade al purgar) | |
| `author_id` | text → `profiles.user_id` | |
| `body` | text not null | 1–2 000 car. tras `trim` (FR-038) |
| `created_at` | timestamptz | |
| `edited_at` | timestamptz null | no null ⇒ "editado" (FR-039) |

**Índices**: `(file_id, created_at)`.
**Reglas**: editar/borrar solo el autor; borrar también admin (registra `comment.admin_delete` con `target_type = 'file'` y `meta.author`). No se puede comentar ni editar comentarios de un archivo en papelera (edge case → 409); su hilo tampoco se lee (404). Se conservan al enviar a papelera y restaurar (FR-040). `comment_count` se calcula con subconsulta agregada en el listado.

---

## `activity_log` — Registro de actividad

| Columna | Tipo | Reglas |
|---------|------|--------|
| `id` | bigint identity PK | orden total; también sirve de cursor |
| `actor_id` | text null → `profiles.user_id` | null = sistema (cron) |
| `actor_label` | text not null | nombre al momento (persiste si el usuario se elimina) |
| `action` | `activity_action` not null | |
| `target_type` | text not null | `file` / `folder` / `submission` / `user` / `comment` / `trash` |
| `target_id` | text null | |
| `target_label` | text not null | p. ej. nombre del archivo |
| `meta` | jsonb null | p. ej. `{ from, to }` en move/role_change |
| `created_at` | timestamptz | |

**Índices**: `(created_at desc)`, `(actor_id)`. Solo lectura para admin (FR-023). Inserción en el mismo `db.batch` que la operación auditada.

---

## `rate_limits`

| Columna | Tipo |
|---------|------|
| `key` | text |
| `window_start` | timestamptz |
| `count` | integer not null default 0 |

PK `(key, window_start)`. Upsert atómico (research R3). Cron borra ventanas > 1 d.

---

## Relaciones (resumen)

```text
neon_auth.user (externo) 1──1 profiles
profiles 1──* folders(created_by) · files(uploaded_by) · comments(author) · activity_log(actor)
folders  1──* folders(parent) · files(folder)
guest_submissions 1──* guest_submission_files
guest_submissions 1──* files(submission_id)   [tras aprobar]
files 1──* comments
```

## Operaciones de papelera (FR-034–FR-037)

- **Enviar a papelera** (carpeta): CTE recursivo marca carpeta + descendientes (carpetas y archivos no borrados) con `deleted_at=now()`, `deleted_by`, `trash_root_id = <id carpeta>`. Elementos ya en papelera antes conservan su propio `trash_root_id`.
- **Listado papelera**: filas donde `trash_root_id = id` (solo raíces), con `daysLeft(trashPurgeAt(deleted_at))` (días enteros hasta `deleted_at + 30 d`, redondeando hacia arriba, nunca negativo) y ruta original reconstruida. `itemCount` de una carpeta = filas que comparten su `trash_root_id` sin contar la propia carpeta (todo su contenido, a cualquier profundidad), igual que la confirmación de borrado (`/api/folders/:id/count`) y `meta.items` de `folder.trash`. `bytes` = suma de `size_bytes` de esos archivos.
- **Restaurar**: limpia `deleted_at/deleted_by/trash_root_id` de todas las filas con ese `trash_root_id` en un `db.batch` atómico junto con la actividad. Si el padre original está en papelera ⇒ la raíz se mueve a "Archivos" (`movedToRoot`) y se informa (edge case). Un padre purgado no puede existir: la cascada habría borrado al hijo. Conflicto de nombre ⇒ sufijo solo en la raíz.
- **Purgar**: primero filas, luego objetos. Una sola sentencia borra las raíces vigentes y **todos** los archivos del subárbol de cada carpeta raíz, incluidos los que se enviaron antes a la papelera con otra raíz y que caerían en cascada. Esa sentencia devuelve sus `storage_key`/`thumb_key`, que después se borran del bucket en lotes de 1000. Si el bucket falla solo quedan objetos sin referencia (se registra en el log), nunca filas que apunten a objetos inexistentes. Los comentarios caen en cascada.
- **Espacio usado (FR-037)**: `SUM(size_bytes)` separado por `deleted_at IS NULL` vs. no null, sobre `upload_status='ready'`.
