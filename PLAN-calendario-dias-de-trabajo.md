# Plan: Calendario de días de trabajo (`/calendario`) con SVAR Vue Calendar

Change de OpenSpec: `calendario-dias-de-trabajo` (rama del mismo nombre). Capability nueva: `work-calendar`.
Artefactos de OpenSpec en inglés; la UI en español. Este plan reemplaza al anterior (Schedule-X).

## 1. Objetivo y alcance

Una página `/calendario` donde el equipo de Cloudy ve, y los **admins** agendan, sus días de trabajo.

- **Día normal**: lo habitual de la iglesia (miércoles y domingo suelen serlo).
- **Día especial**: la iglesia presta sus auditorios para un evento y Cloudy lo cubre.
- El equipo **categoriza cada día en un formulario**. No se asume nada por el día de la semana.

**Dentro**: tabla de días, formulario, calendario SVAR con tema propio, lista «Próximos días», estado del día,
miembros, material adjunto, tests y mejoras de carga.

**Fuera (YAGNI)**:
- Recurrencia, notas, rol por miembro, hora de llamado, avisos de choque de miembros (se pueden agregar después).
- Arrastrar o redimensionar en el calendario.
- Vistas Agenda, Year, Timeline, Resources, zonas horarias y carga dinámica: son **PRO** en SVAR y no se usan.
- Registro en `/actividad`.
- Adjuntar canciones o videos sueltos.
- Cualquier limpieza por cron (los días pasados quedan como historial).
- Ejecutar migraciones (las corre una persona).

## 2. Decisiones confirmadas

| Tema | Decisión |
|---|---|
| Estados del día | `Sin iniciar` / `En proceso` / `Finalizado` (`not_started`, `in_progress`, `finished`) |
| Permisos | Solo **admins** crean, editan, cambian estado, asignan miembros, adjuntan material y borran. Los **editores solo ven** (calendario, lista y detalle). |
| Tipo de día | Campo **obligatorio y sin valor inicial** (Normal / Especial). Si la fecha cae en miércoles o domingo se muestra una pista («Los miércoles y domingos suelen ser días normales»). Nada se guarda por suposición. |
| Campos extra | Solo **Título del evento** (obligatorio, 1–120 car.). Es el texto que se ve en el calendario. |
| Material | Referencias (no copias) a: **colecciones de canciones**, **listas de YouTube** y **carpetas del drive**. |
| Auditorio | **Uno por día**, texto libre 1–80 car., valor inicial `Skykids Auditorium`. |
| Rangos de hora | De 1 a 6 rangos por día, dentro del mismo día, sin solaparse, inicio < fin. |
| Miembros | Admins y editores activos; 0 a 30 por día. |

## 3. Componente de calendario: SVAR Vue Calendar

Repo: https://github.com/svar-widgets/vue-calendar. Docs: https://docs.svar.dev/vue/calendar/.
Verificado en npm y en la documentación (2026-11-18).

### Por qué encaja

- Es un calendario de **eventos** (no un selector de fechas), licencia **MIT**, edición abierta con vistas día, semana y mes.
- Solo depende de `vue ^3`, sin runtime extra como Preact ni polyfills de fechas.
- Usa `Date` nativo de JS. Nuestras horas son «de pared» (sin zona) y se ven igual para todo el equipo.
- Trae idioma `es`, inicio de semana configurable, modo móvil compacto (< 480 px) y tema por variables CSS `--wx-*`.

### Límites y riesgos que se aceptan

- **Proyecto joven**: creado en mayo de 2026, 39 estrellas, 0 dependientes. Se mitiga fijando versiones exactas y
  aislando todo `@svar-ui/*` en **un solo componente** (`WorkCalendar.vue`), reforzado con una regla en `architecture.spec.ts`.
- **Sin vista Agenda ni carga dinámica** (son PRO): se pagan con la lista «Próximos días» (sección 7) y con la carga por rango propia.
- **`Willow` no es opcional**: sin él el calendario no tiene variables ni iconos. Se usa y se sobrescribe (sección 4).
- **Solo lectura**: con `readonly` se desactivan arrastrar, redimensionar, crear y el botón «agregar». Esa decisión es deliberada,
  porque un día tiene varios rangos y mover uno cambiaría la fecha del día. Los cambios van por nuestro formulario.
- **No se monta `Editor` ni `ContextMenu`**: menos JS y un solo camino de edición.

### Dependencias nuevas (justificación para `design.md`)

```bash
bun add @svar-ui/vue-calendar@2.7.1 @svar-ui/vue-core@2.6.1 @svar-ui/calendar-locales@2.7.0 @svar-ui/core-locales@2.6.1
```

| Paquete | Para qué |
|---|---|
| `@svar-ui/vue-calendar@2.7.1` | El calendario (`Calendar`, `Willow`) |
| `@svar-ui/vue-core@2.6.1` | `Locale` (idioma) |
| `@svar-ui/calendar-locales@2.7.0`, `@svar-ui/core-locales@2.6.1` | Textos en español |

- Los tres últimos ya llegan como dependencias transitivas de `vue-calendar`; se declaran explícitos porque se importan directamente.
- **Versiones exactas, sin `^`, iguales a las que fija `vue-calendar@2.7.1`.** El `latest` de `vue-core` es 2.6.2: si se instala ese,
  habría dos copias.
- **Alternativa descartada**: Schedule-X. Necesitaba `preact`, `@preact/signals` y `temporal-polyfill@0.3.2` (más peso y dependencias) y
  su CSS usa un sistema de variables propio.
- El `@schedule-x/date-picker` que quedó en `node_modules` **no está** en `package.json` ni en `bun.lock`: no se usa.

## 4. Tema CSS «Cloudy» para SVAR

Archivo nuevo: `app/assets/css/svar-calendar-cloudy.css`.
**No** va en `css: [...]` de `nuxt.config.ts`: se importa dentro de `WorkCalendar.vue`, así viaja solo en el chunk de `/calendario`.
Orden de los imports: primero `@svar-ui/vue-calendar/all.css`, luego el tema Cloudy.

### Cómo se aplica

- Se renderiza `<Willow :fonts="false">` (ya tenemos DM Sans; evita pedir Roboto) dentro de un contenedor `.cloudy-calendar`.
- Willow define sus variables en el propio elemento `.wx-willow-theme`, así que **no basta con sobrescribirlas en el contenedor**:
  el selector es `.cloudy-calendar .wx-willow-theme { … }` (dos selectores, como recomienda SVAR para ganar a su CSS).
- **Un solo tema para claro y oscuro**: cada variable `--wx-*` apunta a un token de daisyUI (`var(--color-*)`). Esos tokens ya cambian
  con `data-theme="cloudy" | "cloudy-light"`, así que no se usa `WillowDark` ni lógica en JS.

### Mapa de variables (base → token Cloudy)

| Variable SVAR | Valor |
|---|---|
| `--wx-color-primary` / `--wx-color-primary-font` | `var(--color-primary)` / `var(--color-primary-content)` |
| `--wx-color-primary-selected` | `color-mix(in oklab, var(--color-primary) 18%, var(--color-base-100))` |
| `--wx-color-secondary`, `-hover`, `-font`, `-border` | transparente, `color-mix(primary 12%)`, `var(--color-primary)`, `var(--color-primary)` |
| `--wx-color-success` / `warning` / `info` / `danger` | `var(--color-success)` / `warning` / `info` / `error` |
| `--wx-color-font` | `var(--color-base-content)` |
| `--wx-color-font-alt` | `color-mix(in oklab, var(--color-base-content) 70%, transparent)` (≥ 4.5:1) |
| `--wx-color-font-disabled` | `color-mix(in oklab, var(--color-base-content) 40%, transparent)` |
| `--wx-color-link` | `var(--color-primary)` |
| `--wx-background` / `-alt` / `-hover` | `base-100` / `base-200` / `base-300` |
| `--wx-color-disabled` / `-alt` | `base-200` / `base-300` |
| `--wx-font-family` | `var(--font-sans)` (DM Sans) |
| `--wx-font-size`, `--wx-font-weight-md` | 14px, 600 |
| `--wx-border` | `1px solid var(--color-base-300)`; `--wx-border-medium` igual |
| `--wx-border-radius` / `--wx-radius-major` | `0.5rem` / `var(--radius-box)` |
| `--wx-icon-color` | igual que `font-alt` |
| `--wx-shadow-light` / `medium` | sombras suaves (el tema Cloudy es plano, `--depth: 0`) |
| `--wx-calendar-grid-color` | `var(--color-base-300)` |
| `--wx-calendar-weekend-background` | **`transparent`** (el domingo es día normal de trabajo y no se debe sugerir que el fin de semana es «especial») |
| `--wx-calendar-y-scale-width` | 56px |

### Colores de eventos (tipo y estado)

- `eventCss` devuelve las clases `cloudy-ev cloudy-ev--normal | cloudy-ev--special` y `is-in-progress | is-finished`.
- **Normal** → tinte de `secondary` (cian); **Especial** → tinte de `primary` (naranja de marca, llama la atención).
  Fondo = `color-mix(<token> 20%, var(--color-base-100))`, texto `base-content`, franja izquierda de 4 px del token.
- `is-finished` baja la opacidad; `is-in-progress` marca un punto de estado.
- Selectores con dos clases (por ejemplo `.cloudy-calendar .cloudy-ev--special.wx-box-event`) y, solo si hace falta, `!important`.
- **Color nunca es la única señal** (WCAG 1.4.1): `WorkCalendarEvent.vue` (el `eventContent` personalizado) muestra el título, el horario, un icono lucide
  y el texto «Especial» / «En proceso» / «Finalizado». Cada evento es un `<button>` enfocable.
- Mínimo 44 px de alto táctil en botones de la barra del calendario (`.cloudy-calendar` sobre sus clases `.wx-*`).
- `prefers-reduced-motion` respetado (ya hay una regla global).
- Contraste AA verificado en **ambos** temas: texto del evento sobre su tinte, hoy, fines de semana, hover y foco.

### Idioma

- `Locale` con `{ ...coreEs, ...calendarEs, calendar: { weekStart: 0 }, eventCalendar: { ...calendarEs.eventCalendar, … } }`
  (inicio de semana en domingo, hora de 24 h: se verifica en el spike).

## 5. Datos (migración `0015`, la corre una persona)

Todo el SQL en `server/utils/work-days.ts` y `server/utils/work-day-materials.ts`; los endpoints no tocan drizzle.

| Tabla | Columnas clave |
|---|---|
| `work_days` | `id`, `title` (1–120), `work_date date`, `kind` enum `normal\|special` **sin default**, `status` enum default `not_started`, `auditorium` (1–80, default `'Skykids Auditorium'`), `created_by` → `profiles`, `created_at`, `updated_at`. Índice `(work_date, id)`. |
| `work_day_slots` | `id`, `work_day_id` (cascade), `start_time time`, `end_time time`, check `end_time > start_time`. Índice por día. |
| `work_day_members` | PK `(work_day_id, user_id)`, `user_id` → `profiles`, cascade por día. Índice por `user_id`. |
| `work_day_materials` | `id`, `work_day_id` (cascade), `song_collection_id`, `youtube_playlist_id`, `folder_id` (tres FK nulables con cascade), check «exactamente una no nula», `added_by`, `added_at`. Índice único parcial por tipo y día. |

- Cascadas: borrar un día borra sus rangos, miembros y adjuntos. Borrar una colección, lista o carpeta (purga) elimina el adjunto.
  Una carpeta en la papelera (`deleted_at`) se oculta en lectura.
- Los rangos de un día se validan también en el servidor: 1–6, sin solaparse, mismo día.
- Un miembro `disabled` o `removed` se muestra como «Persona inactiva» (patrón de `toSongPerson`) y no se ofrece al elegir.

## 6. API (todo valida con zod y llama al guard de rol)

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /api/calendario?from&to` | editor+ | Días del rango (≤ 62 días) con rangos, miembros (nombre) y cantidad de adjuntos. Una sola `db.batch` de 3 consultas, sin N+1. |
| `GET /api/calendario/:id` | editor+ | Detalle con el material **resuelto** (nombres y hasta 50 elementos por adjunto, por consultas agrupadas por tipo). |
| `POST /api/calendario` | admin | Crea día + rangos + miembros + adjuntos en una `db.batch`. 404/409 si un miembro o adjunto ya no existe. |
| `PATCH /api/calendario/:id` | admin | Reemplaza los datos del día (rangos, miembros y adjuntos) en una `db.batch`. |
| `PATCH /api/calendario/:id/estado` | admin | Cambia solo el estado (un toque desde la tarjeta o el detalle). |
| `DELETE /api/calendario/:id` | admin | Borra el día (con `ConfirmDialog` en la UI). |
| `GET /api/calendario/miembros` | admin | Miembros activos (`id`, `name`, `role`) para el selector. |

- `shared/permissions.ts`: acción nueva `calendar.manage` solo de admin (se suma a `ADMIN_ONLY`).
- Los selectores de material **reutilizan** `GET /api/songs/collections`, `GET /api/youtube/playlists` y `GET /api/folders/tree`.
  Se cargan al abrir cada pestaña, no con el formulario.
- Enlaces del detalle (sin tocar otras páginas): colección → sus canciones a `/canciones/<songId>`; lista → `/youtube/<videoId>`;
  carpeta → `/archivos/<folderId>`.
- `shared/`: `constants/calendar.ts` (`DEFAULT_AUDITORIUM`, límites), `validation/calendar.ts` (esquemas, `usualWorkDay(date)`,
  `validateSlots`), tipos en `types/api.ts`.

## 7. Interfaz

- Ruta `/calendario`, `definePageMeta({ layout: 'dashboard', access: 'private', roles: ['editor','admin'] })`.
- Item de menú «Calendario» (`lucide:calendar-days`) en `app/utils/navigation.ts`.
- Título de página, botón **«Agendar día»** (solo admin) y estados de 4 formas (carga, vacío, error con reintento, contenido) en todos los datos.

**Componentes** (`app/components/calendar/`):

| Componente | Función |
|---|---|
| `UpcomingWorkDays.vue` | Lista «Próximos días» (30 días). Va en el **SSR** y es la lectura rápida en móvil. Admin: cambia el estado con un toque. Es la alternativa accesible al calendario. |
| `WorkCalendar.vue` | **Única frontera con `@svar-ui/*`**. `Willow` + `Locale` + `Calendar`, importa el CSS. |
| `WorkCalendarEvent.vue` | `eventContent` personalizado. |
| `WorkDayDetailDialog.vue` | Detalle de solo lectura para todos; admin ve «Editar», «Eliminar» y el cambio de estado. |
| `WorkDayDialog.vue` | Formulario (solo admin). |

**Formulario** (`useFormSchema`, esquema zod en `app/utils/form-schemas.ts`; la paridad con `shared/validation` la comprueba `form-schemas.spec.ts`):

1. Título · 2. Fecha · 3. Tipo (radios, **sin selección inicial**, pista de miércoles/domingo en una región `role="status"`) ·
4. Rangos de hora (repetidor: añadir y quitar, `type="time"`, errores de solape por fila, máx. 6) ·
5. Auditorio (valor inicial «Skykids Auditorium») · 6. Estado (valor inicial «Sin iniciar») ·
7. Miembros (lista de casillas con filtro) · 8. Material (pestañas Canciones / YouTube / Carpetas, insignias quitables).

- Aviso antes de cerrar con cambios sin guardar (`useConfirm`); el diálogo no se cierra mientras guarda; toast al terminar.
- Textos en `app/utils/messages.ts`; errores solo con `serverMessage()`.
- Móvil primero: controles ≥ 44 px, sin `btn-sm` como base, sin scroll horizontal a 360 px.

**Calendario**:

- Un evento por rango: `id = slotId`, `text = título`, campos propios `workDayId`, `kind`, `status`, `auditorium`. Fechas como `Date` local.
- Vistas `day`, `week`, `month`. Por defecto `month` desde 640 px y `day` por debajo (se decide al montar, es solo cliente).
- Clic en un evento → abre `LazyWorkDayDetailDialog` (vía `inject`/`provide` desde `WorkCalendarEvent`).
- Se crea desde el botón «Agendar día», con la fecha del calendario ya puesta.

## 8. Rendimiento y carga perezosa

- `WorkCalendar` entra como `<LazyWorkCalendar>` dentro de `<ClientOnly>` con un esqueleto de **la misma altura** (sin CLS). SVAR, su CSS y su
  tema viajan en un chunk aparte que solo carga `/calendario`, después de hidratar.
- `LazyWorkDayDialog` y `LazyWorkDayDetailDialog` van tras `v-if`, y la lista de material se pide al abrir la pestaña.
- **Carga por rango propia** (SVAR PRO es quien trae la carga dinámica): se piden meses completos, se cachean por clave de mes en `useState` y se
  precarga el mes siguiente y el anterior. Navegar a un mes ya visto es instantáneo.
- Índice `(work_date, id)`; paginación no necesaria (rango ≤ 62 días).
- Presupuesto: la ruta mantiene ≤ 250 KB gzip de JS inicial; `bun run analyze` mide el chunk del calendario y se reporta el tamaño.
  `performance.spec.ts` suma `/calendario` (LCP del texto de la lista, CLS, JS inicial).

## 9. Spike inicial (primer grupo de tareas, antes de construir)

Verificar en el SVAR instalado, y ajustar el plan si algo difiere:

1. Con `:fonts="false"`, ¿se siguen viendo los iconos de la barra? Si no, importar el CSS de iconos explícitamente.
2. ¿Qué campo de `api.getState()` expone la fecha o el rango visible tras `navigate-time` y `navigate-to`?
3. ¿Dispara `select-event` con `readonly`? Si no, queda el `<button>` dentro de `eventContent`.
4. ¿Renderiza en SSR? Si no, `<ClientOnly>` (ya previsto).
5. Claves exactas del idioma `es` (formatos de hora de 24 h, `weekStart`).
6. Clases `.wx-*` reales para los 44 px y el foco, y tamaño del chunk.

## 10. Pruebas

**Unit** (`test/unit`):
- Esquemas y `validateSlots` (solapes, orden, máximos), `usualWorkDay`, mapeo evento ↔ rango (`app/utils/work-calendar.ts`, función pura).
- Permisos (`calendar.manage`), guardas de endpoints (editor 403, sin sesión 401), todos los endpoints con `fake-db`
  (crear, editar, estado, borrar, material faltante, miembro inactivo).
- `messages.spec.ts`.
- `architecture.spec.ts`: solo `WorkCalendar.vue` importa `@svar-ui/*`; el SQL de `work_*` solo en sus dos utils; los endpoints de calendario no tocan drizzle.
- `endpoint-guards.spec.ts` y `route-access.spec.ts` (ruta nueva).

**Nuxt** (`test/nuxt`): formulario (tipo obligatorio sin preselección, pista miércoles/domingo, repetidor de rangos, auditorio por defecto,
aviso de cambios), `form-schemas.spec.ts`, página `/calendario` por rol y sus 4 estados, `UpcomingWorkDays`. Con SVAR **simulado**
(happy-dom no reemplaza a Chromium).

**E2E** (`test/e2e/calendar.spec.ts`, rama de pruebas, datos con `runId`):
- Admin crea un día especial con 2 rangos, miembros y material; edita; cambia el estado; lo borra.
- El editor ve el calendario y el detalle pero no «Agendar día», y la API responde 403.
- Sin sesión redirige a login; un invitado no accede.
- A 360 px: sin scroll horizontal y con controles táctiles ≥ 44 px.
- Los eventos de tipo normal y especial se distinguen en **ambos temas** (contraste por estilos calculados).
- Un material cuya colección se borró ya no aparece.

**Gate**: `bun run typecheck`, `test:unit`, `test:nuxt`, `test:e2e`, `test:coverage` ≥ 92 % por grupo.

## 11. Tareas (grupos con su verificación, por `AGENTS.md`)

1. **Spike y dependencias**: instalar los 4 paquetes (la persona), comprobar los 6 puntos de la sección 9 y cerrar el change de OpenSpec (proposal, design, tasks, specs).
2. **Datos**: schema, migración `0015` (**la corre una persona** en dev, test y prod) y utils de SQL.
3. **API y permisos**: los 7 endpoints, validación compartida y tests de servidor.
4. **Tema y calendario**: `svar-calendar-cloudy.css`, `WorkCalendar`, `WorkCalendarEvent` y la carga por rango.
5. **Formulario y detalle**: `WorkDayDialog`, `WorkDayDetailDialog` y selectores de material.
6. **Página, lista y menú**: `/calendario`, `UpcomingWorkDays` y navegación.
7. **E2E, rendimiento y documentación**: e2e, `performance.spec.ts` y actualizar `AGENTS.md` (áreas, stack, gotchas).

Cada grupo termina con typecheck, tests y **verificación en navegador** a 360 px y ≥ 1280 px, en tema oscuro y claro, comprobando
cargando/vacío/error/contenido, foco por teclado y errores de consola (solo datos de `.env.development`).

## 12. Supuestos

- Semana inicia en domingo; hora en 24 h; las horas son de pared y no llevan zona.
- Un día admite varios rangos pero un solo auditorio.
- Se permite agendar fechas pasadas.
- Los admins son los únicos que cambian el estado del día.
- Los textos libres (título, auditorio) se muestran como texto plano, nunca `v-html`.
