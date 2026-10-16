# Fase 10 — US8 Comentarios en archivos (T142–T149)

## Contexto
Las fases 0–9 están hechas (la papelera está en `001-shared-media-drive` / `001-us7-papelera`, todavía sin integrar a `origin/main`). Toca la fase 10: comentar archivos, editar y borrar los comentarios propios, que el admin modere, mostrar un contador por archivo y que los demás vean los comentarios nuevos en ≤ 5 s.
Requisito del usuario: la cobertura se mantiene **> 90 %**. `vitest.config.ts` ya exige 90 % en lines, statements, branches y functions sobre todo `app/`, `server/`, `shared/`, y el e2e no suma cobertura, así que cada endpoint y componente nuevo lleva su spec unit o nuxt. Además: pruebas e2e y verificación en el navegador.

**Lo que ya existe y se reutiliza (no se toca):**
- Tabla `comments` y su migración (`server/db/schema.ts:161-171`, `drizzle/0000_*`, con cascada al purgar). **No hay migración nueva.**
- La acción `comment.admin_delete` en el enum, con su etiqueta y su ícono (`app/utils/activity-labels.ts:19,34`).
- El permiso `comments.moderate`, solo para admin (`shared/permissions.ts`).
- `POLL_INTERVAL_MS` (`shared/constants/files.ts:44`).
- El tipo `Comment` (`shared/types/api.ts:119-127`) y `FileItem.commentCount`.
- `commentCountSql()` (`server/utils/pagination.ts:68`), ya usado en children, search y `getVisibleFile`. **T147 del lado del servidor ya está hecho**; solo falta la UI.
- El global-setup del e2e ya trunca `comments`.

## Rama
Crear `001-us8-comentarios` desde el HEAD actual, que ya incluye la papelera. No tocar los cambios locales de `AGENTS.md` ni `CLAUDE.md`.

## Implementación (en orden)

1. **T144 `shared/validation/comments.ts`**
   - `commentInput = object({ body: str({ max: 2000 }) })`. El combinador de `shared/validation/core.ts` ya hace trim y usa min 1.
   - `commentsQuery = object({ since: optional(str({ max: 40, pattern: ISO, message: 'Fecha no válida' })) })`.
   - El validador `since` está hoy en línea en `server/api/realtime/pulse.get.ts:6-8`. Se extrae a un `isoSince` compartido y pulse se refactoriza para usarlo (una sola regla en `shared/`).

2. **Helper `server/utils/comments.ts`**, para que los endpoints queden delgados y testeables:
   - `toComment(row, me)` arma `canEdit = author === me.userId` y `canDelete = canEdit || can(role,'comments.moderate')`.
   - `findFileForComments(id)` busca **sin** filtrar `deletedAt`, solo `uploadStatus='ready'`. Devuelve 404 si no existe y deja a la llamada decidir el 409. `getVisibleFile` daría 404 para un archivo en papelera.
   - `getComment(id)` devuelve 404.
   - Un único select con join a `profiles` para el nombre del autor (sin N+1).

3. **T145 endpoints de lectura y alta**, con el patrón de `server/api/files/[id].patch.ts`: `requireRole(event,'editor')`, `paramId`, `readValid`/`queryValid`.
   - `server/api/files/[id]/comments.get.ts`:
     - Valida que el archivo sea visible (404 si está en papelera o no existe; se decide al implementar y se documenta).
     - `since` filtra `created_at > since`.
     - Orden por `created_at asc`; el índice `(file_id, created_at)` ya existe.
   - `server/api/files/[id]/comments.post.ts`:
     - 409 `'El archivo está en la papelera'` si `deletedAt` no es null.
     - Si no, inserta con `returning`, responde `setResponseStatus(201)` y devuelve el `Comment`.

4. **T146 endpoints de edición y borrado**
   - `server/api/comments/[id].patch.ts`: solo el autor (403 "No tienes permiso para esta acción" si no lo es), fija `editedAt = now()` y devuelve el `Comment`.
   - `server/api/comments/[id].delete.ts`:
     - Puede borrar el autor o quien tenga `comments.moderate`; si no, 403.
     - Si lo borra un admin que no es el autor, hace `db.batch([delete, activityInsert(profile,'comment.admin_delete',{type:'file',id:fileId,label:fileName})])`.
     - Responde 204.

5. **T147 UI en `app/components/files/FileCard.vue`**: en la línea de metadatos (l. 35-37), `Icon lucide:message-circle` + número cuando `commentCount > 0`, con `aria-label="N comentarios"`.

6. **T148 `app/components/comments/CommentItem.vue`**
   - Muestra autor, `timeAgo(createdAt)` (`app/utils/file-actions.ts:24`) y "(editado)".
   - Edición en línea con `textarea` (con label), contador `n/2000` y validación con `commentInput`.
   - Botones Editar/Eliminar según `canEdit`/`canDelete`, con tamaño `btn` base y `lg:btn-sm`.
   - Al eliminar usa `useConfirm({danger:true})`; después, toast con `useToast`.
   - Emite `updated` y `deleted`.

7. **T149 `app/components/comments/CommentThread.vue`**
   - Prop `fileId`. Carga inicial con `useApiFetch`.
   - Sondeo con el patrón de `app/composables/usePulse.ts`:
     - `useIntervalFn(poll, POLL_INTERVAL_MS, {immediate:false})`.
     - Se pausa si `useDocumentVisibility` ≠ visible, si `useElementVisibility(threadRef)` es falso o si hay una petición en vuelo.
     - Pide `?since=<último createdAt>` y fusiona por `id`.
   - Si el sondeo crece, se extrae a `app/composables/useCommentThread.ts` (lógica en composable, Constitución IV).
   - Formulario para publicar con validación en línea; con el 409 muestra un mensaje accionable.
   - Cuatro estados: `SkeletonList`, `EmptyState` "Sé el primero en comentar", `ErrorState` con reintento y la lista.
   - Se monta con `Lazy` en el slot de `app/pages/archivos/ver/[fileId].vue:90`. No se monta si el archivo está en papelera.

## Pruebas (cobertura > 90 %)

**Unit**
- **T142 `test/unit/validation-comments.spec.ts`**:
  - Rechaza vacío, solo espacios y 2 001 caracteres; acepta 2 000.
  - Acepta `since` válido y rechaza uno inválido.
- **`test/unit/api-comments.spec.ts`**, con `test/unit/helpers/nitro.ts` (`installNitro`, `loadHandler`, `makeEvent`, `expectGuarded`, `expectStatus`), por endpoint:
  - Guard de rol, 404 por id inválido o inexistente, 422 en validación.
  - GET con y sin `since`, y el mapeo de `canEdit`/`canDelete` (autor, otro editor, admin).
  - POST: 201, y 409 si el archivo está en papelera.
  - PATCH: autor 200 con `editedAt`; no autor 403 (también el admin).
  - DELETE:
    - Autor 204 sin auditoría.
    - Admin no autor 204 con `comment.admin_delete`.
    - Editor no autor 403.
- **`test/unit/server-comments.spec.ts`**, para el helper si no queda cubierto por lo anterior.

**Nuxt** (`test/nuxt/comments.spec.ts`, con `mockApi`/`failWith`/`flush` de `test/nuxt/helpers/api.ts`)
- `CommentItem`:
  - Se muestran u ocultan las acciones según `canEdit`/`canDelete`.
  - "(editado)".
  - Edición: guarda, cancela, contador y error de validación.
  - Borrado: confirmar y cancelar.
  - Toast al fallar la API.
- `CommentThread`:
  - Los cuatro estados, reintento.
  - Publicar (éxito, 409 y 422).
  - El sondeo con `vi.useFakeTimers` pide `since` y fusiona sin duplicar.
  - Pausa con la pestaña oculta.
- `FileCard`: el contador aparece con > 0 y no con 0.
- Extender `pages-files` o el spec del visor: el hilo se monta en `/archivos/ver/[id]`.

**E2E — T143 `test/e2e/comments.spec.ts`**
- Siembra el archivo con SQL, como `seedFile` de `test/e2e/trash.spec.ts:26-31`.
- Usa dos páginas con `createPage` + `signedInAs` (editor A, editor B), como en `guest-queue.spec.ts:101-124`.
- Casos:
  - A publica y B lo ve en ≤ 5 s (`expect.poll`, 6 s).
  - A edita y aparece "editado".
  - B no ve las acciones; un `PATCH` directo con la cookie de B (patrón de `routes-guard.spec.ts:58-62`) da 403.
  - El admin borra el comentario de A y queda registrado en actividad.
  - Un `POST` a un archivo en papelera da 409.
  - El contador aparece en `FileCard` en `/archivos`.
- Rutas protegidas: añadir los 4 endpoints nuevos a `routes-guard.spec.ts` (sin sesión 401 / rol).

## Verificación (definición de hecho de AGENTS.md)
1. `bun run typecheck` → `bun run test:unit` → `bun run test:nuxt` → `bun run test:e2e` → `bun run test:coverage`. Este último debe quedar **≥ 90 % en las 4 métricas** (meta > 90 %). Reportar las cifras antes y después.
2. Navegador, siempre al final (agente QA Sonnet con `agent-browser` o chrome-devtools, como en fases previas):
   - Con `bun run dev`, el escenario independiente con dos sesiones de dev.
   - A 360 px y 1280 px, en oscuro y claro.
   - Estados de carga, vacío, error y contenido.
   - Foco por teclado en el textarea y las acciones; consola limpia.
   - Solo datos de `.env.development`, sin pasos destructivos. Borrar un comentario propio es la función de la app que se prueba, no una acción ad hoc sobre la BD.
3. Reportar resultados y marcar T142–T149 `[X]` en `tasks.md`.
4. Commits Conventional por bloque (`feat(comments): …`, `test(comments): …`), con `git add` explícito por archivo. Sin push; eso lo hace el usuario.
5. Actualizar la memoria `cloudy-mvp-status.md`.
