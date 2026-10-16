# Contrato HTTP: API de Cloudy

Rutas de servidor Nitro bajo `server/api/**` (Nuxt). JSON en ambos sentidos salvo indicación. Fechas ISO-8601. Errores con `createError({ statusCode, statusMessage, data })` → cuerpo:

```json
{ "statusCode": 422, "statusMessage": "Validation failed", "data": { "errors": { "name": "El nombre es obligatorio" } } }
```

**Acceso** — `public`: sin sesión · `session`: sesión válida (cualquier estado) · `editor`: perfil `active` con rol `editor` o `admin` · `admin`: perfil `active` rol `admin` · `cron`: `Authorization: Bearer $CRON_SECRET`. Fallo de sesión ⇒ **401**; rol/estado insuficiente ⇒ **403** (FR-008, SC-009).

Códigos comunes: 400 entrada mal formada · 401 · 403 · 404 · 409 conflicto (concurrencia / último admin / ya revisado / en papelera) · 413 archivo > 100 MB · 415 tipo no permitido · 422 validación o firma binaria inválida · 429 rate limit (`Retry-After`).

Tipos compartidos en `shared/types/api.ts` (`FileItem`, `FolderItem`, `Profile`, `Submission`, `Comment`, `ActivityEntry`, `TrashItem`, `Pulse`).

---

## Autenticación (proxy Neon Auth)

| Método | Ruta | Acceso | Notas |
|--------|------|--------|-------|
| `*` | `/api/auth/**` | public | Proxy transparente a Neon Auth (`handleAuthProxyRequest`). Endpoints Better Auth: `sign-up/email`, `sign-in/email`, `sign-out`, `get-session`, `request-password-reset`, `reset-password`, `change-password`, `update-user`. Rate limit en `sign-in/*` y `request-password-reset` (5 / 15 min por IP+email ⇒ 429). |
| `GET` | `/api/me` | session | `{ user: { id, email, name }, profile: Profile }`. Crea el perfil si no existe (primer usuario ⇒ admin activo). 401 sin sesión. |
| `PATCH` | `/api/me` | session (active) | `{ name }` → actualiza `profiles.name` (y `update-user` en Neon Auth desde el cliente). |

## Dashboard

| Método | Ruta | Acceso | Respuesta |
|--------|------|--------|-----------|
| `GET` | `/api/dashboard` | editor | `{ recentFiles: FileItem[8], pendingCount, totalsByCategory: Record<category,{count,bytes}>, storage: { activeBytes, trashBytes } }` (FR-026, FR-037) |
| `GET` | `/api/realtime/pulse?since=<cursor>` | editor | `{ cursor, pendingCount, pendingUsers, newSubmissions: { id, senderName, fileCount, createdAt }[] }` — consulta indexada, sondeada cada 5 s (research R7). `newSubmissions` filtra por `completed_at > since`; `pendingUsers` solo trae el valor real para admin (0 para editor). |

## Carpetas y archivos

| Método | Ruta | Acceso | Cuerpo / Query | Respuesta |
|--------|------|--------|----------------|-----------|
| `GET` | `/api/folders/:id/children` (`:id` = `root` para la raíz) | editor | `?sort=name\|date\|size&dir=asc\|desc&type=<category>&cursor=` | `{ folder, breadcrumbs[], folders: FolderItem[], files: FileItem[], nextCursor }` (cursor, 60 por página) |
| `GET` | `/api/folders/tree` | editor | — | árbol ligero `{ id, name, parentId }[]` para el selector "mover a / aprobar en" |
| `POST` | `/api/folders` | editor | `{ name, parentId \| null }` | `201 FolderItem` (nombre con sufijo si choca) |
| `PATCH` | `/api/folders/:id` | editor | `{ name? , parentId? }` | `FolderItem` — 409 si crea un ciclo |
| `DELETE` | `/api/folders/:id` | editor | — | `{ trashedItems: number }` → a papelera (FR-011, FR-034) |
| `GET` | `/api/files/search` | editor | `?q=&type=&sort=&dir=&cursor=` | `{ files: FileItem[] (con ruta), nextCursor }` (FR-012) |
| `GET` | `/api/files/:id` | editor | — | `FileItem` + `{ path[], commentCount }` |
| `PATCH` | `/api/files/:id` | editor | `{ name?, folderId? }` | `FileItem` (extensión inmutable) |
| `DELETE` | `/api/files/:id` | editor | — | `204` → a papelera |
| `GET` | `/api/files/:id/content` | editor | `?download=1` | **302** a URL GET firmada (15 min); `download=1` fuerza `Content-Disposition: attachment` (FR-013, FR-014) |
| `GET` | `/api/files/:id/thumbnail` | editor | — | **302** a URL firmada de la miniatura; 404 si no tiene |

### Subida (dos fases, research R5)

| Método | Ruta | Acceso | Cuerpo | Respuesta |
|--------|------|--------|--------|-----------|
| `POST` | `/api/uploads` | editor | `{ folderId \| null, name, size, mimeType, withThumbnail: boolean }` | `201 { fileId, uploadUrl, thumbUploadUrl?, headers: { "content-type" } }` — 413 / 415 / 422 antes de subir (FR-009, FR-010) |
| `POST` | `/api/uploads/:fileId/complete` | editor | — | `FileItem` (`ready`) — 422 si tamaño real ≠ declarado o firma binaria no coincide (el objeto se borra) |
| `DELETE` | `/api/uploads/:fileId` | editor | — | `204` cancela una subida en curso y borra el objeto |

El navegador hace `PUT uploadUrl` con el `Content-Type` firmado; el progreso se reporta con `XMLHttpRequest.upload.onprogress`.

## Papelera

| Método | Ruta | Acceso | Respuesta |
|--------|------|--------|-----------|
| `GET` | `/api/trash` | editor | `TrashItem[]` = `{ id, kind: file\|folder, name, originalPath, deletedBy, deletedAt, daysLeft, itemCount, bytes }` (FR-034, FR-036) |
| `POST` | `/api/trash/:kind/:id/restore` | editor | `{ restoredTo: { folderId \| null, path }, movedToRoot: boolean }` (FR-035) |
| `DELETE` | `/api/trash/:kind/:id` | editor | `204` purga definitiva |
| `DELETE` | `/api/trash` | **admin** | `{ purged: number }` vaciar papelera |

## Comentarios

| Método | Ruta | Acceso | Cuerpo | Respuesta |
|--------|------|--------|--------|-----------|
| `GET` | `/api/files/:id/comments` | editor | `?since=<ISO>` | `Comment[]` = `{ id, body, author: {id,name}, createdAt, editedAt, canEdit, canDelete }` |
| `POST` | `/api/files/:id/comments` | editor | `{ body }` (1–2000) | `201 Comment` — 409 si el archivo está en papelera |
| `PATCH` | `/api/comments/:id` | editor (autor) | `{ body }` | `Comment` — 403 si no es el autor |
| `DELETE` | `/api/comments/:id` | editor (autor) o admin | — | `204` |

## Envíos de invitados

| Método | Ruta | Acceso | Cuerpo | Respuesta |
|--------|------|--------|--------|-----------|
| `POST` | `/api/public/submissions` | **public** | `{ senderName, note?, files: { name, size, mimeType }[] (1–20) }` | `201 { submissionId, uploads: { fileId, uploadUrl, headers }[] }` — 429 rate limit (5/h por IP), 413/415/422 |
| `POST` | `/api/public/submissions/:id/complete` | **public** | — | `{ status: "pending" }` — valida firmas; solo entonces el envío es visible para el equipo |
| `GET` | `/api/submissions` | editor | `?status=pending\|approved\|rejected\|expired` | `Submission[]` = `{ id, senderName, note, status, createdAt, expiresAt, files: { id, name, category, size, previewUrl }[] }` |
| `GET` | `/api/submissions/:id/files/:fileId/content` | editor | — | **302** URL firmada (previsualizar antes de aprobar) |
| `POST` | `/api/submissions/:id/approve` | editor | `{ folderId \| null }` | `{ files: FileItem[] }` — 409 si ya fue revisado (FR-019) |
| `POST` | `/api/submissions/:id/reject` | editor | `{ reason? }` (≤300) | `204` — borra objetos; 409 si ya fue revisado |

## Usuarios (solo admin)

| Método | Ruta | Acceso | Cuerpo | Respuesta |
|--------|------|--------|--------|-----------|
| `GET` | `/api/users` | admin | `?status=&page=&pageSize=` | `{ items: Profile[], total }` (pendientes primero) |
| `PATCH` | `/api/users/:id` | admin | `{ status?: active\|disabled, role?: admin\|editor }` | `Profile` — 409 si deja al sistema sin admin activo (FR-022); activar exige `role` |
| `DELETE` | `/api/users/:id` | admin | — | `204` → `status='removed'`; 409 si es el último admin |

## Actividad (solo admin)

| Método | Ruta | Acceso | Respuesta |
|--------|------|--------|-----------|
| `GET` | `/api/activity` | admin | `?cursor=<id>&actor=&action=` → `{ items: ActivityEntry[], nextCursor }` (FR-023) |

## Cron

| Método | Ruta | Acceso | Respuesta |
|--------|------|--------|-----------|
| `GET` | `/api/cron/cleanup` | cron | `{ purgedTrash, expiredSubmissions, orphanUploads, rateLimitRows }` — idempotente (research R8) |
