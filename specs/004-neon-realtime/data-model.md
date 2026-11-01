# Data Model: Actualización en vivo sin sondeo

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md) · **Contratos**: [api.md](./contracts/api.md), [ui.md](./contracts/ui.md)

## Esquema: sin cambios

- **No hay migración Drizzle**, ni tablas, columnas, índices, enums o CHECKs nuevos (spec FR-024). `bun run db:generate` no debe
  producir nada; si produce un archivo, se detiene la tarea.
- Todas las tablas que se leen en vivo tienen clave primaria (identidad de réplica estable):

| Tabla | Clave primaria | Se lee desde |
|-------|---------------|--------------|
| `profiles` | `user_id` | guarda de autorización de todas las consultas; cuentas pendientes |
| `guest_submissions` | `id` | envíos listos (equipo) |
| `guest_submission_files` | `id` | envíos listos (conteo de archivos) y texto de imágenes de envíos |
| `guest_access_requests` | `id` | solicitudes abiertas (equipo) y estado del invitado |
| `files` | `id` | texto de imágenes de la biblioteca; comprobación de "archivo listo" de los comentarios |
| `comments` | `id` | hilo de comentarios |

- Los índices existentes ya cubren los filtros de las consultas (principio I): `guest_access_requests_status_created_idx`,
  `guest_access_requests_token_idx`, `profiles_status_created_idx`, `comments_file_created_idx`,
  `guest_submission_files_submission_idx`.

## Consultas en vivo (resultado = lista de filas con clave estable)

Reglas de todas las consultas (research C3, C4, C5, C12): **una sola sentencia `SELECT`**, sin `;`, sin `now()` ni funciones no
deterministas, `$1` = id de usuario de la sesión (salvo la del invitado), parámetros sin tipo con cast (`$2::uuid`), conteos con
`::int`, `LIMIT` fijo, y la **guarda de autorización dentro de la consulta**. Los fragmentos de guarda:

```sql
-- EDITOR_GUARD: admin o editor activo (roles = rolesAllowed('submissions.review') de shared/permissions.ts)
EXISTS (SELECT 1 FROM profiles me WHERE me.user_id = $1 AND me.status = 'active' AND me.role IN ('admin', 'editor'))
-- ADMIN_GUARD: solo administrador activo (rolesAllowed('users.manage'))
EXISTS (SELECT 1 FROM profiles me WHERE me.user_id = $1 AND me.status = 'active' AND me.role IN ('admin'))
```

Los roles de los `IN (…)` se generan desde `shared/permissions.ts` (no se escriben a mano) y una prueba unitaria compara el
resultado con `can()`. SQL de diseño (el definitivo lo fija el spike T003 y vive en `server/utils/live-queries.ts`):

### Equipo (`POST /api/realtime/team`) — US1

| Clave | Fuente | Columnas | Clave de fila | Tope |
|-------|--------|----------|---------------|------|
| `submissions` | mismo fragmento que `readyPendingSubmissionsSql` + `EDITOR_GUARD` | `id`, `sender_name`, `created_at`, `completed_at`, `file_count` (`count(f.id)::int`) | `id` | 200 |
| `accessRequests` | `guest_access_requests WHERE status = 'open'` + `EDITOR_GUARD` | `id`, `sender_name`, `created_at`, `expires_at` | `id` | 50 |
| `pendingUsers` | `profiles WHERE status = 'pending'` + `ADMIN_GUARD` | `user_id`, `created_at` | `user_id` | 200 |

```sql
-- submissions (EDITOR_GUARD añadido al WHERE del fragmento compartido)
SELECT s.id, s.sender_name, s.created_at, s.completed_at, count(f.id)::int AS file_count
FROM guest_submissions s
JOIN guest_submission_files f ON f.submission_id = s.id AND f.upload_status = 'ready'
WHERE s.status = 'pending' AND s.completed_at IS NOT NULL AND <EDITOR_GUARD>
GROUP BY s.id ORDER BY s.completed_at DESC LIMIT 200

-- accessRequests: la vigencia (expires_at > ahora) la filtra el navegador (research C5)
SELECT r.id, r.sender_name, r.created_at, r.expires_at
FROM guest_access_requests r
WHERE r.status = 'open' AND <EDITOR_GUARD> ORDER BY r.created_at ASC LIMIT 50

-- pendingUsers: un no-administrador recibe 0 filas
SELECT p.user_id, p.created_at FROM profiles p
WHERE p.status = 'pending' AND <ADMIN_GUARD> ORDER BY p.created_at DESC LIMIT 200
```

- Contadores: `pendingCount = submissions.length`; `openAccessRequests = accessRequests.filter(r => expiresAt > ahora + skew).length`;
  `pendingUsers = pendingUsers.length`.
- `GROUP BY s.id` es válido porque `s.id` es la clave primaria y `s.sender_name`/`s.created_at`/`s.completed_at` dependen
  funcionalmente de ella; es la misma forma que usa el REST hoy.

### Invitado (`POST /api/public/access/live`) — US2

| Clave | Fuente | Columnas | Clave de fila | Tope |
|-------|--------|----------|---------------|------|
| `access` | `guest_access_requests WHERE token_hash = $1` | `id`, `status`, `sender_name`, `expires_at`, `access_expires_at` | `id` | 1 |

- `$1` = hash SHA-256 de la cookie `cloudy-guest-access`, sin guarda de rol (el hash **es** la autorización: solo quien tiene
  el token conoce el hash). **Nunca** se selecciona `token_hash`, `decided_by`, `sender_key` ni `submission_id`.
- El estado visible es `accessStateOf({ status, expiresAt, accessExpiresAt }, ahora + skew)`; sin fila → `none`.

### Archivo (`POST /api/realtime/files/:id`) — US3

| Clave | Fuente | Columnas | Clave de fila | Tope |
|-------|--------|----------|---------------|------|
| `comments` | espejo de `listComments` + `commentFileQuery` + `EDITOR_GUARD` | `id`, `file_id`, `author_id`, `author_name`, `body`, `created_at`, `edited_at` | `id` | 500 |
| `text` | `files WHERE id = $2::uuid` + `EDITOR_GUARD` | ver abajo | `id` | 1 |

```sql
SELECT c.id, c.file_id, c.author_id, a.name AS author_name, c.body, c.created_at, c.edited_at
FROM comments c
LEFT JOIN profiles a ON a.user_id = c.author_id
WHERE c.file_id = $2::uuid
  AND EXISTS (SELECT 1 FROM files f WHERE f.id = c.file_id AND f.upload_status = 'ready')
  AND <EDITOR_GUARD>
ORDER BY c.created_at ASC, c.id ASC LIMIT 500
```

- `canEdit`/`canDelete` **no** vienen de la consulta: se derivan en el cliente (`authorId === me.userId`; `isAdmin`), igual que
  `toComment` en el servidor. La moderación sigue verificándose en cada endpoint de escritura.
- Un comentario borrado sale del resultado (el cliente lo quita por reemplazo de `rows`).

### Texto de imagen (`files/:id` y `submissions/:id/files/:fileId/text`) — US3

Columnas de `text`: `id`, `text_status`, `text_content`, `text_error`, `text_started_at`, `text_read_at`, `text_edited_at` y
`edited_by_name` (`LEFT JOIN profiles` por `text_edited_by`; solo `files`). Para un archivo de envío:
`guest_submission_files WHERE id = $3::uuid AND submission_id = $2::uuid` (sin edición, sin `edited_by_name`).

- El DTO visible es `imageTextOf(fila, ahora + skew)` (función pura **compartida**, research C5): mapea `text_status` a
  `pending | reading | ready | empty | failed | unavailable` y aplica `READING_STALE_MS` (90 s) a `reading`.
- `text_content` solo se expone si `text_status = 'ready'` (la función lo descarta en los demás casos, como hoy).
- El cliente solo se suscribe mientras `status === 'reading'` (FR-014) y cancela al llegar a un estado final.

## Estado de la suscripción (cliente)

`LiveStatus` en `shared/types/api.ts`:

| Estado | Significado | Se muestra |
|--------|-------------|-----------|
| `connecting` | sellando o esperando el primer resultado | `SkeletonList` |
| `live` | recibiendo cambios | contenido o `EmptyState` (según las filas) |
| `stale` | pestaña oculta o sin conexión: el permiso no se renueva | el contenido último (sin parpadeo) |
| `error` | permiso vencido sin renovar, error de conexión del cliente o respuesta de sellado fallida | `ErrorState` con "Reintentar" |

```text
connecting ──(primer resultado)──▶ live ──(oculta u offline)──▶ stale ──(vuelve)──▶ renovar ──▶ live
     │                              │                             │
     └──────(falla el sellado)──────┴────────(permiso vence)──────┴──▶ error ──(Reintentar: sellar de nuevo,
                                                                                  cliente nuevo si falló la conexión)──▶ connecting
401 / 409 en una renovación ──▶ recarga completa (una sola vez, marca de módulo)
```

- El permiso dura ≈ 60 s; se renueva ≈ 10 s antes con reintento cada 1 s (≤ 10 intentos) y se pausa en `stale`.
- `error` es **final** para esa suscripción (aunque se renueve): `retry()` siempre pide un sellado nuevo.

## Registro de avisos (cliente, `useTeamLive`)

- `announced: Set<string>` a nivel de módulo (solo en el cliente): ids de solicitudes y envíos ya anunciados; si pasa de 500, se
  vacía (igual que hoy).
- **Diferencia de conjuntos**: para cada instantánea `rows`, `nuevos = ids(rows) − announced`. La **primera** instantánea de la
  sesión del layout no anuncia: solo siembra `announced` (spec FR-003). Un reemplazo posterior de `rows` (reconexión) no repite
  porque los ids ya están en `announced`.
- Las solicitudes cuya vigencia ya venció (según `skew`) no se anuncian ni se cuentan.
- Estado en `useState`: `useTeamLive` **conserva los nombres que ya leen los consumidores** (`pendingCount`, `pendingUsers`,
  `openAccessRequests`) para no tocar su código más de lo necesario; las claves internas de `useState` pasan de `pulse-*` a
  `team-*` y se agregan `live` (booleano: ya hubo un primer resultado, lo que usa Inicio para pasar del resumen del servidor
  a lo en vivo), `submissionIds` y `userIds` (listas de ids que observan Solicitudes y Usuarios), además de `status`.

## Desfase de reloj (cliente)

- `skew = serverTime − Date.now()`, en `useState` (compartido por todas las instancias, como `guest-clock-skew` hoy). El
  equipo lo toma de `serverTime` en la respuesta de sellado; el invitado conserva la cabecera `Date`.
- Hasta tener `skew` no se filtra por vigencia con el reloj local: manda lo que dice el servidor (igual que `useGuestAccess`).

## Tipos compartidos (`shared/types/api.ts`)

- **Nuevos**: `LiveStatus`; `RealtimeSeal<K extends string>` = `{ url: string, serverTime: string, expiresAt: string, queries: Record<K, SealedQuery> }`
  (con `SealedQuery` tomado como tipo del cliente del SDK; nombre exacto confirmado en el spike); filas en vivo
  `LiveSubmissionRow`, `LiveAccessRequestRow`, `LivePendingUserRow`, `LiveGuestAccessRow`, `LiveCommentRow`, `LiveImageTextRow`.
- **Sin cambios**: `AccessState`, `GuestAccess`, `AccessRequest`, `Submission`, `Comment`, `ImageText`, `DashboardSummary`.
- **Eliminado** (Polish): `Pulse` (`shared/types/api.ts:170`).

## Validación (`shared/validation/realtime.ts`)

| Entrada | Regla |
|---------|-------|
| `expectedUserId` | texto de 1 a 200 caracteres (id de Neon Auth); requerido en los 3 endpoints de sesión |
| `:id`, `:fileId` | UUID (`paramId`) |
| Cuerpo extra | rechazado (campo no permitido), como el resto de validadores del proyecto |

## Retención y limpieza

Sin cambios: nada se persiste. El permiso sellado no se guarda en la base, en registros ni en el almacenamiento del navegador.
