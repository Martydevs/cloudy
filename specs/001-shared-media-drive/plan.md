# Implementation Plan: Cloudy — Disco multimedia compartido del equipo de producción

**Branch**: `001-shared-media-drive` | **Date**: 2026-10-14 (rev. 2: constitución v1.0.0) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-shared-media-drive/spec.md`

## Summary

Cloudy es un disco multimedia centralizado para el equipo de multimedia y audio de la iglesia:

- **Contenido**: el equipo (admin y editor) sube, organiza, previsualiza, comenta y recupera archivos de hasta 100 MB.
- **Invitados**: sin cuenta, envían material desde una página pública a una cola que se aprueba en vivo.
- **Interfaz**: un dashboard **mobile first** con barra lateral, temas oscuro y claro, y la identidad Cloudy.

**Enfoque técnico**:
- **Aplicación**: Nuxt 4 full-stack con SSR en **Vercel**.
- **Datos**: PostgreSQL de Neon vía **Drizzle** (driver HTTP).
- **Identidad**: **Neon Auth** con un adaptador h3 propio (`@neondatabase/auth/server`). Los roles y la aprobación viven en la tabla `profiles`.
- **Archivos**: **Neon Object Storage** con **PUT prefirmado directo desde el navegador**, más la validación de la firma binaria en el servidor.
- **Tiempo real**: sondeo de 3 s con VueUse.
- **Limpiezas**: **Vercel Cron**.
- **UI**: daisyUI 5 (`cloudy` / `cloudy-light`), `lucide`, DM Sans y VueUse como primera opción para utilidades reactivas.

Esta revisión alinea el plan con la **constitución v1.0.0** y con el `.env` actualizado por el usuario.

## Technical Context

**Language/Version**: TypeScript 5 (estricto) · Vue 3.5 · Nuxt 4.6 (Nitro 2.13, h3 1.15) · Bun (local) / Node 22 (Vercel)

**Primary Dependencies**:
- **Ya instaladas**:
  - Nuxt, `@vueuse/nuxt` 15
  - `drizzle-orm` 0.45 + `drizzle-kit`, `@neondatabase/serverless`
  - `@neondatabase/auth` 0.6.0-beta (se fijará exacta)
  - `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
  - `tailwindcss` 4 + `daisyui` 5, `@nuxt/icon` + `@iconify-json/lucide`, `@nuxt/fonts`, `@nuxt/image`
- **A agregar** (devDependencies, R19): `vue-tsc` y `typescript`, que son requisito de la Constitución IV.

**Storage**:
- **Base de datos**: PostgreSQL de Neon con las tablas de [data-model.md](./data-model.md).
- **Binarios**: Neon Object Storage, bucket `NUXT_S3_BUCKET`, path-style.
- **Identidad**: esquema `neon_auth`, que gestiona Neon.

**Testing**: Vitest 5 con los proyectos `unit`, `nuxt` y `e2e`. Los e2e usan `@nuxt/test-utils/e2e` + `playwright-core` contra **`NUXT_TEST_DATABASE_URL`**. La cobertura se mide con v8 y exige un mínimo de 80 % de líneas en `server/utils` y `shared` (R13).

**Target Platform**: Vercel (preset `vercel`, SSR). Navegadores móviles y de escritorio, desde 360 px.

**Project Type**: Aplicación web full-stack: un solo proyecto Nuxt con `app/`, `server/` y `shared/`.

**Performance Goals** (Constitución I, verificados según R18):
- LCP ≤ 2.5 s, INP ≤ 200 ms y CLS ≤ 0.1 en móvil 4G.
- JS inicial ≤ 200 KB gzip por ruta.
- Carpetas y búsquedas < 2 s con 5 000 archivos.
- Avisos de envíos y comentarios < 5 s.

**Constraints**:
- **Vercel**: cuerpo ≤ 4.5 MB y sin estado compartido entre instancias.
- **Archivos**: ≤ 100 MB y validación del contenido real.
- **Interfaz**: en español, WCAG 2.2 AA en ambos temas, oscuro por defecto sin parpadeo, objetivos táctiles ≥ 44 px.
- **Servicios beta**: Neon Auth y Object Storage, aislados en un módulo cada uno.

**Scale/Scope**: ~50 cuentas internas, cientos de envíos al mes, miles de archivos, 15 páginas, ~35 endpoints y 9 historias de usuario.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Se evalúa contra la constitución **v1.0.0**, que reemplaza los gates provisionales G1–G6 de la revisión anterior.

| Principio | Exigencias clave | Pre-diseño | Post-diseño: cómo se cumple |
|-----------|------------------|------------|-----------------------------|
| **I. Rendimiento medible** | LCP/INP/CLS, 200 KB JS por ruta, < 2 s con 5 000 elementos, índices, sin N+1, binarios fuera del servidor, miniaturas lazy, SSR | ✅ | ✅ Detalle en la fila de abajo. |
| | | | **Medición**: test e2e de Web Vitals con 4G emulado y reportes de Sonda con `bun run analyze` (R18); INP manual. |
| | | | **Datos**: índices por cada filtro y orden, más `pg_trgm` para búsquedas (data-model); paginación con cursor de 60 elementos; `comment_count` por subconsulta agregada, sin N+1. |
| | | | **Archivos**: PUT/GET prefirmados (R5); miniaturas WEBP generadas en el cliente con `loading="lazy"` (R9); SSR en todas las vistas privadas. |
| **II. Funcional y efectivo** | Historias independientes, YAGNI, Nuxt → VueUse → daisyUI → paquetes antes de código propio, dependencias nuevas justificadas, sin estados a medias | ✅ | ✅ 9 historias que se entregan por separado (spec). Mapa de VueUse en R12. Utilidades propias solo donde no existe equivalente (firmas, validadores, limitador; R3/R6/R11). Las subidas en dos fases y el cron evitan huérfanos (R5, R8). Las dos dependencias nuevas se justifican en Complexity Tracking. |
| **III. Mobile first** | Clases base para móvil, 360 px sin scroll horizontal, objetivos táctiles ≥ 44 px, sin depender de hover, verificación a 360 px y a 1280 px o más, uso con una mano | ✅ | ✅ Detalle en la fila de abajo. |
| | | | **Navegación**: drawer móvil con cierre automático (ui-routes). |
| | | | **Táctil**: `btn` e `input` miden 45 px con el tema; `btn-sm`/`btn-xs` prohibidos como base (ui-routes, reglas transversales). |
| | | | **Sin hover**: menús de archivo con botón `⋯` visible. |
| | | | **Pruebas**: e2e en 360×740 y 1280×800. |
| **IV. Calidad de código** | TS estricto sin `any`, `<script setup lang="ts">`, reglas en `shared/`, validación y autorización en el servidor, servicios beta en un solo módulo, sin código demo, `nuxt typecheck` y build en verde | ✅ | ✅ `shared/{validation,permissions,constants,types}`; `requireRole()` en cada endpoint (contracts/api.md); `server/utils/auth.ts` y `storage.ts` como únicas fronteras con los proveedores; se elimina el código demo (`TestComponent`, `api/test`, `usersTable`, `server/config/*`); se agregan `vue-tsc` + `typescript` y el script `typecheck` (R19); JWKS sin conectar para evitar código muerto (R17). |
| **V. Pruebas por defecto** | Tests unitarios, de componente y e2e por historia y por ruta protegida, regresión en cada bug, entorno aislado, selectores accesibles, 80 % de cobertura | ✅ | ✅ Estrategia R13: e2e contra `NUXT_TEST_DATABASE_URL`, con identidades y prefijos de storage únicos por corrida; `getByRole`/`getByLabel`; umbral de cobertura en `vitest.config.ts`. ⚠ Neon Auth y el bucket se comparten con desarrollo: es aislamiento lógico, no físico; ver Riesgos. |
| **VI. Consistencia de UX** | Tokens de tema, lucide, DM Sans, daisyUI, cuatro estados, confirmar lo destructivo, toast al terminar, español, WCAG 2.2 AA, reduced motion | ✅ | ✅ Temas y contrastes ya implementados en `globals.css`; reglas transversales y componentes `SkeletonList`, `EmptyState`, `ConfirmDialog` y `AppToast` en ui-routes; `text-warning` vetado sobre fondo claro. |
| **Restricciones técnicas** | Stack, Vercel sin estado, secretos en `NUXT_*`, migraciones Drizzle, privacidad de invitados | ✅ | ✅ R4 (migraciones), R3 (IP con hash y sal), R14 (variables), data-model (sin datos de invitados fuera de nombre y nota). |
| **Flujo y gates** | Spec Kit, Conventional Commits, rama por feature, gates de merge | ⚠ | ⚠ El repo **no tiene commits** y está en `master` (la rama principal configurada es `main`). Antes de `/speckit-implement`: commit inicial en `main` y creación de la rama `001-shared-media-drive`. Es una acción del usuario, no una violación del diseño. |

**Resultado**: **PASS**. No hay violaciones sin justificar. Las dos dependencias nuevas están en Complexity Tracking. Los dos ⚠ son prerrequisitos operativos (ramas y aislamiento de pruebas), no fallos del diseño.

## Project Structure

### Documentation (this feature)

```text
specs/001-shared-media-drive/
├── spec.md
├── plan.md              # este archivo (rev. 2)
├── research.md          # Fase 0 (R1–R19)
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/
│   ├── api.md           # contrato HTTP
│   └── ui-routes.md     # rutas, layouts, protección, componentes, reglas transversales
├── checklists/requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
app/
├── app.vue                      # NuxtLayout + useHead(data-theme desde cookie)
├── error.vue                    # 404 / errores
├── assets/css/globals.css       # temas cloudy / cloudy-light (ya existe)
├── layouts/        auth.vue · public.vue · dashboard.vue
├── middleware/     auth.global.ts
├── pages/
│   ├── index.vue · login.vue · registro.vue · recuperar.vue · restablecer.vue · pendiente.vue
│   ├── enviar.vue
│   ├── archivos/index.vue · archivos/[folderId].vue · archivos/ver/[fileId].vue
│   ├── pendientes.vue · papelera.vue · usuarios.vue · actividad.vue · perfil.vue
│   └── acceso-denegado.vue
├── components/
│   ├── app/       AppSidebar · AppTopbar · AppLogo · ThemeToggle · AppToast
│   ├── files/     FileGrid · FileList · FileCard · FilePreview · FolderPicker · Breadcrumbs
│   ├── upload/    UploadDialog · UploadQueue · DropZone
│   ├── comments/  CommentThread · CommentItem
│   ├── guests/    SubmissionCard
│   └── ui/        ConfirmDialog · EmptyState · SkeletonList · ErrorState
├── composables/   useMe · useAuthClient · usePulse · useUploader · useTheme · useToast · useFormatBytes
└── utils/         thumbnail.ts · navigation.ts

shared/
├── constants/files.ts · validation/ · permissions.ts · types/api.ts

server/
├── db/schema.ts                 # reemplaza el ejemplo; migraciones → ./drizzle
├── utils/   db.ts · auth.ts · session.ts · storage.ts · file-signature.ts · rate-limit.ts · naming.ts · activity.ts
├── middleware/session.ts
├── routes/api/auth/[...path].ts
└── api/     me · dashboard · realtime · folders · files · uploads · trash · comments · public/submissions · submissions · users · activity · cron

scripts/     storage-setup.ts
drizzle.config.ts                # → NUXT_DATABASE_URL
vercel.json                      # crons
test/
├── unit/    validation · file-signature · permissions · naming · rate-limit · auth-context · reset-redirect
├── nuxt/    AppSidebar · ThemeToggle · UploadQueue · auth-forms · ConfirmDialog · four-states
└── e2e/     auth-roles · routes-guard · files · guest-queue · trash · comments · users · responsive-theme · performance
    └── setup/  globalSetup (BD de prueba, runId, migrar/limpiar) · teardown (prefijo de storage) · fixtures
```

**Structure Decision**: Un solo proyecto Nuxt 4 sobre `app/`, `server/` y `test/`, que ya existen, más `shared/` para las reglas comunes. Se elimina el código demo y `server/config/*`, que se reemplaza por `server/utils/*`. Los globs de `vitest.config.ts` se amplían a `**`.

## Correcciones a la base existente

1. `server/config/auth.ts` usa `@neondatabase/auth/next/server`, que es incompatible con Nitro. Se reemplaza por el adaptador h3 (R1).
2. `drizzle.config.ts` lee `DATABASE_URL`, que no existe en `.env`. Pasa a `NUXT_DATABASE_URL`. Para migrar la BD de pruebas se usa un override (`DRIZZLE_DB_URL ?? NUXT_DATABASE_URL`).
3. `nuxt.config.ts`:
   - **Eliminar** `runtimeConfig.session`, un residuo de nuxt-auth-utils.
   - **Mantener** `databaseUrl`, `testDatabaseUrl` (ya corregido por el usuario), `neonAuthBaseUrl` y `neonAuthCookieSecret`.
   - **Agregar** `awsEndpointUrlS3`, `awsAccessKeyId`, `awsSecretAccessKey`, `awsRegion`, `s3Bucket`, `storageKeyPrefix` (vacío), `cronSecret`, `rateLimitSalt` y `public.siteUrl`.
   - Activar `nitro.experimental.asyncContext: true`.
   - `NUXT_NEON_JWKS_URL` **no** se mapea (R17).
4. `@neondatabase/auth`: fijar la versión exacta en `0.6.0-beta`.
5. `package.json`:
   - **devDependencies**: `vue-tsc`, `typescript`.
   - **scripts**: `typecheck`, `db:generate`, `db:migrate`, `db:migrate:test`, `storage:setup`, `analyze`.
6. `vitest.config.ts`: globs `test/<proyecto>/**`, `globalSetup` de e2e y umbral de cobertura del 80 % en `server/utils/**` y `shared/**`.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| El toolkit de Neon Auth es beta | Versión fija, adaptador con tests y un **spike** como primera tarea (registro, login, reset) |
| El reset de contraseña de Neon "no está totalmente soportado" (R15) | El spike lo valida; plan B por `forget-password` |
| Neon Object Storage es beta (CORS, presign) | `storage.ts` como única frontera; `storage:setup`; e2e de subida real |
| e2e comparte Neon Auth y bucket con desarrollo (Constitución V) | Identidades y prefijo `e2e/<runId>/` únicos más teardown. Si se agregan `NUXT_TEST_NEON_AUTH_BASE_URL` y `NUXT_TEST_S3_BUCKET` de una rama de pruebas, el aislamiento pasa a ser total sin cambiar código |
| El sondeo de 3 s con muchas pestañas | Pausa con `useDocumentVisibility` y `useOnline`; consulta indexada |
| Las Web Vitals emuladas en CI varían entre corridas | Mediana de 3 cargas por página; el umbral aplica a la mediana |
| Formatos ZIP (PPTX/DOCX/ODP) difíciles de distinguir con 4 KB | Tabla de firmas con fixtures reales; si el tipo exacto no se distingue, se acepta el ZIP solo si la extensión es de Office/ODF |

## Complexity Tracking

| Excepción / adición | Por qué es necesaria | Alternativa más simple rechazada porque |
|---------------------|----------------------|-----------------------------------------|
| devDependencies `vue-tsc` + `typescript` | La Constitución IV exige que `nuxt typecheck` pase, y no corre sin ellas | Confiar solo en el build: Vite no verifica tipos, así que los errores llegarían a producción |
| Utilidades propias: firmas binarias, validadores, limitador de tasa | No existe equivalente en Nuxt, VueUse, daisyUI ni en los paquetes instalados (Constitución II) | `file-type`, `zod` o Upstash agregarían dependencias o servicios fuera del stack para lógica pequeña y fácil de probar |

## Siguientes pasos

1. Usuario: commit inicial en `main` y creación de la rama `001-shared-media-drive` (gates de flujo de la constitución).
2. Opcional: agregar `NUXT_TEST_NEON_AUTH_BASE_URL` y `NUXT_TEST_S3_BUCKET` de la rama de pruebas para un aislamiento e2e total.
3. ✅ `AGENTS.md` ya está alineado con la constitución v1.0.0 y con este plan (2026-10-14).
4. Ejecutar `/speckit-tasks`.
