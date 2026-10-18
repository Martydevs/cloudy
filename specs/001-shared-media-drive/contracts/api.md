# Contrato HTTP: API de Cloudy

Rutas de servidor Nitro bajo `server/api/**` (Nuxt). JSON en ambos sentidos salvo indicación. Fechas ISO-8601. Errores con `createError({ statusCode, statusMessage, data })` → cuerpo:

```json
{ "statusCode": 422, "statusMessage": "Validation failed", "data": { "errors": { "name": "El nombre es obligatorio" } } }
```

**Acceso** — `public`: sin sesión · `session`: sesión válida (cualquier estado) · `editor`: perfil `active` con rol `editor` o `admin` · `admin`: perfil `active` rol `admin` · `cron`: `Authorization: Bearer $CRON_SECRET`. Fallo de sesión ⇒ **401**; rol/estado insuficiente ⇒ **403** (FR-008, SC-009).

**Guard obligatorio (T158)** — Todo handler de `server/api/**` llama a `requireRole(` o `requireActive(` salvo tres excepciones: `public/*` (sin sesión; fase 1 con límite por IP de 5/h, fase 2 con el id del envío como capacidad y límite de 10/h por IP), `cron/*` (`requireCron`, comparación en tiempo constante con `CRON_SECRET`) y `me.get` (`requireSession`, cualquier estado). `test/unit/endpoint-guards.spec.ts` recorre los archivos reales y falla si aparece un endpoint sin guard o una ruta pública nueva no registrada en la prueba.

**Cabeceras de seguridad** — `server/middleware/security-headers.ts` añade a toda respuesta de Nitro (páginas, `/api/**`, redirecciones y errores): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` y `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()`. Los binarios nunca salen de Nitro (302 a URL firmada), así que no afectan a la vista previa ni a las descargas; el visor de PDF incrusta `/api/files/:id/content`, y el navegador evalúa `X-Frame-Options` en la respuesta final del bucket, no en el 302. Se eligió middleware y no `routeRules` para que sea una unidad probada (`test/unit/api-core.spec.ts`) independiente del preset; en Vercel los estáticos servidos por la CDN no pasan por él.

Códigos comunes: 400 entrada mal formada · 401 · 403 · 404 · 409 conflicto (concurrencia / último admin / ya revisado / en papelera) · 413 archivo > 100 MB · 415 tipo no permitido · 422 validación o firma binaria inválida · 429 rate limit (`Retry-After`, `message` en español desde `shared/constants/messages.ts` y `data.retryAfter`).

Los mensajes para la persona van en `message` y en español; el cliente (`serverMessage`) solo muestra `message` en 4xx cuando difiere de `statusMessage` (h3 copia la frase del estado si no hay mensaje), traduce todo 429 al texto común y usa su propio respaldo en 5xx y errores de red.

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
| `POST` | `/api/trash/:kind/:id/restore` | editor | `{ name, restoredTo: { folderId \| null, path }, movedToRoot: boolean }`. `name` es el nombre final, con sufijo si chocaba (FR-035) |
| `DELETE` | `/api/trash/:kind/:id` | editor | `204` purga definitiva |
| `DELETE` | `/api/trash` | **admin** | `{ purged: number }` vaciar papelera |

## Comentarios

| Método | Ruta | Acceso | Cuerpo | Respuesta |
|--------|------|--------|--------|-----------|
| `GET` | `/api/files/:id/comments` | editor | `?since=<ISO>` | `Comment[]` = `{ id, body, author: {id,name}, createdAt, editedAt, canEdit, canDelete }` en orden cronológico — 404 si el archivo no existe o está en papelera |
| `POST` | `/api/files/:id/comments` | editor | `{ body }` (1–2000) | `201 Comment` — 409 "El archivo está en la papelera" |
| `PATCH` | `/api/comments/:id` | editor (autor) | `{ body }` | `Comment` con `editedAt` — 403 si no es el autor (tampoco el admin), 409 si el archivo está en papelera |
| `DELETE` | `/api/comments/:id` | editor (autor) o admin | — | `204`; si borra un admin que no es el autor registra `comment.admin_delete` (target = archivo, `meta.author`) |

- `canEdit` = el autor; `canDelete` = el autor o `comments.moderate` (admin). Comentario inexistente → 404 "El comentario ya no existe".
- `since` (mismo validador `isoSince` que `/api/realtime/pulse`) devuelve los creados después del cursor. Postgres guarda microsegundos y el cliente envía milisegundos, así que se compara `date_trunc('milliseconds', created_at) > since` para no repetir el último comentario en cada sondeo.
- `GET` lee archivo y comentarios en un solo `db.batch` (un viaje por sondeo de 5 s).
- El sondeo solo trae comentarios **nuevos** (lo que exige SC-011). Las ediciones y los borrados de otras personas se ven al recargar el visor; si alguien intenta editar o borrar un comentario que ya no existe, recibe 404 y la UI lo quita del hilo.

## Envíos de invitados

| Método | Ruta | Acceso | Cuerpo | Respuesta |
|--------|------|--------|--------|-----------|
| `POST` | `/api/public/submissions` | **public** | `{ senderName, note?, files: { name, size, mimeType }[] (1–20) }` | `201 { submissionId, uploads: { fileId, uploadUrl, headers }[] }` — 429 rate limit (5/h por IP), 413/415/422 |
| `POST` | `/api/public/submissions/:id/complete` | **public** | — | `{ status: "pending", accepted, rejected }` — valida firmas; solo entonces el envío es visible para el equipo. 429 al superar 10 cierres/h por IP (`guest-complete:<hash>`) |
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
