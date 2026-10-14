# Contrato de UI: rutas, layouts y protección

Páginas en `app/pages/**`, layouts en `app/layouts/**`. Cada página declara su acceso con `definePageMeta({ layout, access, roles? })`; el middleware global `app/middleware/auth.global.ts` lo aplica (FR-028, FR-029). La autoridad real está en el servidor (contracts/api.md) — el middleware solo evita mostrar UI no permitida.

## Valores de `access`

| `access` | Sin sesión | Sesión, perfil `pending`/`disabled`/`removed` | Sesión, perfil `active` |
|----------|-----------|-----------------------------------------------|-------------------------|
| `public` | ✔ | ✔ | ✔ |
| `guest-only` (auth) | ✔ | → `/pendiente` | → `/` (Inicio) |
| `pending` | → `/login` | ✔ | → `/` |
| `private` | → `/login?redirect=<ruta>` | → `/pendiente` | ✔ si `roles` incluye su rol; si no ⇒ `/acceso-denegado` |

Tras iniciar sesión se navega a `redirect` si es una ruta interna válida (empieza por `/`, no `//`), si no a `/`.

## Rutas

| Ruta | Página | Layout | access / roles | Historia |
|------|--------|--------|----------------|----------|
| `/login` | Iniciar sesión | `auth` | guest-only | US2, US6 |
| `/registro` | Registro | `auth` | guest-only | US2 |
| `/recuperar` | Recuperar contraseña | `auth` | guest-only | US2 |
| `/restablecer?token=` | Restablecer contraseña (token caducado ⇒ mensaje + enlace a `/recuperar`) | `auth` | public | US2, edge |
| `/pendiente` | Cuenta pendiente / desactivada | `auth` | pending | US2, US6 |
| `/enviar` | Página pública de invitados | `public` | public | US3 |
| `/` | Inicio (dashboard) | `dashboard` | private · editor, admin | US5 |
| `/archivos` y `/archivos/:folderId` | Explorador (raíz / carpeta) + búsqueda `?q=` | `dashboard` | private · editor, admin | US1 |
| `/archivos/ver/:fileId` | Detalle / vista previa + comentarios (también como panel lateral en escritorio) | `dashboard` | private · editor, admin | US1, US8 |
| `/pendientes` | Cola de envíos de invitados | `dashboard` | private · editor, admin | US3 |
| `/papelera` | Papelera | `dashboard` | private · editor, admin | US7 |
| `/usuarios` | Gestión de usuarios | `dashboard` | private · **admin** | US4 |
| `/actividad` | Registro de actividad | `dashboard` | private · **admin** | FR-023 |
| `/perfil` | Mi perfil (nombre, contraseña) | `dashboard` | private · editor, admin | FR-030 |
| `/acceso-denegado` | Acceso denegado | `dashboard` (o `auth` sin sesión) | public | US6 |
| _cualquier otra_ | `app/error.vue` — 404 "Página no encontrada" | — | — | US6 |

## Layouts

**`auth`** — tarjeta centrada (`card` daisyUI) sobre `base-200`, logo Cloudy, `ThemeToggle` en la esquina, ancho máx. 28 rem, padding seguro en 360 px.

**`public`** — cabecera mínima (logo + `ThemeToggle`), contenido centrado, sin navegación privada.

**`dashboard`** — daisyUI `drawer lg:drawer-open`:
- **Barra lateral** (`AppSidebar`): logo; ítems con ícono `lucide` y `NuxtLink` (`aria-current="page"` en el activo): Inicio `lucide:house`, Archivos `lucide:folder`, Pendientes `lucide:inbox` + `badge badge-primary` con contador en vivo, Papelera `lucide:trash-2`, Usuarios `lucide:users` (admin), Actividad `lucide:activity` (admin), Mi perfil `lucide:user`. Filtrado por rol desde una única definición `navItems` con `roles[]`.
- **Escritorio (≥ `lg`)**: fija; botón contraer → solo íconos con `tooltip`; estado en `useLocalStorage('cloudy-sidebar-collapsed')`.
- **Tableta/teléfono (< `lg`)**: panel deslizable; botón menú en la barra superior; se cierra al elegir sección (watch de `route.path`), al tocar fuera (`onClickOutside` / overlay del drawer) y con `Esc` (`onKeyStroke`); bloquea scroll (`useScrollLock`). Al pasar a ≥ `lg` (`useBreakpoints`) se cierra el estado móvil para no quedar atascado (edge case).
- **Barra superior** (`AppTopbar`): botón menú (< lg), búsqueda global (`/` la enfoca; navega a `/archivos?q=`), botón "Subir" (abre `UploadDialog` en la carpeta actual), `ThemeToggle`, menú de usuario (`dropdown`: Mi perfil, Cerrar sesión).
- **Contenido**: `main` con `id="contenido"` + enlace "Saltar al contenido" visible al enfocar.

## Componentes clave (contrato de props/eventos)

| Componente | Props | Emite | Notas |
|------------|-------|-------|-------|
| `ThemeToggle` | — | — | Cookie `cloudy-theme`; `aria-label="Cambiar a tema claro/oscuro"`, `aria-pressed` |
| `AppSidebar` | `collapsed: boolean`, `pendingCount: number` | `navigate` | roles desde `useMe()` |
| `UploadDialog` / `UploadQueue` | `folderId: string \| null`, `mode: 'team' \| 'guest'` | `uploaded(FileItem[])` | `useDropZone` + `useFileDialog`; progreso por archivo; reintento; validación previa (tipo, 100 MB) |
| `FileGrid` / `FileList` | `items`, `view: 'grid' \| 'list'` | `open`, `rename`, `move`, `trash` | miniaturas lazy; contador de comentarios |
| `FilePreview` | `file: FileItem` | — | imagen / `<audio>` / `<video>` (`useMediaControls`) / PDF en `<iframe>`; otros ⇒ ícono + descargar |
| `CommentThread` | `fileId` | — | sondeo cada 3 s mientras está montado y visible |
| `ConfirmDialog` | `title`, `message`, `confirmLabel`, `danger?` | `confirm`, `cancel` | `useConfirmDialog`; `<dialog>` nativo (`modal` daisyUI) con foco inicial en "Cancelar" |
| `FolderPicker` | `excludeId?` | `select(folderId \| null)` | usa `/api/folders/tree` |
| `EmptyState` | `icon`, `title`, `description`, acción opcional | — | FR-032 |
| `ErrorState` | `message`, `onRetry` | — | Estado de error con "Reintentar" (Constitución VI) |
| `SkeletonList` | `rows`, `variant` (`grid` o `list`) | — | Estado de carga |
| `AppToast` (composable `useToast()`) | — | — | `toast toast-end` daisyUI, `role="status"`, auto-ocultar `useTimeoutFn` |

## Reglas transversales (Constitución III y VI)

- **Objetivos táctiles**: con `--size-field: 0.28125rem` del tema, `btn` y `input` por defecto miden 45 px, lo que cumple ≥ 44 px. `btn-sm` (36 px) y `btn-xs` (27 px) **no se usan** como acción táctil en < `lg`; solo se permiten en escritorio con `lg:btn-sm`, nunca como base.
- **Cuatro estados**: toda vista con datos (`index`, `archivos/*`, `pendientes`, `papelera`, `usuarios`, `actividad`, `CommentThread`) renderiza:
  - `SkeletonList` mientras carga (`pending` de `useFetch`)
  - `EmptyState` con acción cuando no hay datos
  - un bloque de error con "Reintentar" (`refresh()`)
  - el contenido
- **Colores**: solo por clases semánticas de daisyUI (`bg-base-*`, `text-base-content`, `btn-primary`, `badge-warning`, …). `text-warning` **no** se usa sobre `base-100` en el tema claro, porque su contraste es de 1.85:1.
- **Clases mobile-first**: la clase base es el teléfono, y `sm:`/`md:`/`lg:` solo amplían. Ninguna acción se descubre solo con `hover` (los menús contextuales de archivo usan un botón `⋯` visible).
- **Movimiento**: las transiciones de drawer, toast y modal se desactivan con `prefers-reduced-motion`, ya cubierto en `globals.css`.

## Composables (`app/composables/`)

`useMe()` (perfil en `useState`, cargado en SSR con `useRequestFetch`), `useAuthClient()` (cliente Neon Auth), `usePulse()` (pendientes en vivo), `useUploader()` (presign → PUT con progreso → complete), `useTheme()`, `useToast()`, `useFileIcon(category)`, `useFormatBytes()`.
