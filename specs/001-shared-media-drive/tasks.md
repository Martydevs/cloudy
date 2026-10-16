---

description: "Task list for Cloudy — Disco multimedia compartido (feature 001)"
---

# Tasks: Cloudy — Disco multimedia compartido del equipo de producción

**Input**: Documentos de diseño en `specs/001-shared-media-drive/`

**Prerequisites**: plan.md (rev. 2), spec.md, research.md (R1–R19), data-model.md, contracts/api.md, contracts/ui-routes.md, quickstart.md · Constitución v1.0.0

**Tests**: **Requeridos**, porque los pidió el usuario y los exige la Constitución V. Por cada historia hay tests unitarios (`test/unit`), de componente (`test/nuxt`) y e2e (`test/e2e`). Dentro de cada historia los tests se escriben antes que la implementación y deben fallar primero.

**Organization**: Las tareas se agrupan por historia de usuario. Las historias P1 se ordenan por dependencia técnica y no por su número (US2 → US6 → US5 → US1), porque la sesión, las rutas y el shell son prerrequisitos para usar el disco.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede ejecutar en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: la historia de usuario de spec.md a la que pertenece la tarea (US1…US9).

## Convenciones obligatorias para quien implemente (de AGENTS.md y la constitución)

- **Componentes**: `<script setup lang="ts">`, TypeScript estricto, sin `any`.
- **Utilidades**: antes de escribir una, buscar en este orden: auto-imports de Nuxt → VueUse → daisyUI → paquetes instalados (research R12).
- **Endpoints**: cada uno valida su entrada con `shared/validation/*` y llama `requireRole()` / `requireActive()` de `server/utils/session.ts`.
- **Proveedores**: S3 se usa **solo** desde `server/utils/storage.ts` y Neon Auth **solo** desde `server/utils/auth.ts`.
- **Interfaz**:
  - Textos en español.
  - Colores solo con clases semánticas de daisyUI e íconos `lucide:*`.
  - `btn`/`input` en tamaño por defecto; nada de `btn-sm`/`btn-xs` como base.
  - Cada vista con datos muestra cuatro estados: `SkeletonList`, `EmptyState`, `ErrorState` y el contenido.
- **Tests**: seleccionan elementos con `getByRole`/`getByLabel`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Limpiar el scaffold, corregir la configuración heredada y preparar las herramientas (plan, sección "Correcciones a la base existente").

- [X] T001 Eliminar el código de demostración:
  - Borrar `app/components/TestComponent.vue`, `server/api/test.ts`, `server/config/auth.ts` (adaptador Next, incompatible con Nitro) y `server/config/db.ts`.
  - Vaciar el `usersTable` de ejemplo en `server/db/schema.ts` y dejar el archivo solo con un comentario de cabecera.
  - Reemplazar `app/pages/index.vue` por un `<template><div /></template>` temporal.
- [X] T002 Actualizar `package.json`:
  - Fijar `"@neondatabase/auth": "0.6.0-beta"` como versión exacta.
  - Agregar con `bun add -d vue-tsc typescript` (research R19).
  - Agregar los scripts `"typecheck": "nuxt typecheck"`, `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`, `"db:migrate:test": "DRIZZLE_TARGET=test drizzle-kit migrate"`, `"storage:setup": "bun scripts/storage-setup.ts"` y `"analyze": "SONDA=1 nuxt build"` (Sonda).
- [X] T003 [P] Corregir `drizzle.config.ts`:
  - `url` = `process.env.DRIZZLE_TARGET === 'test' ? process.env.NUXT_TEST_DATABASE_URL : process.env.NUXT_DATABASE_URL`, que falla con un mensaje claro si no existe.
  - `out: './drizzle'` y `schema: './server/db/schema.ts'`.
- [X] T004 [P] Actualizar `nuxt.config.ts`:
  - **Eliminar** `runtimeConfig.session`.
  - **Mantener** `databaseUrl`, `testDatabaseUrl`, `neonAuthBaseUrl` y `neonAuthCookieSecret`.
  - **Agregar** `awsEndpointUrlS3`, `awsAccessKeyId`, `awsSecretAccessKey`, `awsRegion`, `s3Bucket`, `storageKeyPrefix: ''`, `cronSecret: process.env.CRON_SECRET ?? ''`, `rateLimitSalt` y `public: { siteUrl: '' }`.
  - **Agregar** `nitro: { experimental: { asyncContext: true } }`.
  - **No** mapear `NUXT_NEON_JWKS_URL` (R17).
- [X] T005 [P] Actualizar `vitest.config.ts`:
  - Cambiar los globs de `include` a `test/unit/**/*.{test,spec}.ts`, `test/nuxt/**/*.{test,spec}.ts` y `test/e2e/**/*.{test,spec}.ts`.
  - En el proyecto `e2e`: `globalSetup: ['test/e2e/setup/global-setup.ts']`, `testTimeout: 120000` y `fileParallelism: false`.
  - En `coverage`: `include: ['server/utils/**', 'shared/**']` y `thresholds: { lines: 80 }`.
- [X] T006 [P] Crear `vercel.json` con `{ "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 9 * * *" }] }` (R8).
- [X] T007 [P] Crear `shared/constants/files.ts` con:
  - `ALLOWED_TYPES` como mapa `extension → { mimes: string[], category }` (FR-009):
    - image: `jpg`, `jpeg`, `png`, `webp`, `gif`, `heic`
    - audio: `mp3`, `wav`, `m4a`, `aac`, `ogg`
    - video: `mp4`, `mov`
    - presentation: `pptx`, `ppt`, `key`, `odp`, `pdf`
    - document: `txt`, `md`, `docx`
  - `MAX_FILE_SIZE = 104_857_600` (100 MB), `MAX_GUEST_FILES = 20`, `TRASH_RETENTION_DAYS = 30`, `SUBMISSION_TTL_DAYS = 7`, `UPLOAD_ORPHAN_HOURS = 24` y `POLL_INTERVAL_MS = 5000`.
  - Los helpers `getExtension(name)`, `categoryOf(ext)` e `isAllowed(ext, mime)`.
- [X] T008 Instalar el navegador de e2e con `bunx playwright-core install chromium` y verificar que `bun run typecheck` corre (aunque reporte errores). Anotar el resultado en `specs/001-shared-media-drive/quickstart.md` §3 si difiere.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema, frontera con Neon (Auth y Storage), sesión y perfiles, reglas compartidas, guard de rutas, layouts base y la infraestructura de e2e.

**⚠️ CRITICAL**: Ninguna historia empieza hasta terminar esta fase.

### Esquema y base de datos

- [X] T009 Definir en `server/db/schema.ts`:
  - Los enums `user_role` (`admin`, `editor`), `user_status` (`pending`, `active`, `disabled`, `removed`), `file_category` (`image`, `audio`, `video`, `presentation`, `document`), `file_origin` (`team`, `guest`), `upload_status` (`uploading`, `ready`), `submission_status` (`pending`, `approved`, `rejected`, `expired`) y `activity_action`, este último con los 20 valores de data-model.md.
  - La tabla `profiles`:
    - `user_id` text PK ("id de Neon Auth")
    - `email` text not null unique ("copiado de la sesión; minúsculas")
    - `name` text not null ("1–80 caracteres")
    - `role` `user_role` null ("null mientras `pending`")
    - `status` `user_status` not null default `pending`
    - `created_at` / `updated_at` timestamptz defaultNow
    - `approved_by` text null → `profiles.user_id`
- [X] T010 Agregar a `server/db/schema.ts` la tabla `folders`:
  - `id` uuid PK defaultRandom, `parent_id` uuid null → `folders.id` (on delete cascade)
  - `name` text not null ("1–120 car., sin `/ \ : * ? " < > |`")
  - `created_by` → `profiles.user_id`, `created_at` / `updated_at`
  - `deleted_at` timestamptz null, `deleted_by` text null, `trash_root_id` uuid null
  - Índices `(deleted_at)` y `(trash_root_id)`.
- [X] T011 Agregar a `server/db/schema.ts` la tabla `files`:
  - `id` uuid PK, `folder_id` uuid null → `folders.id`
  - `name` text not null ("1–200 car."), `extension` text not null, `mime_type` text not null, `category` not null
  - `size_bytes` bigint not null ("1 … 104 857 600")
  - `storage_key` text not null unique, `thumb_key` text null
  - `upload_status` not null default `uploading`, `origin` not null
  - `uploaded_by` text null → `profiles.user_id`, `guest_name` text null ("requerido si `origin='guest'`"), `submission_id` uuid null
  - `created_at` / `updated_at`, `deleted_at` / `deleted_by` / `trash_root_id`
  - Índices `(folder_id, created_at desc)`, `(category)`, `(deleted_at)` y `(upload_status, created_at)`.
- [X] T012 Agregar a `server/db/schema.ts`:
  - `guest_submissions`:
    - `id` uuid PK
    - `sender_name` text not null ("1–80 car."), `note` text null ("≤ 500 car.")
    - `status` default `pending`, `sender_key` text not null ("hash SHA-256 de IP + sal")
    - `created_at`, `reviewed_by` text null, `reviewed_at` null, `target_folder_id` uuid null
    - `rejection_reason` text null ("≤ 300 car.")
    - Índice `(status, created_at)`.
  - `guest_submission_files`:
    - `id` uuid PK, `submission_id` → `guest_submissions.id` cascade
    - `original_name`, `extension`, `mime_type`, `category`, `size_bytes`
    - `storage_key` text unique, `upload_status`
- [X] T013 Agregar a `server/db/schema.ts`:
  - `comments`: `id` uuid PK, `file_id` → `files.id` cascade, `author_id` → `profiles.user_id`, `body` text not null ("1–2 000 car. tras `trim`"), `created_at`, `edited_at` null. Índice `(file_id, created_at)`.
  - `activity_log`: `id` bigint identity PK, `actor_id` text null, `actor_label` text not null, `action` `activity_action`, `target_type` text not null, `target_id` text null, `target_label` text not null, `meta` jsonb null, `created_at`. Índices `(created_at desc)` y `(actor_id)`.
  - `rate_limits`: `key` text, `window_start` timestamptz, `count` integer not null default 0, PK `(key, window_start)`.
  - Las `relations()` de Drizzle según el resumen de data-model.md.
- [X] T014 Generar la migración inicial con `bun run db:generate` en `drizzle/0000_*.sql` y editarla a mano para agregar:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
  - El índice `gin (name gin_trgm_ops)` sobre `files` y sobre `folders`.
  - Los índices únicos parciales `files (coalesce(folder_id,'00000000-0000-0000-0000-000000000000'), lower(name)) where deleted_at is null and upload_status='ready'` y `folders (coalesce(parent_id,…), lower(name)) where deleted_at is null`.

  Después aplicar con `bun run db:migrate` y `bun run db:migrate:test`.
- [X] T015 Crear `server/utils/db.ts` con `useDb()`: un singleton a nivel de módulo de `drizzle({ client: neon(useRuntimeConfig().databaseUrl), schema })` usando `drizzle-orm/neon-http`. Exportar `type Db`.

### Frontera con Neon Auth y Storage

- [X] T016 [P] Crear `server/utils/storage.ts`:
  - Un `S3Client` singleton (`endpoint` = `awsEndpointUrlS3`, `forcePathStyle: true`, región y credenciales de runtimeConfig).
  - Las funciones `key(path)`, que antepone `storageKeyPrefix`; `presignPut(key, { contentType, contentLength }, 600)`; `presignGet(key, { download?: filename }, 900)`; `head(key)`; `readRange(key, 0, 4095)`; `deleteMany(keys[])`, en lotes de 1000 con `DeleteObjects`; y `listPrefix(prefix)`.
- [X] T017 [P] Crear `scripts/storage-setup.ts`: carga `.env` con `dotenv/config` y aplica `PutBucketCors` al bucket `NUXT_S3_BUCKET` con `AllowedOrigins = [NUXT_PUBLIC_SITE_URL, 'http://localhost:3000']`, `AllowedMethods = ['PUT','GET','HEAD']`, `AllowedHeaders = ['content-type','content-length']`, `ExposeHeaders = ['etag']` y `MaxAgeSeconds = 3600`. Ejecutarlo una vez.
- [X] T018 Crear `server/utils/auth.ts` con el adaptador h3 de Neon Auth (R1), que importa solo desde `@neondatabase/auth/server`:
  - `createH3RequestContext()` usa `useEvent()` y define:
    - `getCookies` = `extractNeonAuthCookies(getRequestHeader(event,'cookie') ?? '')`
    - `setCookie` = `appendResponseHeader(event,'set-cookie', serializeSetCookie({ name, value, ...options }))`
    - `getHeader`, y `getOrigin` = `getRequestURL(event).origin`
    - `getFramework` = `'nuxt'`
  - `useAuthServer()` es un singleton de `createAuthServer({ baseUrl, cookieSecret, context, log: resolveNeonAuthLogging({}) })` y llama antes a `validateCookieConfig`.
  - `proxyConfig()` devuelve la configuración plana para el handler.
- [X] T019 Crear `server/routes/api/auth/[...path].ts`: `path` = `getRouterParam(event,'path')`, devuelve `handleAuthProxyRequest({ request: toWebRequest(event), path, ...proxyConfig() })`. Si la respuesta tiene varios `Set-Cookie` se preservan (de lo contrario se devuelve el `Response` tal cual).
- [X] T020 [P] Crear `server/utils/rate-limit.ts`:
  - `hitRateLimit(key, { limit, windowSec })`: hace un upsert atómico en `rate_limits` (`INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`) y lanza `createError({ statusCode: 429 })` con la cabecera `Retry-After` si `count > limit`.
  - `windowStart(now, windowSec)`: función pura exportada.
  - `hashSender(ip)`: SHA-256 de `ip + rateLimitSalt`.

### Sesión, perfiles y reglas compartidas

- [X] T021 [P] Crear `shared/permissions.ts`: el tipo `Action` (`content.read`, `content.write`, `submissions.review`, `trash.empty`, `users.manage`, `activity.read`, `comments.moderate`) y `can(role: 'admin'|'editor'|null, action)` según FR-007 (editor: todo excepto `trash.empty`, `users.manage`, `activity.read` y `comments.moderate`).
- [X] T022 [P] Crear `shared/types/api.ts` con los DTOs de contracts/api.md: `Profile`, `FolderItem`, `FileItem`, `Breadcrumb`, `TrashItem`, `Submission`, `SubmissionFile`, `Comment`, `ActivityEntry`, `Pulse`, `DashboardSummary` y `Paginated<T>`.
- [X] T023 [P] Crear `shared/validation/core.ts`:
  - El tipo `Result<T> = { ok: true, data: T } | { ok: false, errors: Record<string,string> }`.
  - Los helpers `str({min,max,trim,pattern,message})`, `email()`, `oneOf()`, `uuid()`, `optional()` y `object(schema)`.
  - El adaptador `toH3Validator(v)` para `readValidatedBody`, que lanza 422 con `data.errors`.
  - Mensajes en español.
- [X] T024 Crear `server/utils/session.ts`:
  - `getAuthUser(event)` usa `useAuthServer().getSession()` y devuelve `{ id, email, name } | null`.
  - `ensureProfile(user)` inserta el perfil con una sola sentencia: `INSERT INTO profiles … SELECT … CASE WHEN NOT EXISTS (SELECT 1 FROM profiles) THEN ('active','admin') ELSE ('pending', null) END ON CONFLICT (user_id) DO UPDATE SET email = excluded.email RETURNING *` (FR-002).
  - `requireSession(event)` responde 401; `requireActive(event)` responde 403 con `data.reason = 'pending'|'disabled'|'removed'`; `requireRole(event, 'editor'|'admin')` responde 403. Todas leen `event.context.auth`.
- [X] T025 Crear `server/middleware/session.ts`:
  - Para `/api/**` (excepto `/api/auth/**`, `/api/public/**` y `/api/cron/**`) resuelve una vez `event.context.auth = { user, profile }` con `getAuthUser` + `ensureProfile`.
  - Si no hay sesión deja `event.context.auth = null`.
- [X] T026 Crear `server/api/me.get.ts`: `requireSession` y devuelve `{ user, profile }`.
- [X] T027 [P] Crear `server/utils/activity.ts`: `activityInsert(actor, action, target: { type, id, label }, meta?)`. Devuelve una query de inserción de Drizzle, sin ejecutarla, para incluirla en `db.batch([...])`.
- [X] T028 [P] Crear `server/utils/naming.ts`: la función pura `withSuffix(name, taken: Set<string>)`. Sin distinguir mayúsculas, inserta ` (2)`, ` (3)`… antes de la extensión, por ejemplo `foto.jpg` → `foto (2).jpg`.
- [X] T029 [P] Crear `app/utils/route-access.ts`: la función pura `resolveAccess(meta: { access, roles? }, me: { profile } | null, path)`. Devuelve `{ allow: true } | { redirect: string }` según la matriz de contracts/ui-routes.md (`public`, `guest-only`, `pending`, `private`; roles → `/acceso-denegado`; sin sesión → `/login?redirect=<path>`).
- [X] T030 Crear `app/composables/useMe.ts`: `useState<{ user, profile } | null>('me')` más `refreshMe()`, que usa `useRequestFetch()('/api/me')` y atrapa el 401 dejando `null`. También los computed `isAdmin`, `isEditor` e `isActive`.
- [X] T031 Crear `app/composables/useAuthClient.ts`: un singleton de `createAuthClient(\`${useRuntimeConfig().public.siteUrl}/api/auth\`)` de `@neondatabase/auth`, creado solo en el cliente (`import.meta.client`). Expone `signUp`, `signIn`, `signOut`, `requestPasswordReset`, `resetPassword`, `changePassword` y `updateUser`. Después de iniciar o cerrar sesión llama a `refreshMe()`.
- [X] T032 Crear `app/middleware/auth.global.ts`: si `useMe()` no está cargado, llama a `refreshMe()` y luego aplica `resolveAccess(to.meta, me, to.fullPath)`. Las páginas sin `access` en su meta se tratan como `private` con roles `['editor','admin']`, que es la opción segura por defecto.

### Shell visual base

- [X] T033 Crear `app/composables/useTheme.ts` y actualizar `app/app.vue`:
  - Cookie `useCookie<'cloudy'|'cloudy-light'>('cloudy-theme', { default: () => 'cloudy', maxAge: 31536000, sameSite: 'lax' })`.
  - `useHead({ htmlAttrs: { 'data-theme': theme }, meta: [{ name: 'theme-color', content: theme === 'cloudy' ? '#0a0a0a' : '#fcfbf9' }] })`.
  - `toggle()`. `app.vue` conserva `<NuxtLayout><NuxtPage /></NuxtLayout>` (R10, FR-043).
- [X] T034 [P] Crear `app/components/app/ThemeToggle.vue`: un `swap` de daisyUI con `lucide:moon`/`lucide:sun`, `aria-label` "Cambiar a tema claro" o "Cambiar a tema oscuro" según el tema y `aria-pressed`, usando `useTheme()` (FR-046).
- [X] T035 [P] Crear `app/components/app/AppLogo.vue`: el ícono `lucide:cloud` en `text-primary` más el texto "Cloudy" en `font-semibold`, con la prop `compact` para mostrar solo el ícono (FR-041).
- [X] T036 [P] Crear `app/composables/useToast.ts` y `app/components/app/AppToast.vue`:
  - Cola en `useState`, con `show(message, type: 'success'|'error'|'info')`.
  - Se renderiza como `toast toast-end toast-bottom` con `alert`, `role="status"` y `aria-live="polite"`.
  - Se oculta solo a los 4 s con `useTimeoutFn`.
  - Se monta en `app/app.vue`.
- [X] T037 [P] Crear `app/components/ui/ConfirmDialog.vue`: un `<dialog class="modal">` nativo controlado con `useConfirmDialog`. Props `title`, `message`, `confirmLabel` y `danger`. El foco inicial va en "Cancelar" y emite `confirm`/`cancel`. Exportar además el composable `app/composables/useConfirm.ts`, que devuelve `Promise<boolean>`.
- [X] T038 [P] Crear los componentes de estado `app/components/ui/EmptyState.vue` (props `icon`, `title`, `description` y slot de acción), `app/components/ui/ErrorState.vue` (props `message` y evento `retry`, botón "Reintentar") y `app/components/ui/SkeletonList.vue` (props `rows` y `variant` `grid`/`list`, con `skeleton` de daisyUI).
- [X] T039 [P] Crear `app/layouts/auth.vue` y `app/layouts/public.vue`:
  - `auth`: una `card` centrada sobre `bg-base-200`, `max-w-md w-full`, padding `p-4 sm:p-8`, con `AppLogo` y `ThemeToggle` en la esquina.
  - `public`: una cabecera con `AppLogo` y `ThemeToggle`, y contenido `max-w-2xl mx-auto p-4`.
- [X] T040 [P] Crear `app/error.vue`: muestra "Página no encontrada" con el ícono `lucide:map-pin-off` y un botón "Ir al inicio" para el 404, o un mensaje genérico con `clearError({ redirect: '/' })` para el resto (US6).

### Infraestructura de pruebas

- [X] T041 Crear `test/e2e/setup/global-setup.ts`:
  - Genera `runId` y fija `process.env.NUXT_DATABASE_URL = process.env.NUXT_TEST_DATABASE_URL` y `process.env.NUXT_STORAGE_KEY_PREFIX = \`e2e/${runId}/\``.
  - Ejecuta `DRIZZLE_TARGET=test drizzle-kit migrate`.
  - Vacía `profiles, folders, files, guest_submissions, guest_submission_files, comments, activity_log, rate_limits` (`TRUNCATE … CASCADE`).
  - En el teardown borra `listPrefix('e2e/<runId>/')`.
  - Aborta si `NUXT_TEST_DATABASE_URL` no existe o es igual a `NUXT_DATABASE_URL` (Constitución V).
- [X] T042 Crear `test/e2e/setup/fixtures.ts`:
  - `email(role)` → `e2e+${runId}-${role}@cloudy.test`.
  - `registerViaUi(page, { name, email, password })`.
  - `login(page, creds)`.
  - `setProfile(email, { status, role })`, que actualiza directamente la BD de pruebas con `neon(NUXT_TEST_DATABASE_URL)`.
  - `viewports = { phone: { width: 360, height: 740 }, desktop: { width: 1280, height: 800 } }`.
  - Los archivos de muestra viven en `test/fixtures/files/`.
- [X] T043 [P] Agregar las fixtures binarias pequeñas en `test/fixtures/files/`: `foto.jpg`, `imagen.png`, `imagen.webp`, `anim.gif`, `audio.mp3`, `audio.wav`, `audio.ogg`, `clip.mp4`, `deck.pptx`, `doc.docx`, `slides.pdf`, `notas.txt`, `notas.md` y `falso.jpg` (un ejecutable con bytes `MZ` renombrado). Todas deben pesar menos de 200 KB.

### Tests de la base

- [X] T044 [P] Crear `test/unit/permissions.spec.ts`: la matriz completa `can(role, action)` para `admin`, `editor` y `null`.
- [X] T045 [P] Crear `test/unit/validation-core.spec.ts`: los helpers de `shared/validation/core.ts` (límites, trim, mensajes en español).
- [X] T046 [P] Crear `test/unit/naming.spec.ts`: `withSuffix` sin extensión, con varios puntos, sin distinguir mayúsculas y con ` (2)` ya tomado.
- [X] T047 [P] Crear `test/unit/rate-limit.spec.ts`: `windowStart` en los bordes de la ventana y que `hashSender` sea determinista y dependa de la sal.
- [X] T048 [P] Crear `test/unit/route-access.spec.ts`: todas las celdas de la matriz `resolveAccess` (sin sesión, `pending`, `disabled`, `active` editor/admin) × `access` (`public`, `guest-only`, `pending`, `private` con y sin `roles`), y el `redirect` codificado.
- [X] T049 [P] Crear `test/unit/auth-context.spec.ts`: `createH3RequestContext` con un evento h3 simulado. Lee las cookies, `setCookie` agrega varios `set-cookie` y `getOrigin` funciona.
- [X] T050 [P] Crear `test/nuxt/ThemeToggle.spec.ts`: el tema por defecto es `cloudy`, al hacer clic cambia la cookie a `cloudy-light`, y `aria-label` y `aria-pressed` se actualizan.
- [X] T051 [P] Crear `test/nuxt/ConfirmDialog.spec.ts`: el foco inicial está en "Cancelar", `Esc` cancela y "confirm" resuelve `true`.
- [X] T052 **Spike de validación** contra la rama de desarrollo (R1, R5, R15). Verificar a través del proxy `/api/auth/*`:
  1. `sign-up/email` → `sign-in/email` → `get-session`.
  2. `request-password-reset` con `redirectTo` a `/restablecer`: llega el correo y el token se acepta en `reset-password`.
  3. `presignPut` + PUT desde el navegador (CORS) + `head` + `readRange` + `presignGet`.

  Registrar el resultado y cualquier desviación como "Resultado del spike" en `specs/001-shared-media-drive/research.md` (R1, R5, R15). Si el reset falla, aplicar el plan B de R15 y documentarlo.

**Checkpoint**: la migración está aplicada en dev y test, el proxy de auth y el storage están validados, `bun run test:unit` y `bun run test:nuxt` pasan, y `bun run typecheck` y `bun run build` no tienen errores.

---

## Phase 3: User Story 2 — Registro, inicio de sesión y acceso por rol (Priority: P1) 🎯 MVP

**Goal**: Registrarse, quedar pendiente (salvo el primer usuario, que queda como admin), iniciar y cerrar sesión, y recuperar la contraseña. Solo los usuarios activos entran.

**Independent Test**:
1. Se registra el primer usuario y entra como admin.
2. Se registra un segundo usuario, que ve "Cuenta pendiente".
3. Se activa ese usuario con la fixture `setProfile`.
4. El segundo usuario entra.
5. Al cerrar sesión, volver a una página privada lo manda a login.

### Tests for User Story 2 ⚠️

- [X] T053 [P] [US2] Crear `test/e2e/auth-roles.spec.ts`:
  - El primer registro llega a `/` con el ítem "Usuarios" visible.
  - El segundo registro llega a `/pendiente`, donde aparece "pendiente de aprobación".
  - Tras `setProfile(..., { status: 'active', role: 'editor' })` y volver a iniciar sesión, llega a `/`.
  - "Cerrar sesión" seguido de `goto('/archivos')` lleva a `/login?redirect=%2Farchivos`.
  - Un usuario desactivado ve `/pendiente` con el texto "desactivada".
- [X] T054 [P] [US2] Crear `test/nuxt/auth-forms.spec.ts`. En los formularios de `registro`, `login` y `restablecer` comprueba que aparecen errores en línea para correo inválido, contraseña de menos de 8 caracteres y confirmación distinta, y que el envío queda deshabilitado mientras haya errores.
- [X] T055 [P] [US2] Crear `test/unit/reset-redirect.spec.ts`: `buildResetRedirect(siteUrl)` devuelve `${siteUrl}/restablecer` sin dobles barras.

### Implementation for User Story 2

- [X] T056 [P] [US2] Crear `shared/validation/auth.ts` con:
  - `registerInput`: `name` "1–80 caracteres", `email` válido en minúsculas, `password` "mínimo 8 caracteres" y `confirm` igual a `password`.
  - `loginInput`, `forgotInput`, `resetInput` (`password` ≥ 8 y `confirm`) y `buildResetRedirect(siteUrl)`.
- [X] T057 [P] [US2] Crear `app/components/auth/AuthForm.vue`: un contenedor de formulario con `fieldset`, `legend`, `label` e `input` de daisyUI, un `alert alert-error` para errores del servidor y un botón `btn btn-primary w-full` con estado de carga. La validación en línea se hace en `blur` y en `submit` con los validadores de `shared/validation/auth.ts` (FR-027, FR-033).
- [X] T058 [US2] Crear `app/pages/registro.vue`, con `definePageMeta({ layout: 'auth', access: 'guest-only' })`:
  - Llama a `signUp.email({ name, email, password })` y luego a `refreshMe()`.
  - Navega a `/` si el perfil está activo, o a `/pendiente` si no.
  - Incluye el enlace "¿Ya tienes cuenta? Inicia sesión".
- [X] T059 [US2] Crear `app/pages/login.vue`, con `access: 'guest-only'`:
  - Llama a `signIn.email` y a `refreshMe()`.
  - Navega a `redirect` si pasa `isSafeRedirect`, o a `/`. `isSafeRedirect` va en `shared/validation/redirect.ts`: empieza por `/`, no por `//` y no contiene `://`.
  - En un 429 muestra "Demasiados intentos, espera unos minutos".
  - Incluye los enlaces a `/registro` y `/recuperar`.
- [X] T060 [P] [US2] Crear `app/pages/recuperar.vue`, con `access: 'guest-only'`. Llama a `requestPasswordReset({ email, redirectTo: buildResetRedirect(siteUrl) })` y muestra siempre el mismo mensaje neutro: "Si el correo existe, te enviamos un enlace".
- [X] T061 [P] [US2] Crear `app/pages/restablecer.vue`, con `access: 'public'`:
  - Lee `token` de la query y llama a `resetPassword({ newPassword, token })`.
  - Si sale bien, va a `/login` con un toast.
  - Si el token es inválido o está caducado, muestra "El enlace caducó o ya se usó" y un enlace a `/recuperar` (edge case).
- [X] T062 [P] [US2] Crear `app/pages/pendiente.vue`, con `access: 'pending'`. Muestra un mensaje según `profile.status`: `pending` → "Tu cuenta está pendiente de aprobación"; `disabled` → "Tu cuenta fue desactivada"; `removed` → "Tu cuenta fue eliminada". Incluye el botón "Cerrar sesión" (FR-005).
- [X] T063 [US2] Aplicar el rate limit en `server/routes/api/auth/[...path].ts`. Para `sign-in/*` y `request-password-reset` leer `email` del cuerpo clonado y llamar `hitRateLimit(\`auth:${hashSender(ip)}:${email}\`, { limit: 5, windowSec: 900 })` antes de reenviar (FR-006).
- [X] T064 [US2] Implementar el cierre de sesión en `app/composables/useAuthClient.ts`: `logout()` llama a `signOut()`, limpia `useState('me')` y navega a `/login`.

**Checkpoint**: US2 funciona y `test/e2e/auth-roles.spec.ts` pasa.

---

## Phase 4: User Story 6 — Páginas de autenticación y protección de rutas (Priority: P1)

**Goal**: Todas las rutas privadas exigen sesión y rol, se vuelve a la ruta pedida tras iniciar sesión, existen "Acceso denegado" y 404, y las sesiones caducadas o desactivadas se manejan bien.

**Independent Test**: Sin sesión, `goto('/archivos/<id>')` lleva a login, y al iniciar sesión se llega a esa ruta. Un usuario con sesión que va a `/login` termina en `/`, y una ruta inexistente muestra 404.

### Tests for User Story 6 ⚠️

- [X] T065 [P] [US6] Crear `test/e2e/routes-guard.spec.ts`:
  - Sin sesión, cada ruta privada (`/`, `/archivos`, `/pendientes`, `/papelera`, `/perfil`) lleva a `/login?redirect=…`.
  - Una ruta profunda conserva el `redirect` tras el login.
  - Con sesión, `/login` y `/registro` llevan a `/`.
  - `/no-existe` muestra "Página no encontrada".
  - Un `redirect=//evil.com` se ignora.
  - `GET /api/me` sin sesión responde 401.
- [X] T066 [P] [US6] Crear `test/unit/redirect.spec.ts`: `isSafeRedirect` con `/a`, `//a`, `https://a`, `/a?b=//c` y la cadena vacía.

### Implementation for User Story 6

- [X] T067 [P] [US6] Crear `app/pages/acceso-denegado.vue`, con `access: 'public'`. Usa el layout `dashboard` si hay perfil activo y `auth` si no (con `setPageLayout`). Muestra el ícono `lucide:shield-x`, "No tienes permiso para ver esta página" y el botón "Volver al inicio".
- [X] T068 [US6] Crear `app/plugins/api-errors.ts`. Envuelve `$fetch` con un `ofetch.create({ onResponseError })` expuesto como `useApi()` en `app/composables/useApi.ts`:
  - **401**: limpia `me` y hace `navigateTo('/login?redirect=' + route.fullPath)` (sesión caducada).
  - **403 con `data.reason` en `pending|disabled|removed`**: hace `refreshMe()` y `navigateTo('/pendiente')`.
  - **Otro 403**: `navigateTo('/acceso-denegado')`.

  Todas las llamadas del cliente a `/api/**` deben usar `useApi()` o `useFetch` con `$fetch: useApi()`.
- [X] T069 [US6] Revisar `app/middleware/auth.global.ts` y `app/utils/route-access.ts` para que coincidan exactamente con la matriz de contracts/ui-routes.md y codifiquen el `redirect` con `encodeURIComponent`. Agregar `definePageMeta({ access })` a todas las páginas creadas hasta ahora.

**Checkpoint**: US2 + US6 funcionan, y `routes-guard.spec.ts` y `auth-roles.spec.ts` pasan.

---

## Phase 5: User Story 5 — Estructura tipo dashboard con navegación protegida (Priority: P1)

**Goal**: El layout de dashboard con barra lateral (fija y contraíble en escritorio, panel deslizable en móvil), la barra superior, Inicio con resumen, Mi perfil y el contador de pendientes en vivo.

**Independent Test**:
1. Un editor a 360 px abre el menú y ve Inicio, Archivos, Pendientes, Papelera y Mi perfil, pero no Usuarios ni Actividad.
2. Elige "Archivos" y el panel se cierra.
3. En escritorio contrae la barra, recarga y la barra sigue contraída.

### Tests for User Story 5 ⚠️

- [X] T070 [P] [US5] Crear `test/nuxt/AppSidebar.spec.ts`:
  - Un editor no ve "Usuarios" ni "Actividad" y un admin sí.
  - El ítem activo tiene `aria-current="page"`.
  - Con `collapsed` se ocultan los textos y aparece el tooltip.
  - El badge muestra `pendingCount` y se oculta en 0.
- [X] T071 [P] [US5] Crear `test/e2e/responsive-theme.spec.ts`:
  - A 360 px no hay scroll horizontal (`scrollWidth <= clientWidth`); el botón "Abrir menú" abre el drawer, que se cierra al elegir "Archivos" y al tocar fuera o con `Esc`.
  - A 1280 px, al contraer y recargar, la barra sigue contraída.
  - La primera visita llega con `data-theme="cloudy"` aunque se emule `colorScheme: 'light'`.
  - `ThemeToggle` cambia a `cloudy-light`, y al recargar se mantiene sin parpadeo (el atributo ya viene en el HTML del SSR).

### Implementation for User Story 5

- [X] T072 [P] [US5] Crear `app/utils/navigation.ts` con `navItems: { to, label, icon, roles }[]`:
  - Inicio `/` `lucide:house` (editor, admin)
  - Archivos `/archivos` `lucide:folder` (editor, admin)
  - Pendientes `/pendientes` `lucide:inbox` (editor, admin)
  - Papelera `/papelera` `lucide:trash-2` (editor, admin)
  - Usuarios `/usuarios` `lucide:users` (admin)
  - Actividad `/actividad` `lucide:activity` (admin)
  - Mi perfil `/perfil` `lucide:user` (editor, admin)
- [X] T073 [P] [US5] Crear `app/composables/useFormatBytes.ts` (`Intl.NumberFormat('es')`, B/KB/MB/GB) y `app/composables/useFileIcon.ts` (`category` → `lucide:image`|`music`|`video`|`presentation`|`file-text`).
- [X] T074 [US5] Crear `app/components/app/AppSidebar.vue`:
  - Props `collapsed` y `pendingCount`; emite `navigate`.
  - Filtra `navItems` por `useMe().profile.role`.
  - Usa `menu` de daisyUI con `NuxtLink` y `aria-current`.
  - Cada ítem mide al menos 44 px de alto.
  - Badge `badge badge-primary` con el contador.
  - Botón de contraer solo en `lg`.
  - Con `collapsed` usa `tooltip tooltip-right`.
- [X] T075 [US5] Crear `app/components/app/AppTopbar.vue`:
  - Botón "Abrir menú" (`lucide:menu`, `lg:hidden`).
  - Búsqueda global con `input` y `aria-label="Buscar archivos"`: `onKeyStroke('/')` la enfoca, y `Enter` navega a `/archivos?q=`.
- [X] T076 [US5] Crear `app/layouts/dashboard.vue`:
  - `drawer lg:drawer-open` con un `drawer-toggle` controlado por `ref`.
  - Estado contraído con `useLocalStorage('cloudy-sidebar-collapsed', false)`.
  - Cierre del panel al cambiar `route.path`, con `onKeyStroke('Escape')` y al tocar el overlay.
  - `useScrollLock(document.body)` mientras el panel está abierto en móvil.
  - Cuando `useBreakpoints(breakpointsTailwind).greaterOrEqual('lg')` pasa a `true`, cierra el estado móvil (edge case).
  - Enlace "Saltar al contenido" y `<main id="contenido">`.
  - Monta `AppTopbar`, `AppSidebar` y `AppToast`.
- [X] T077 [US5] Crear `server/api/realtime/pulse.get.ts` (con `requireRole('editor')`). Recibe `since` (ISO opcional) y devuelve `{ cursor: now.toISOString(), pendingCount, newSubmissions: [] }`. `pendingCount` es el conteo de `guest_submissions` con `status='pending'`, considerando solo envíos cuyos archivos estén todos `ready`.
- [X] T078 [US5] Crear `app/composables/usePulse.ts`:
  - `pendingCount` y `newSubmissions` en `useState`.
  - `useIntervalFn(poll, POLL_INTERVAL_MS)`, que solo corre si `useDocumentVisibility() === 'visible'` y `useOnline()`.
  - Un pulso inmediato al volver a la pestaña.
  - Se usa desde `dashboard.vue` para el badge.
- [X] T079 [US5] Crear `server/api/dashboard.get.ts` (con `requireRole('editor')`). Devuelve `DashboardSummary`:
  - `recentFiles`: 8, con `deleted_at is null and upload_status='ready'`, ordenados por `created_at desc`.
  - `pendingCount`.
  - `totalsByCategory`: count y sum de bytes por `category`.
  - `storage`: `{ activeBytes, trashBytes }`, separados por `deleted_at` (FR-026, FR-037).
- [X] T080 [US5] Crear `app/pages/index.vue` (Inicio), con `layout: 'dashboard'` y `access: 'private'`:
  - `useFetch('/api/dashboard')` con los cuatro estados.
  - Tarjetas `stat`: pendientes (enlace a `/pendientes`), espacio usado activo y en papelera, y totales por tipo.
  - "Archivos recientes" con `FileCard` en modo compacto, o un `EmptyState` "Sube tu primer archivo".
  - Accesos rápidos: "Subir archivo", "Ver pendientes" y "Copiar enlace para invitados".
- [X] T081 [P] [US5] Crear `server/api/me.patch.ts` (con `requireActive`). Valida `{ name }` (1–80) y actualiza `profiles.name` (FR-030).
- [X] T082 [US5] Crear `app/pages/perfil.vue`:
  - Formulario de nombre: `PATCH /api/me` y `updateUser({ name })`.
  - Formulario de cambio de contraseña: `changePassword({ currentPassword, newPassword })`, con validación en línea.
  - Muestra el rol y el correo en solo lectura (FR-030).

**Checkpoint**: el shell del dashboard funciona a 360 px y en escritorio, y `AppSidebar.spec.ts` y `responsive-theme.spec.ts` pasan.

---

## Phase 6: User Story 1 — Subir, organizar y encontrar archivos del equipo (Priority: P1) 🎯 MVP core

**Goal**: Carpetas anidadas, subida múltiple con progreso (directa al bucket, validada por firma binaria), miniaturas, vista previa y reproducción, búsqueda, filtros, orden, renombrar, mover, descargar y enviar a papelera.

**Independent Test**:
1. Un editor crea "Domingo" y sube a la vez un JPG, un MP3 y un PPTX con progreso.
2. Ve la miniatura del JPG y reproduce el MP3.
3. Busca "dom" y filtra por Audio.
4. Descarga el PPTX.
5. Un archivo de 120 MB se rechaza antes de subir y `falso.jpg` responde 422.

### Tests for User Story 1 ⚠️

- [X] T083 [P] [US1] Crear `test/unit/file-signature.spec.ts`: con las fixtures de `test/fixtures/files/`, cada formato permitido se detecta, `falso.jpg` (`MZ`) se rechaza, un `.txt` con bytes nulos se rechaza y un ZIP con `.pptx` y `[Content_Types].xml` de PowerPoint se acepta.
- [X] T084 [P] [US1] Crear `test/unit/validation-files.spec.ts`: nombres de carpeta inválidos (`/ \ : * ? " < > |`, vacío, más de 120), nombres de archivo de más de 200, extensión no permitida, `size` 0 y `size` de 104 857 601.
- [X] T085 [P] [US1] Crear `test/nuxt/UploadQueue.spec.ts`:
  - Rechaza localmente un archivo de más de 100 MB con el mensaje "supera 100 MB".
  - Rechaza `.exe` con "formato no admitido".
  - Muestra el progreso por archivo con `progress` y `aria-valuenow`.
  - Un error de red ofrece "Reintentar".
- [X] T086 [P] [US1] Crear `test/e2e/files.spec.ts`:
  - Crear la carpeta "Domingo", subir 3 archivos y ver los 3 en la lista con uploader, fecha y tamaño.
  - Ver la miniatura del JPG (`img[alt]`).
  - Abrir el MP3 y ver un `audio` con controles.
  - Buscar "dom" en la barra superior y ver resultados; filtrar por "Audio" y ver solo el MP3; ordenar por tamaño.
  - Renombrar y mover a una subcarpeta.
  - Descargar con `download` (`waitForEvent('download')`).
  - Subir el mismo nombre otra vez da `foto (2).jpg`.
  - Eliminar pide confirmación y el archivo desaparece de la lista.
  - `falso.jpg` muestra un error y no aparece en la lista.
  - El flujo de subida pasa también en el viewport `phone`.

### Implementation for User Story 1

- [X] T087 [P] [US1] Crear `shared/validation/files.ts` con:
  - `folderInput`: `name` "1–120 car., sin `/ \ : * ? " < > |`" y `parentId` uuid o null.
  - `fileRenameInput`: `name` "1–200 car.", con la extensión inmutable.
  - `uploadInput`: `{ folderId, name, size (1 … 104 857 600), mimeType, withThumbnail }`, validado con `isAllowed(ext, mime)` (FR-009, FR-010).
  - `listQuery`: `sort` `name|date|size`, `dir` `asc|desc`, `type` `category`, `cursor`.
- [X] T088 [P] [US1] Crear `server/utils/file-signature.ts` con `matchesSignature(ext, bytes: Uint8Array): boolean` y la tabla de firmas de research R6:
  - Imágenes: JPG `FFD8FF`, PNG `89504E47`, GIF `GIF8`, WEBP `RIFF..WEBP`, HEIC `ftypheic|heix|mif1`.
  - Video y audio en contenedor: MP4/MOV/M4A `ftyp`.
  - Audio: MP3 `ID3` o `FFFB|FFF3|FFF2`, AAC `FFF1|FFF9`, WAV `RIFF..WAVE`, OGG `OggS`.
  - Documentos: PDF `%PDF`; PPTX/DOCX/ODP/KEY son ZIP `504B0304`, distinguiendo por el contenido de los primeros 4 KB cuando sea posible; PPT es OLE `D0CF11E0`.
  - TXT/MD: UTF-8 válido y sin `0x00`.
- [X] T089 [US1] Crear `server/utils/files.ts` con:
  - `toFileItem(row)`.
  - `visibleFilesWhere()`: `deleted_at is null and upload_status='ready'`.
  - `takenNames(folderId)`.
  - `buildBreadcrumbs(folderId)`, con un CTE recursivo de ancestros.
  - `assertNoCycle(folderId, newParentId)`, que responde 409 si el nuevo padre es descendiente.
- [X] T090 [US1] Crear `server/api/folders/[id]/children.get.ts` (con `requireRole('editor')`). `:id` = `root` o uuid. Aplica `listQuery` y devuelve `{ folder, breadcrumbs, folders, files, nextCursor }`, con 60 elementos por página, paginación por cursor `(sort_key, id)` y solo elementos visibles.
- [X] T091 [P] [US1] Crear `server/api/folders/tree.get.ts` (con `requireRole('editor')`): devuelve `{ id, name, parentId }[]` de las carpetas no borradas.
- [X] T092 [US1] Crear `server/api/folders/index.post.ts`: crea la carpeta con `withSuffix` si el nombre ya existe y registra `folder.create` en el mismo `db.batch`. También `server/api/folders/[id].patch.ts`: renombra o mueve, con `assertNoCycle`, sufijo y `folder.rename`/`folder.move` (con `meta { from, to }`).
- [X] T093 [US1] Crear `server/api/folders/[id].delete.ts`. Envía a papelera con un CTE recursivo que marca la carpeta y sus descendientes no borrados con `deleted_at = now()`, `deleted_by` y `trash_root_id = :id`. Devuelve `{ trashedItems }` y registra `folder.trash` (FR-011, FR-034).
- [X] T094 [P] [US1] Crear `server/api/folders/[id]/count.get.ts`: devuelve `{ items }`, el número de descendientes visibles, para el mensaje de confirmación ("se enviarán N elementos a la papelera").
- [X] T095 [US1] Crear `server/api/uploads/index.post.ts` (con `requireRole('editor')`):
  - Valida con `uploadInput`, que responde 413 si supera el tamaño y 415 si la extensión o el MIME no están permitidos.
  - Inserta un `files` con `upload_status='uploading'`, `origin='team'`, `uploaded_by` y `storage_key = key('files/' + id)`.
  - Genera `presignPut` (y `thumbUploadUrl` en `thumbs/{id}.webp` si `withThumbnail`).
  - Devuelve `{ fileId, uploadUrl, thumbUploadUrl?, headers }`.
- [X] T096 [US1] Crear `server/api/uploads/[fileId]/complete.post.ts`:
  - Hace `head(storage_key)`. Si el tamaño no coincide, borra el objeto y la fila y responde 422.
  - Hace `readRange` de 4 KB y `matchesSignature`. Si no coincide, borra y responde 422 con "El contenido no corresponde al tipo de archivo".
  - Si hay miniatura, `head(thumb)` → `thumb_key`.
  - Aplica `withSuffix` contra los nombres listos de la carpeta y pasa a `upload_status='ready'`.
  - Registra `file.upload` y devuelve `FileItem`.

  Crear también `server/api/uploads/[fileId].delete.ts`, que cancela la subida: borra el objeto y la fila si sigue en `uploading` y pertenece al usuario.
- [X] T097 [P] [US1] Crear `server/api/files/search.get.ts` (con `requireRole('editor')`): `q` con `ILIKE '%q%'` sobre `files.name`, apoyado en el índice trigram, más `type`, `sort`, `dir` y `cursor`. Devuelve `FileItem` con `path` (los nombres de las carpetas ancestro) (FR-012).
- [X] T098 [P] [US1] Crear `server/api/files/[id].get.ts`, que devuelve `FileItem` + `path`, y `server/api/files/[id].patch.ts`, que renombra o mueve con `fileRenameInput`, `withSuffix` y `file.rename`/`file.move`.
- [X] T099 [P] [US1] Crear `server/api/files/[id].delete.ts`: marca `deleted_at`, `deleted_by` y `trash_root_id = id`, registra `file.trash` y responde 204.
- [X] T100 [P] [US1] Crear `server/api/files/[id]/content.get.ts`: hace `sendRedirect(event, presignGet(storage_key, download ? { download: name } : {}), 302)` con `Cache-Control: private, max-age=600`. Crear también `server/api/files/[id]/thumbnail.get.ts`, que hace lo mismo con `thumb_key` y responde 404 si no existe (FR-013, FR-014).
- [X] T101 [P] [US1] Crear `app/utils/thumbnail.ts` con `makeThumbnail(file: File): Promise<Blob | null>`. Para JPG/PNG/WEBP/GIF usa `createImageBitmap` y un canvas con 320 px en el lado mayor, y genera `toBlob('image/webp', 0.8)`. Para HEIC u otros formatos, o si falla la decodificación, devuelve `null` (R9).
- [X] T102 [US1] Crear `app/composables/useUploader.ts`:
  - Cola reactiva de `{ id, file, status: 'queued'|'uploading'|'verifying'|'done'|'error', progress, error }`.
  - Valida localmente con `uploadInput`.
  - Genera la miniatura con `makeThumbnail`.
  - Pide el presign con `POST /api/uploads`.
  - Sube con `XMLHttpRequest` PUT, actualizando el progreso en `upload.onprogress` y con las cabeceras firmadas; sube la miniatura si existe.
  - Llama a `complete`.
  - Concurrencia de 3, `retry(id)`, `cancel(id)` (que llama a `DELETE /api/uploads/:id`) y un toast al terminar.
  - Recibe el parámetro `mode: 'team' | 'guest'`, que US3 usa con los endpoints públicos.
- [X] T103 [US1] Crear `app/components/upload/DropZone.vue` (`useDropZone` + `useFileDialog({ multiple: true, accept })` con las extensiones de `ALLOWED_TYPES`, área accesible con `role="button"` y `aria-describedby` con los formatos y el límite), `app/components/upload/UploadQueue.vue` (una fila por archivo con nombre, tamaño, `progress`, estado y botones Reintentar/Cancelar) y `app/components/upload/UploadDialog.vue` (un `modal` con DropZone + UploadQueue; prop `folderId`; emite `uploaded`).
- [X] T104 [P] [US1] Crear `app/components/files/FileCard.vue`:
  - Miniatura `<img loading="lazy" decoding="async" width height alt>` desde `/api/files/:id/thumbnail` si hay `thumbKey`; si no, el ícono de `useFileIcon`.
  - Nombre, tamaño, fecha relativa (`useTimeAgoIntl`, locale `es`) y badge "invitado" si `origin='guest'`.
  - Botón visible `⋯` con un `dropdown`: Abrir, Descargar, Renombrar, Mover y Eliminar.
- [X] T105 [P] [US1] Crear `app/components/files/FileGrid.vue` y `app/components/files/FileList.vue`, que comparten la API de props `items` y `folders` y los eventos `open`, `rename`, `move`, `trash`. La vista se guarda con `useLocalStorage('cloudy-files-view','grid')`, y `useInfiniteScroll` carga la siguiente página.
- [X] T106 [P] [US1] Crear `app/components/files/Breadcrumbs.vue` (`breadcrumbs` de daisyUI con scroll horizontal interno en móvil) y `app/components/files/FolderPicker.vue` (`modal` con el árbol de `/api/folders/tree`, la prop `excludeId` y el evento `select(folderId|null)`).
- [X] T107 [US1] Crear `app/components/files/FilePreview.vue`:
  - **image**: `<img>` desde `/content`.
  - **audio/video**: `<audio>`/`<video>` con `useMediaControls` y controles accesibles.
  - **pdf**: `<iframe title>`.
  - **resto**: el ícono más "Descargar".
- [X] T108 [US1] Crear `app/pages/archivos/index.vue` (raíz) y `app/pages/archivos/[folderId].vue`, que comparten `app/components/files/FileExplorer.vue`:
  - Breadcrumbs, botones "Nueva carpeta" y "Subir".
  - Filtros por tipo (`join` de botones) y orden (`select`).
  - Cuando hay `?q=`, se muestran los resultados de `/api/files/search` con un `refDebounced` de 300 ms.
  - Los cuatro estados.
  - Diálogos para renombrar (validación en línea), mover (`FolderPicker`) y eliminar (`useConfirm`, con el conteo de `/count` para carpetas).
  - Toasts.
- [X] T109 [US1] Crear `app/pages/archivos/ver/[fileId].vue`: `FilePreview` más los metadatos (subido por, fecha, tamaño, origen), las acciones (Descargar, Renombrar, Mover, Eliminar) y un slot reservado para los comentarios (US8). En escritorio el contenido va en dos columnas (`lg:grid-cols-[1fr_22rem]`).
- [X] T110 [US1] Conectar el acceso rápido de `app/pages/index.vue` y el botón "Subir" del explorador (`FileExplorer`) para que abran `UploadDialog` con la carpeta actual (`route.params.folderId ?? null`) y refresquen la vista al emitirse `uploaded`.

**Checkpoint**: el **MVP** (US2 + US6 + US5 + US1) es funcional y desplegable, y todos los tests de las fases 2 a 6 pasan.

### Fase 6b: bugs visuales de la prueba humana del MVP

- [X] T110a [US5] Barra lateral sin scroll vertical ni hueco: en `app/components/app/AppSidebar.vue` el `aside` pasa a `h-full min-h-dvh overflow-hidden` y el scroll queda solo en el `nav` (`min-h-0 flex-1 overflow-y-auto`); en `app/layouts/dashboard.vue`, `drawer-side` lleva `lg:sticky lg:top-0 lg:h-dvh`.
- [X] T110b [US5] Avatar completo: en `app/components/app/AppTopbar.vue` el botón pasa a `btn btn-circle avatar avatar-placeholder p-0 border-0` y el `span` a `size-full rounded-full`.
- [X] T110c [US1] Filtros de Archivos sin barras de scroll al hacer clic: en `app/components/files/FileExplorer.vue` el contenedor de los filtros agrega `overflow-y-hidden py-1 [scrollbar-width:none] lg:overflow-visible`.
- [X] T110d [US5] Tests de regresión en `test/e2e/responsive-theme.spec.ts`, a 360 y 1280 px: `.drawer-side` sin scroll y `aside` del alto del viewport; el `span` del avatar mide lo mismo que su botón; tras hacer clic en un filtro, el contenedor cumple `scrollHeight <= clientHeight`.

---

## Phase 7: User Story 3 — Envío público de invitados con cola de aprobación (Priority: P2)

**Goal**: La página pública `/enviar` (nombre + nota + archivos), la cola de pendientes con aviso en vivo en menos de 5 s, la aprobación hacia una carpeta, el rechazo y la caducidad a los 7 días.

**Independent Test**: Sin cuenta, desde un viewport de 360 px, se envían 2 fotos con nombre. El editor conectado ve un toast y el contador en menos de 5 s, aprueba hacia "Domingo" y las fotos aparecen ahí con el badge "invitado".

### Tests for User Story 3 ⚠️

- [X] T111 [P] [US3] Crear `test/unit/validation-submissions.spec.ts`: `submissionInput` exige `senderName` de 1–80, `note` de hasta 500, de 1 a 20 `files`, cada uno válido, y `reason` de hasta 300.
- [X] T112 [P] [US3] Crear `test/e2e/guest-queue.spec.ts`:
  - **Envío**: en un contexto A (editor en `/`) y un contexto B (anónimo, `phone`) que envía 2 imágenes con nombre, B ve "Recibimos tu envío" y A ve el toast y el badge "1" en ≤ 5 s (`expect.poll`, timeout 5000).
  - **Aprobación**: A aprueba hacia una carpeta y los archivos aparecen con el badge "invitado".
  - **Rechazo**: un segundo envío rechazado no aparece en `/archivos`.
  - **Concurrencia**: dos pestañas aprueban el mismo envío y la segunda ve "ya fue revisado".
  - **Validación**: enviar sin nombre muestra un error en línea.
  - **Rate limit**: con 6 envíos rápidos, el sexto responde 429 con el mensaje correspondiente.

### Implementation for User Story 3

- [X] T113 [P] [US3] Crear `shared/validation/submissions.ts` con:
  - `submissionInput`: `senderName` "1–80 car.", `note` "≤ 500 car." opcional, y `files` de 1 a `MAX_GUEST_FILES` elementos validados con `uploadInput` sin `folderId`.
  - `approveInput`: `{ folderId: uuid|null }`.
  - `rejectInput`: `{ reason?: ≤ 300 }`.
- [X] T114 [US3] Crear `server/api/public/submissions/index.post.ts` (público):
  - Aplica `hitRateLimit('guest:' + hashSender(ip), { limit: 5, windowSec: 3600 })`.
  - Valida con `submissionInput`.
  - Hace un `db.batch` que inserta `guest_submissions` (con `sender_key`) y los `guest_submission_files` (`upload_status='uploading'`, `storage_key = key('guest/{submissionId}/{uuid}')`).
  - Devuelve `{ submissionId, uploads: [{ fileId, uploadUrl, headers }] }` (FR-016, FR-020).
- [X] T115 [US3] Crear `server/api/public/submissions/[id]/complete.post.ts` (público). Para cada archivo `uploading` hace `head` + `readRange` + `matchesSignature`; si falla, borra el objeto y la fila. Marca los válidos como `ready` y devuelve `{ status: 'pending', accepted, rejected }`. Si no queda ningún archivo válido, borra el envío y responde 422.
- [X] T116 [P] [US3] Crear `server/api/submissions/index.get.ts` (con `requireRole('editor')`): filtra por `status` (por defecto `pending`) y devuelve `Submission[]` con `expiresAt = created_at + 7 d` y los archivos `ready`.
- [X] T117 [P] [US3] Crear `server/api/submissions/[id]/files/[fileId]/content.get.ts` (con `requireRole('editor')`): responde 302 a `presignGet` del archivo del envío.
- [X] T118 [US3] Crear `server/api/submissions/[id]/approve.post.ts`. Hace un `db.batch` con:
  1. `UPDATE guest_submissions SET status='approved', reviewed_by, reviewed_at, target_folder_id WHERE id=$1 AND status='pending' RETURNING`. Si no afecta filas, responde 409 "Este envío ya fue revisado por otra persona".
  2. `INSERT INTO files … SELECT` desde `guest_submission_files` (`origin='guest'`, `guest_name = sender_name`, `submission_id`, se reutiliza `storage_key`, `upload_status='ready'`, nombres con `withSuffix`).
  3. `activityInsert('submission.approve')`.

  Devuelve `{ files }` (FR-019).
- [X] T119 [US3] Crear `server/api/submissions/[id]/reject.post.ts`: un `UPDATE … WHERE status='pending' RETURNING` condicional (409 si ya fue revisado), seguido de `deleteMany` de los objetos, el borrado de `guest_submission_files` y `activityInsert('submission.reject')`. Responde 204.
- [X] T120 [US3] Extender `server/api/realtime/pulse.get.ts` para que `newSubmissions` incluya los envíos `pending` cuyos archivos estén todos `ready`, creados después de `since`, con `{ id, senderName, fileCount, createdAt }` (FR-018).
- [X] T120a [US3] Migración `0002`: `guest_submissions.completed_at timestamptz` (nullable). `readyPendingSubmissionsSql()` exige `completed_at IS NOT NULL` y `pulse.get.ts` filtra `newSubmissions` por `completed_at > since` en SQL (si la subida tarda más de 5 s, `created_at` queda antes del cursor y el aviso nunca saldría).
- [X] T121 [US3] Extender `app/composables/usePulse.ts`: cuando `newSubmissions.length > 0`, mostrar un toast "Nuevo envío de {senderName} ({n} archivos)" con un enlace a `/pendientes`.
- [X] T121a [US3] `useToast` admite `action?: { label, to }` y `AppToast.vue` lo muestra como `NuxtLink`; ese toast dura 8 s.
- [X] T122 [US3] Crear `app/pages/enviar.vue`, con `layout: 'public'` y `access: 'public'`:
  - Formulario con nombre (obligatorio) y nota (opcional, contador de 500).
  - `DropZone` + `UploadQueue` con `app/composables/useGuestSubmission.ts` (en vez de un `mode: 'guest'` en `useUploader`: el flujo de invitados presigna el lote con una llamada, sube de 3 en 3 y cierra con un solo `complete`). `putWithProgress` se mueve a `app/utils/upload-put.ts`.
  - Estado final "¡Gracias! Recibimos tu envío y el equipo lo revisará".
  - Un 429 muestra "Has enviado demasiados archivos; intenta en una hora".
  - Mobile first (SC-002).
- [X] T123 [P] [US3] Crear `app/components/guests/SubmissionCard.vue`:
  - Remitente, nota, fecha relativa y "caduca en N días".
  - Miniaturas o íconos de los archivos con vista previa por `/content`.
  - Botón "Aprobar", que abre `FolderPicker`, y "Rechazar", que abre un `modal` con el motivo opcional; ambos con estado de carga.
- [X] T124 [US3] Crear `app/pages/pendientes.vue`:
  - Lista de `SubmissionCard` con los cuatro estados; el `EmptyState` dice "No hay envíos pendientes".
  - Cabecera con "Copiar enlace para invitados" (`useClipboard` sobre `${siteUrl}/enviar`, y `useShare` si `isSupported`).
  - Refresca cuando cambia `usePulse().pendingCount`.
  - Pestañas `pending`/`approved`/`rejected` (con `tabs` de daisyUI).
  - En un 409 muestra un toast y refresca.
- [X] T125 [US3] Crear `server/api/cron/cleanup.get.ts`, versión inicial:
  - Verifica `getRequestHeader(event,'authorization') === \`Bearer ${cronSecret}\``; si no coincide, responde 401.
  - Marca como `expired` los `guest_submissions` `pending` con `created_at < now() − interval '7 days'` y borra sus objetos y archivos.
  - Borra los `files` y `guest_submission_files` en `uploading` con más de 24 h, junto con sus objetos.
  - Borra las filas de `rate_limits` con `window_start < now() − interval '1 day'`.
  - Procesa en lotes de 500 y devuelve `{ expiredSubmissions, orphanUploads, rateLimitRows }` (FR-020, R8).

**Checkpoint**: US3 funciona de forma independiente sobre el MVP y `guest-queue.spec.ts` pasa.

---

## Phase 8: User Story 4 — Gestión de usuarios (solo administrador) (Priority: P2)

**Goal**: El admin lista usuarios (los pendientes primero), los activa con un rol, los desactiva o reactiva, cambia su rol y los elimina, sin dejar nunca el sistema sin admin activo. Incluye el registro de actividad (FR-023).

**Independent Test**: El admin activa a un pendiente como editor, que entra al dashboard. Luego lo desactiva y en su siguiente acción el editor termina en `/pendiente`. El único admin no puede quitarse el rol.

### Tests for User Story 4 ⚠️

- [X] T126 [P] [US4] Crear `test/e2e/users.spec.ts`:
  - Un pendiente aparece destacado y se activa como editor, que entra.
  - Al desactivarlo, la siguiente navegación del editor lo lleva a `/pendiente`.
  - Se cambia el rol de editor a admin y de vuelta.
  - Al eliminarlo, el usuario no puede entrar.
  - El único admin, al quitarse el rol, desactivarse o eliminarse, recibe un 409 con el mensaje explicativo.
  - `/actividad` lista `user.activate` y `user.role_change`.
- [X] T127 [P] [US4] Extender `test/e2e/routes-guard.spec.ts`: un editor que va a `/usuarios` o `/actividad` ve "Acceso denegado", y `GET /api/users` y `GET /api/activity` como editor responden 403 (SC-009).

### Implementation for User Story 4

- [X] T128 [P] [US4] Crear `shared/validation/users.ts`: `userPatchInput` = `{ status?: 'active'|'disabled', role?: 'admin'|'editor' }`. Activar desde `pending` exige `role`. También `usersQuery` con `status`, `page` y `pageSize` de hasta 50.
- [X] T129 [US4] Crear `server/api/users/index.get.ts` (con `requireRole('admin')`). Los perfiles excepto `removed` se ordenan con `CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at desc`, con paginación por offset. Devuelve `{ items, total }`.
- [X] T130 [US4] Crear `server/api/users/[id].patch.ts` (con `requireRole('admin')`):
  - Hace un `UPDATE profiles SET … WHERE user_id=$1 AND NOT (<el objetivo es admin activo> AND <el cambio lo deja sin ser admin activo> AND (SELECT count(*) FROM profiles WHERE role='admin' AND status='active') <= 1) RETURNING`.
  - Si no afecta filas, responde 409 "Debe existir al menos un administrador activo" (FR-022).
  - Fija `approved_by` al activar.
  - Registra en `activityInsert` `user.activate`, `user.disable` o `user.role_change` (con `meta { from, to }`).
- [X] T131 [US4] Crear `server/api/users/[id].delete.ts` (con `requireRole('admin')`): la misma protección del último admin; luego `status='removed'`, `name='Usuario eliminado'`, `role=null` y `user.remove`. Responde 204.
- [X] T132 [US4] Crear `app/pages/usuarios.vue`, con `access: 'private'` y `roles: ['admin']`:
  - Tabla responsive: en móvil son `card` apiladas y desde `md` una `table`.
  - Por usuario: badge de estado, `select` de rol y acciones Activar como…, Desactivar, Reactivar y Eliminar (con `useConfirm`).
  - Paginación con `useOffsetPagination`.
  - Los cuatro estados.
  - En un 409 muestra un toast con el mensaje del servidor.
- [X] T133 [P] [US4] Crear `server/api/activity.get.ts` (con `requireRole('admin')`): cursor por `id` descendente, filtros por `actor` y `action`, 50 por página.
- [X] T134 [US4] Crear `app/pages/actividad.vue`, con `roles: ['admin']`: una lista cronológica (`timeline` o lista) con actor, acción traducida al español (mapa en `app/utils/activity-labels.ts`), objetivo y fecha relativa; `useInfiniteScroll`, filtros y los cuatro estados (FR-023).
- [X] T134a [US4] Badge de usuarios pendientes en el menú: `pulse.get.ts` devuelve `pendingUsers` (solo para admin; `0` si no), `Pulse` lo tipa, migración `0001` con el índice `profiles_status_created_idx (status, created_at)`, `usePulse` lo expone y `AppSidebar` recibe `badges: Partial<Record<string, number>>` por `item.to` (`/pendientes` y `/usuarios`).

**Checkpoint**: US4 funciona, y `users.spec.ts` y la extensión de `routes-guard.spec.ts` pasan.

---

## Phase 9: User Story 7 — Papelera y recuperación de elementos eliminados (Priority: P2)

**Goal**: Listar la papelera con la ubicación original y los días restantes, restaurar (con el contenido y los comentarios), purgar uno a uno, vaciar la papelera (solo admin) y purgar automáticamente a los 30 días.

**Independent Test**: Un editor elimina una foto, la ve en `/papelera` con 30 días restantes, la restaura y vuelve a su carpeta. Una carpeta restaurada vuelve completa.

### Tests for User Story 7 ⚠️

- [ ] T135 [P] [US7] Crear `test/unit/retention.spec.ts` para `daysLeft(deletedAt, now, 30)` en `shared/retention.ts`: el mismo día da 30, a los 29 días da 1, a los 30 da 0 y nunca es negativo. También `expiresAt(createdAt, 7)`.
- [ ] T136 [P] [US7] Crear `test/e2e/trash.spec.ts`:
  - Eliminar un archivo lo muestra en `/papelera` con "30 días" y "Ubicación original".
  - Restaurarlo lo devuelve a su carpeta.
  - Eliminar una carpeta con 2 archivos y una subcarpeta deja en la papelera solo la carpeta raíz, con "4 elementos"; al restaurarla vuelve todo.
  - Con la carpeta original ya en papelera, restaurar un archivo lo deja en la raíz con un aviso.
  - Purgar uno, tras confirmar, lo borra definitivamente.
  - "Vaciar papelera" solo es visible para el admin.
  - Los elementos en papelera no aparecen en la búsqueda ni en los totales de Inicio.

### Implementation for User Story 7

- [ ] T137 [P] [US7] Crear `shared/retention.ts` con `daysLeft()` y `expiresAt()`, usando `TRASH_RETENTION_DAYS` y `SUBMISSION_TTL_DAYS`.
- [ ] T138 [US7] Crear `server/utils/trash.ts` con:
  - `listTrash()`: solo las raíces, `trash_root_id = id`, uniendo carpetas y archivos, con `originalPath`, `deletedBy`, `itemCount`, `bytes` y `daysLeft`.
  - `restore(kind, id)`: limpia `deleted_*` y `trash_root_id` de todas las filas con ese `trash_root_id`. Si el padre ya no existe o está en papelera, mueve la raíz a `null` y devuelve `movedToRoot: true`. Aplica `withSuffix` si el nombre choca.
  - `purge(rootIds[])`: reúne `storage_key` y `thumb_key`, hace `deleteMany` y luego borra las filas (los comentarios caen en cascada).
- [ ] T139 [US7] Crear `server/api/trash/index.get.ts` (editor), `server/api/trash/[kind]/[id]/restore.post.ts` (editor; registra `file.restore`/`folder.restore`), `server/api/trash/[kind]/[id].delete.ts` (editor; registra `file.purge`/`folder.purge`) y `server/api/trash/index.delete.ts` (con `requireRole('admin')`, purga todo y registra `trash.empty`) (FR-034, FR-035).
- [ ] T140 [US7] Extender `server/api/cron/cleanup.get.ts` para que purgue las raíces de papelera con `deleted_at < now() − interval '30 days'` mediante `purge()` y agregue `purgedTrash` a la respuesta (FR-036).
- [ ] T141 [US7] Crear `app/pages/papelera.vue`:
  - Lista de `TrashItem` con ícono, nombre, "Ubicación original: /a/b", eliminado por, fecha y un `badge` con los días restantes (`badge-warning` si quedan 7 o menos, con contraste AA).
  - Acciones "Restaurar" (toast con la ubicación final, avisando si quedó en la raíz) y "Eliminar definitivamente" (con `useConfirm` `danger`).
  - Botón "Vaciar papelera" visible solo si `can(role,'trash.empty')`.
  - Los cuatro estados; el `EmptyState` dice "La papelera está vacía".

**Checkpoint**: US7 funciona y `trash.spec.ts` pasa.

---

## Phase 10: User Story 8 — Comentarios en archivos (Priority: P3)

**Goal**: Comentar archivos, editar y borrar los comentarios propios, que el admin borre cualquiera, contador por archivo y visibilidad para otros en menos de 5 s.

**Independent Test**: El editor A comenta una presentación y el editor B, que tiene el archivo abierto, ve el comentario en menos de 5 s con el autor y la fecha.

### Tests for User Story 8 ⚠️

- [ ] T142 [P] [US8] Crear `test/unit/validation-comments.spec.ts`: `commentInput` rechaza el texto vacío o solo con espacios y el de 2 001 caracteres, y acepta el de 2 000.
- [ ] T143 [P] [US8] Crear `test/e2e/comments.spec.ts`:
  - A publica y B (otro contexto con el archivo abierto) lo ve en ≤ 5 s.
  - A edita su comentario y aparece "editado".
  - B no tiene opciones de editar ni borrar en el comentario de A, y `PATCH` directo responde 403.
  - El admin borra el comentario de A.
  - Un archivo en papelera no admite comentarios (409).
  - El contador de comentarios aparece en `FileCard`.

### Implementation for User Story 8

- [ ] T144 [P] [US8] Crear `shared/validation/comments.ts`: `commentInput` = `{ body }` con "1–2 000 car. tras `trim`".
- [ ] T145 [US8] Crear `server/api/files/[id]/comments.get.ts` (editor). Acepta `since` opcional y devuelve `Comment[]` en orden cronológico, con `canEdit = author === me` y `canDelete = author === me || admin`. Crear también `server/api/files/[id]/comments.post.ts` (editor): responde 409 "El archivo está en la papelera" si `deleted_at` no es null; si no, inserta y responde `201 Comment`.
- [ ] T146 [US8] Crear `server/api/comments/[id].patch.ts` (solo el autor, 403 si no; fija `edited_at = now()`) y `server/api/comments/[id].delete.ts` (el autor o un admin; si lo borra un admin sin ser autor, registra `comment.admin_delete`) (FR-039).
- [ ] T147 [US8] Agregar `commentCount` como subconsulta agregada `(SELECT count(*) FROM comments c WHERE c.file_id = files.id)` en `server/api/folders/[id]/children.get.ts`, `server/api/files/search.get.ts` y `server/api/files/[id].get.ts`, y mostrar el contador (`lucide:message-circle` + número) en `app/components/files/FileCard.vue` (FR-040).
- [ ] T148 [P] [US8] Crear `app/components/comments/CommentItem.vue`:
  - Autor, fecha relativa y "(editado)".
  - Edición en línea con `textarea` y el contador de 2 000.
  - Acciones según `canEdit`/`canDelete`, con `useConfirm` al borrar.
- [ ] T149 [US8] Crear `app/components/comments/CommentThread.vue`:
  - Prop `fileId`. Carga inicial y sondeo con `useIntervalFn(POLL_INTERVAL_MS)` pidiendo solo `?since=<último createdAt>`, pausado si la pestaña está oculta o si `useElementVisibility` del hilo es falso.
  - Formulario para publicar con validación en línea.
  - Los cuatro estados; el `EmptyState` dice "Sé el primero en comentar".

  Integrarlo en el slot de `app/pages/archivos/ver/[fileId].vue` (FR-038, SC-011).

**Checkpoint**: US8 funciona y `comments.spec.ts` pasa.

---

## Phase 11: User Story 9 — Experiencia rápida y pulida en cualquier pantalla (Priority: P3)

**Goal**: Que todas las vistas cumplan los cuatro estados, los toasts, el movimiento reducido, la accesibilidad y el tema, de forma consistente (Constitución VI).

**Independent Test**: Recorrer subir, buscar, aprobar y gestionar usuarios a 360 px y a 1280 px en ambos temas, sin scroll horizontal y con los estados vacíos, de carga y de error visibles.

### Tests for User Story 9 ⚠️

- [ ] T150 [P] [US9] Crear `test/nuxt/four-states.spec.ts`. Para `pages/index.vue`, `archivos/index.vue`, `pendientes.vue`, `papelera.vue`, `usuarios.vue` y `actividad.vue`, con `registerEndpoint` de `@nuxt/test-utils`, verificar que se renderizan el skeleton (respuesta pendiente), el `EmptyState` (lista vacía) y el `ErrorState` con "Reintentar" (500), y que al reintentar se vuelve a pedir.
- [ ] T151 [P] [US9] Extender `test/e2e/responsive-theme.spec.ts` para que recorra **todas** las páginas privadas y públicas a 360 px y 1280 px en `cloudy` y `cloudy-light`. Debe verificar que no hay scroll horizontal, que no hay botones táctiles de menos de 44 px de alto en el viewport `phone` (`boundingBox().height >= 44` en `button, a.btn, input`) y que el foco es visible al tabular.

### Implementation for User Story 9

- [ ] T152 [US9] Auditar todas las páginas de `app/pages/**` y los componentes de `app/components/**`:
  - Reemplazar cualquier color fijo por clases semánticas.
  - Quitar `btn-sm`/`btn-xs` usados como base.
  - Asegurar `aria-label` en los botones que solo tienen ícono.
  - Comprobar que ninguna acción depende de `hover` y que todas las fechas usan `useTimeAgoIntl('es')`.

  Corregir lo que se encuentre.
- [ ] T153 [US9] Revisar que toda acción completada (crear, renombrar, mover, eliminar, restaurar, aprobar, rechazar, comentar, guardar perfil, cambiar rol) muestre un toast con `useToast()` y que todos los errores de la API muestren un mensaje en español que explique qué hacer. Centralizar los mensajes en `app/utils/messages.ts`.
- [ ] T154 [P] [US9] Agregar `public/og-cloudy.png` y la meta `og:image`/`description` en `app/app.vue`. Agregar `public/favicon.svg` (la nube en el color primario) y reemplazar `public/favicon.ico` (FR-041).

**Checkpoint**: las 9 historias funcionan y los tests de US9 pasan.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Los gates de la constitución (I rendimiento, IV calidad, V cobertura), la seguridad, la documentación y la validación final.

- [ ] T155 [P] Crear `test/e2e/performance.spec.ts` (R18):
  - Chromium con el viewport `phone` y CDP `Network.emulateNetworkConditions({ downloadThroughput: 9e6/8, uploadThroughput: 1.5e6/8, latency: 170 })` y `Emulation.setCPUThrottlingRate({ rate: 4 })`.
  - Mide LCP y CLS con `PerformanceObserver` en `page.evaluate`.
  - Toma la mediana de 3 cargas en `/` (sembrado con 50 archivos), `/archivos/<carpeta con 200 elementos>` y `/enviar`.
  - Afirma LCP ≤ 2500 ms y CLS ≤ 0.1.
- [ ] T156 [P] Medir el bundle con Sonda (`bun run analyze`, reportes en `.sonda/`) y comprobar que el JS inicial de cada ruta sea ≤ 200 KB gzip (Constitución I). Sustituye al script propio `scripts/check-bundle.ts`.
- [ ] T157 Optimizar lo que fallen T155 y T156:
  - Convertir componentes pesados en `Lazy*` donde se usan (`app/pages/archivos/ver/[fileId].vue`, `app/components/files/FileExplorer.vue`, `app/layouts/dashboard.vue`): `FilePreview`, `UploadDialog`, `FolderPicker` y `CommentThread`.
  - Revisar que no haya N+1 con `EXPLAIN` en `server/api/folders/[id]/children.get.ts` y `server/api/files/search.get.ts`.
  - Agregar `width`/`height` a las imágenes para el CLS.
- [ ] T158 Endurecer la seguridad:
  - En `server/middleware/security-headers.ts`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` y `Permissions-Policy` mínima.
  - Verificar que ningún endpoint de `server/api/**` (salvo `public/*`, `cron/*` y `me.get`) omite `requireRole`, con un test `test/unit/endpoint-guards.spec.ts` que recorra los archivos y busque `requireRole(` o `requireActive(`.
  - Verificar que no se registran ni se devuelven secretos.
- [ ] T159 [P] Ejecutar `bun run typecheck` y corregir todos los errores en `app/`, `server/`, `shared/` y `test/`, sin `any` sin justificar (Constitución IV).
- [ ] T160 [P] Ejecutar `bun run test:coverage` y agregar los tests unitarios que falten para alcanzar al menos el 80 % de líneas en `server/utils/**` y `shared/**` (Constitución V).
- [ ] T161 [P] Reescribir `README.md` con la descripción de Cloudy, los requisitos, las variables (solo nombres), los comandos y enlaces a `AGENTS.md`, `.specify/memory/constitution.md` y `specs/001-shared-media-drive/quickstart.md`. Eliminar el contenido del "Nuxt Minimal Starter".
- [ ] T162 Ejecutar toda la validación manual de `specs/001-shared-media-drive/quickstart.md` §4 (escenarios 1–13, incluido el INP con DevTools) y §5 (gates), y anotar los resultados y las desviaciones en `specs/001-shared-media-drive/quickstart.md` en una nueva sección "§8 Resultado de validación".
- [ ] T163 Revisar `vercel.json` y `nuxt.config.ts` para el preset `vercel`. Hacer un deploy de vista previa en Vercel con las variables de producción (sin `NUXT_TEST_*`), correr `bun run storage:setup` con el dominio de la vista previa y una prueba de humo con los escenarios 1, 4 y 6 del quickstart. Documentarlo en `specs/001-shared-media-drive/quickstart.md` §6.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no depende de nada.
- **Foundational (Phase 2)**: depende de Setup y **bloquea todas las historias**. T052 (spike) debe pasar antes de la Fase 3.
- **US2 (Phase 3)** depende de la Fase 2.
- **US6 (Phase 4)** depende de US2, porque usa las páginas de login y registro para sus e2e.
- **US5 (Phase 5)** depende de US6, porque usa `useApi`, las rutas protegidas y "Acceso denegado".
- **US1 (Phase 6)** depende de US5, porque monta el explorador en el layout `dashboard`.
- **Las historias P2 y P3** dependen solo del MVP (Fases 3–6) y entre sí son independientes, salvo lo indicado:
  - **US3 (Phase 7)**: reutiliza `useUploader`, `DropZone` y `FolderPicker` de US1.
  - **US4 (Phase 8)**: independiente.
  - **US7 (Phase 9)**: reutiliza el borrado de US1 (T093, T099) y extiende el cron de US3 (T125). Si US3 no está hecho, T140 crea el endpoint de cron con solo la purga de papelera.
  - **US8 (Phase 10)**: usa `archivos/ver/[fileId].vue` de US1.
  - **US9 (Phase 11)**: es transversal; conviene hacerla cuando estén las páginas de US3, US4 y US7.
- **Polish (Phase 12)** se hace después de las historias deseadas.

### User Story Dependencies (gráfico)

```text
Setup → Foundational ─┬→ US2 → US6 → US5 → US1 ══ MVP ══╦→ US3 ─┐
                      │                                 ╠→ US4  ├→ US9 → Polish
                      │                                 ╠→ US7 ←┘(cron)
                      │                                 ╚→ US8
```

### Within Each User Story

- Los tests se escriben primero y fallan, luego se implementa.
- Validadores en `shared/` → utilidades de servidor → endpoints → composables → componentes → páginas.
- Cada historia queda completa (sus tests en verde) antes de pasar a la siguiente prioridad.
- Se hace commit al terminar cada tarea o grupo lógico, con Conventional Commits.

### Parallel Opportunities

- **Setup**: T003–T007 en paralelo.
- **Foundational**:
  - Primero el esquema T009→T014, que es secuencial porque comparte archivo.
  - Después, en paralelo: T016, T017, T020, T021, T022, T023, T027, T028 y T029.
  - Luego T034–T040, todos en paralelo.
  - Los tests T044–T051 en paralelo.
- **Dentro de cada historia**: todas las tareas de tests `[P]` y los validadores, componentes y endpoints `[P]` de archivos distintos.
- **Tras el MVP**: US3, US4, US7 y US8 pueden asignarse a personas distintas.

---

## Parallel Example: User Story 1

```bash
# Tests de US1 (deben fallar primero):
Task: "T083 test/unit/file-signature.spec.ts"
Task: "T084 test/unit/validation-files.spec.ts"
Task: "T085 test/nuxt/UploadQueue.spec.ts"
Task: "T086 test/e2e/files.spec.ts"

# Base de US1 en paralelo:
Task: "T087 shared/validation/files.ts"
Task: "T088 server/utils/file-signature.ts"
Task: "T101 app/utils/thumbnail.ts"

# Endpoints independientes en paralelo (tras T089):
Task: "T097 server/api/files/search.get.ts"
Task: "T098 server/api/files/[id].get.ts + [id].patch.ts"
Task: "T099 server/api/files/[id].delete.ts"
Task: "T100 server/api/files/[id]/content.get.ts + thumbnail.get.ts"

# UI en paralelo:
Task: "T104 FileCard.vue"
Task: "T105 FileGrid.vue + FileList.vue"
Task: "T106 Breadcrumbs.vue + FolderPicker.vue"
```

## Parallel Example: después del MVP

```bash
Task: "Phase 7 — US3 invitados"      # persona A
Task: "Phase 8 — US4 usuarios"       # persona B
Task: "Phase 10 — US8 comentarios"   # persona C
```

---

## Implementation Strategy

### MVP First (todas las historias P1)

1. Phase 1 Setup → Phase 2 Foundational, incluido el **spike T052**.
2. Phase 3 US2 → Phase 4 US6 → Phase 5 US5 → Phase 6 US1.
3. **STOP and VALIDATE**: escenarios 1–5 y 11 del quickstart y `bun run test` en verde.
4. Deploy de vista previa en Vercel (T163 parcial) y demo con el equipo.

### Incremental Delivery

1. MVP: el equipo ya puede subir, organizar y encontrar material.
2. \+ US3: la congregación envía fotos y el equipo aprueba en vivo.
3. \+ US4: el admin gestiona al equipo desde la app, sin tocar la BD.
4. \+ US7: se pueden recuperar borrados accidentales.
5. \+ US8: coordinación por comentarios.
6. \+ US9 + Polish: los gates de la constitución se cierran y se pasa a producción.

### Parallel Team Strategy

Todo el equipo hace Setup + Foundational + el MVP en orden. Después se reparten US3, US4, US7 y US8 entre personas distintas, y US9 + Polish se hacen juntos al final.

---

## Notes

- `[P]` = archivos distintos y sin dependencias pendientes. `[USn]` = trazabilidad hacia spec.md.
- Las restricciones entre comillas en las tareas vienen literalmente de data-model.md y no se reinterpretan.
- Ante una utilidad nueva, primero buscar en VueUse (research R12) y documentar en el PR por qué no sirve si se escribe código propio.
- Cualquier dependencia nueva requiere una entrada en "Complexity Tracking" de plan.md (Constitución II).
- Gates de merge (constitución): typecheck + build, unit, nuxt y e2e en verde con cobertura, revisión a 360 px y 1280 px en ambos temas, y sin regresiones de rendimiento.
