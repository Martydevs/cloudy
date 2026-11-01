---

description: "Task list for Cloudy — Actualización en vivo sin sondeo (feature 004)"
---

# Tasks: Actualización en vivo sin sondeo

**Input**: Documentos de diseño en `specs/004-neon-realtime/`

**Prerequisites**: plan.md, spec.md, research.md (C1–C18), data-model.md, contracts/api.md, contracts/ui.md, quickstart.md · Constitución v1.1.0 · Base: features 001, 002 y 003 (la rama parte de la punta de `003-public-photos-upload`) · Plan de origen: `neon-realtime-migration-plan.md`

**Tests**: **Requeridos** por la Constitución V y por la barra ≥ 90 % de la persona responsable. Cada historia tiene tests unitarios (`test/unit`), de componente (`test/nuxt`) **y e2e** (`test/e2e`); dentro de cada historia se escriben antes que la implementación y deben fallar primero. Cada archivo **nuevo** debe llegar a ≥ 90 % en cada métrica por sí solo; el umbral del proyecto (92 %) no se baja. Las pruebas del pulso se **portan**, no se descartan.

**Organization**: Las tareas se agrupan por historia de usuario en orden de prioridad (US1 P1 → US2 P2 → US3 P3) y **cada historia se puede desplegar sola** una vez terminadas las anteriores (Constitución II). US1 es el MVP: el equipo ve solicitudes, envíos y cuentas en vivo. US2 lleva lo mismo al invitado. US3 lo lleva al hilo de comentarios y a la lectura de imágenes. Lo común (puerta de entrada al servicio, sesión, cliente, composable y copy) es fundacional. **Los constructores de consultas y las rutas de sellado de cada vista se implementan en la historia que las usa** (no todos en la fundación) para que cada historia sea desplegable por separado; la eliminación del sondeo es la fase de Polish, porque hasta US3 todavía hay consumidores del sondeo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede ejecutar en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: la historia de usuario de spec.md a la que pertenece la tarea (US1…US3).
- Los números de tarea **empiezan en T001** (como 002 y 003). El plan de migración citaba T063 (spike) y T072 (medición) suponiendo numeración continua; aquí son **T003** y **T074**.

## Convenciones obligatorias para quien implemente (de AGENTS.md, la constitución y el plan)

- **Frontera única** (Constitución IV): `@neon/realtime/server` solo se importa en `server/utils/realtime.ts`, y `@neon/realtime/client` solo en `app/utils/realtime-client.ts`, con `import()` dinámico (fuera del chunk de entrada, presupuesto 250 KB). `test/unit/architecture.spec.ts` lo hace cumplir (T065).
- **Rutas de sellado**: todas `POST`, validan su entrada con `shared/validation`, leen **solo la sesión** (`requireSessionUser`, sin `ensureProfile`) y **no llaman a `useDb()`** (prueba obligatoria en cada una). El permiso solo viaja en cuerpos de respuesta (`Cache-Control: no-store`), nunca en URL, registros, `localStorage`, `sessionStorage` ni `useState` (payload SSR).
- **Autorización dentro del SQL**: cada consulta lleva `$1` = id de la sesión y la guarda `EXISTS (SELECT 1 FROM profiles me WHERE me.user_id = $1 AND me.status = 'active' AND me.role IN (…))`, con los roles generados por `rolesAllowed(action)` de `shared/permissions.ts` (no escritos a mano). Un no-administrador recibe 0 filas de cuentas pendientes.
- **Consultas deterministas**: `rawSql` con `$n`, una sola sentencia `SELECT`, **sin `;`**, **sin `now()`** ni funciones no deterministas; parámetros con cast (`$2::uuid`), conteos con `::int`, `LIMIT` fijo (data-model). La vigencia se filtra en el navegador con `skew` (`serverTime − Date.now()`), con funciones puras de `shared/` (`accessStateOf`, `imageTextOf`). Nunca se selecciona `token_hash`.
- **Una sola definición** de "envío listo por revisar": el fragmento SQL de `readyPendingSubmissionsSql` es una constante compartida entre el REST y la consulta en vivo (research C13).
- **Identidad de sesión**: cada renovación envía `expectedUserId` (de `useMe().profile.userId`); 401 o 409 → recarga completa **una sola vez** (marca de módulo). Nunca se mezclan datos de dos personas.
- **Avisos**: por diferencia de conjuntos de ids; el primer resultado no avisa; `announced` a nivel de módulo.
- **Interfaz**: textos en español en `app/utils/messages.ts` (bloque `live`); errores HTTP solo con `serverMessage()`; clases semánticas de daisyUI; iconos `lucide:*`; `btn` base (como máximo `lg:btn-sm`); cuatro estados (`SkeletonList`, `EmptyState`, `ErrorState`, contenido); sin `text-warning` sobre `base-100` en el tema claro.
- **Tests**: seleccionan con `getByRole`/`getByLabel`. Los e2e pasan por `signedInAs`/`ensureAccount`/`login` de `test/e2e/setup/fixtures.ts` (nunca llaman a la API de auth directo) y corren contra la rama de pruebas con su configuración de datos en vivo; identidades y claves de almacenamiento únicas por corrida (`e2e/<runId>/`). Los tests de componente usan el cliente falso de `test/nuxt/helpers/fake-realtime.ts`; ningún test llama al servicio real salvo el e2e.
- **Agentes** (AGENTS.md, "No destructive actions" y "Notes"): nada destructivo contra ninguna base ni bucket. **Se pide permiso a la persona antes de** cualquier comando MCP de base de datos, de `neon realtime enable …` (cambia y **reemplaza** la lista de orígenes) y de cualquier cambio de secretos o variables de Vercel. No hay migraciones en esta feature: si `bun run db:generate` produce un archivo, detenerse.
- **Definición de hecho por tarea y por fase**: la de AGENTS.md ("Workflow"): `bun run typecheck` → tests que cubren el cambio (`test:unit`, `test:nuxt`, y `test:e2e` si toca una historia o ruta protegida; al final de la fase, el conjunto completo más `test:coverage`) → **verificación en navegador al final** (skill `agent-browser`, `bun run dev`, `.env.development`, 360 px y ≥ 1280 px, temas oscuro y claro, cuatro estados, foco y consola) → **reporte** de lo que corrió y su resultado antes de marcar la tarea. Un paso omitido se declara con su motivo.

---

## Phase 1: Setup & puerta G1 (Shared Infrastructure)

**Purpose**: Comprobar el punto de partida, instalar la única dependencia nueva y **demostrar antes de construir** que la feature cumple su razón de ser (que la base de datos pueda dormir). Nada de código de producción hasta pasar T004.

- [ ] T001 Confirmar que la rama activa es `004-neon-realtime` (`git branch --show-current`), que `git merge-base --is-ancestor 003-public-photos-upload HEAD` se cumple y que `.specify/feature.json` apunta a `specs/004-neon-realtime`. Si no, detenerse y pedir a la persona que cree o cambie de rama; el agente no crea ni cambia de rama. Confirmar que `bun run db:generate` no tiene nada que generar (sin cambios de esquema).
- [ ] T002 Instalar `@neon/realtime` **con versión exacta** (`bun add --exact @neon/realtime`; sin `^`/`~`) y comprobar que `package.json` y `bun.lock` la fijan. Es la única dependencia nueva (research C17): no instalar `@neon/realtime-drizzle` ni `@neon/realtime-react`. Verificar que `bun run typecheck` sigue pasando. La fila de Complexity Tracking ya está en `plan.md`.
- [ ] T003 **Spike** (solo lectura contra la rama `development`; pedir permiso para cualquier comando MCP o `neon`): con `neon realtime subscribe "<sql>" --branch development`, ejecutar **cada una** de las consultas de `data-model.md` (equipo ×3, invitado, comentarios, texto de archivo y de envío) y confirmar que son válidas (una sentencia, sin `;`, sin `now()`, con casts). Confirmar y anotar en `research.md`, nueva sección "Resultados del spike y de la puerta G1": (a) el esquema de URL que acepta el cliente (`https` → `wss` solo si lo exige); (b) la vigencia real del permiso (≈ 60 s) y el momento de renovación; (c) cómo llegan las fechas y los enteros (`parsers`, `timestamptz` como texto ISO, `int8` como texto) para igualar el SSR; (d) el nombre exacto de los tipos del cliente (`SealedLiveQuery`) para `RealtimeSeal`; (e) que `GROUP BY s.id` y los `LEFT JOIN` son admitidos; (f) que `realtime.seal()` es **local**: con un espía de red (`fetch`, `http`/`undici`) activo durante un sellado no sale ninguna petición (FR-017, G1 y el modelo de costo lo suponen, y las pruebas de "sin `useDb`" no ven una llamada hecha dentro del SDK). Si una consulta no es admitida, ajustar `data-model.md` antes de seguir.
- [ ] T004 **Puerta G1 (go/no-go)** (research C2, C16; `quickstart.md` §4). Pedir permiso a la persona y medir en solo lectura sobre `development`: (1) con una suscripción `neon realtime subscribe` abierta **> 10 min**, confirmar con `list_branch_computes`/`get_postgres_endpoint` que el cómputo **se suspende**; (2) con `bun run dev` y una sesión real, esperar a que caduque la caché de sesión de 5 min (`session_data`), provocar `GET /api/auth/get-session` y comprobar si **despierta** el cómputo. Anotar ambos resultados con sus números en `research.md`. **Si cualquiera falla, DETENERSE y preguntar a la persona** cuál de las opciones de research C2 (a–d) se sigue; no continuar con la Fase 2 sin su decisión.

**Checkpoint**: rama confirmada, dependencia fijada, SDK verificado y G1 aprobada (o decisión de la persona registrada).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: La puerta de entrada al servicio, la sesión que no toca la base, el cliente perezoso y el composable de suscripciones con renovación. Ninguna historia empieza antes de terminar esta fase. Sin interfaz visible nueva: la verificación en navegador no aplica (se declara en el reporte).

### Tests fundacionales (escribir primero, deben fallar)

- [ ] T005 [P] Tests unitarios de `rolesAllowed` en `test/unit/permissions.spec.ts`: `rolesAllowed('submissions.review')` = `['admin', 'editor']`; `rolesAllowed('users.manage')` = `['admin']`; `rolesAllowed('content.read')` = `['admin', 'editor']`; para **cada** `Action` y cada `Role` (`admin`, `editor`), `rolesAllowed(action).includes(role) === can(role, action)` (tabla de verdad completa); el resultado es estable (orden fijo) para poder armar el SQL.
- [ ] T006 [P] Tests unitarios de `shared/validation/realtime.ts` en `test/unit/validation-realtime.spec.ts`: `sealInput` acepta `{ expectedUserId }` de 1 a 200 caracteres y rechaza vacío, 201 caracteres, ausencia del campo y cualquier campo extra.
- [ ] T007 [P] Tests unitarios de `server/utils/realtime.ts` en `test/unit/realtime.spec.ts` (con el SDK simulado): el cliente se crea de forma perezosa **una sola vez** (`createRealtime` se llama una vez en dos `sealAll`); toma `db` del nombre de la base en el `pathname` de `NUXT_DATABASE_URL`; `debugMode` es `true` solo con `import.meta.dev` y `false` en producción; `sealAll({ a: q1, b: q2 })` devuelve `{ url, serverTime, expiresAt, queries: { a, b } }` con `url` de `runtimeConfig.neonRealtimeUrl`, `serverTime` ISO y `expiresAt` = `serverTime` + la vigencia del SDK; sin `neonRealtimeSecret` o sin `neonRealtimeUrl` lanza 503 con el mensaje de `api.md`; el secreto nunca aparece en el resultado ni en un mensaje de error.
- [ ] T008 [P] Tests unitarios de la sesión en `test/unit/server-session.spec.ts` (ampliar): `requireSameUser(event, expectedUserId)` devuelve el usuario si coincide y lanza **409** `data: { reason: 'session-changed' }` si no, y 401 sin sesión; el middleware deja `event.context.sessionUser` (sin `ensureProfile` ni `useDb`) para cualquier ruta `/api/realtime/**` y sigue omitiendo `/api/public/`, `/api/auth/` y `/api/cron/`.
- [ ] T009 [P] Crear el cliente falso `test/nuxt/helpers/fake-realtime.ts`: simula `@neon/realtime/client` (`createRealtimeClient`, `subscribe`, `getSnapshot`, `onChange`, `onStateChange`) con control manual de resultados, estados, errores de conexión y vencimientos de permiso, y registra cuántos clientes y suscripciones se crearon.
- [ ] T010 [P] Tests de componente de `useLiveQueries` y `app/utils/realtime-client.ts` en `test/nuxt/useLiveQueries.spec.ts` (con el cliente falso y relojes simulados): renueva **10 s antes** del vencimiento y reintenta cada **1 s** (≤ 10 intentos); **no renueva** con la pestaña oculta ni sin conexión (`status = 'stale'`) y renueva **de inmediato** al volver; un **401** y un **409** en la renovación recargan la página **exactamente una vez** (aunque lleguen dos); tras `error`, `retry()` vuelve a sellar y suscribe, y crea un **cliente nuevo** si falló la conexión; calcula `skew` de `serverTime`; `onScopeDispose` cancela suscripciones y temporizadores; `enabled = false` cancela; en SSR no llama al SDK; el permiso no queda en `localStorage`, `sessionStorage`, URL ni `useState`; **cambiar `key`** cancela la suscripción y los temporizadores, limpia `rows`, vuelve a `connecting` y sella de nuevo con los parámetros nuevos, y una renovación en vuelo de la clave anterior **no** se aplica a la nueva.

### Implementación fundacional

- [ ] T011 [P] Añadir `rolesAllowed(action: Action): Role[]` a `shared/permissions.ts`: los roles con `can(role, action) === true`, en orden fijo (`admin`, `editor`).
- [ ] T012 [P] Crear `shared/validation/realtime.ts` con `sealInput = object({ expectedUserId })` (texto de 1 a 200 caracteres, sin campos extra) usando los ayudantes de `shared/validation/core.ts`.
- [ ] T013 [P] Ampliar `shared/types/api.ts` (data-model, "Tipos compartidos"): `LiveStatus = 'connecting' | 'live' | 'stale' | 'error'`, `RealtimeSeal<K extends string>` (`url`, `serverTime`, `expiresAt`, `queries: Record<K, SealedQuery>`) y las filas `LiveSubmissionRow`, `LiveAccessRequestRow`, `LivePendingUserRow`, `LiveGuestAccessRow`, `LiveCommentRow`, `LiveImageTextRow` con los campos de data-model. El tipo `Pulse` **se queda** hasta Polish.
- [ ] T014 Crear `server/utils/realtime.ts` (research C4, C7; contracts/api.md): **única** frontera con `@neon/realtime/server`. `createRealtime({ secret, db, debugMode })` perezoso (una sola instancia), con `db` tomado del `pathname` de `NUXT_DATABASE_URL`, `debugMode` solo en `import.meta.dev`; exporta `sealAll(record)` → `{ url, serverTime, expiresAt, queries }` y re-exporta `rawSql`. Sin `neonRealtimeSecret`/`neonRealtimeUrl` lanza 503 `El servicio en vivo no está disponible. Intenta de nuevo en un momento`. Nunca registra el secreto ni el cuerpo sellado.
- [ ] T015 En `server/utils/session.ts`, añadir `requireSameUser(event, expectedUserId)`: usa `requireSessionUser` y lanza **409** con `data: { reason: 'session-changed' }` y mensaje "Tu sesión cambió. Recarga la página" si `expectedUserId` no es el id de la sesión. No toca `profileQuery` ni `attachProfile` todavía (el pulso sigue vivo hasta Polish).
- [ ] T016 En `server/middleware/session.ts`, generalizar `DEFERRED_PROFILE` de `['/api/realtime/pulse']` a `['/api/realtime/']` y actualizar su comentario (el sellado es local; el perfil lo evalúa el SQL). Depende de T008.
- [ ] T017 Crear `app/utils/realtime-client.ts` (research C7): cliente **único por aplicación**, creado de forma perezosa con `await import('@neon/realtime/client')` (nunca un `import` estático); `getRealtimeClient(url)` devuelve el mismo cliente mientras no haya error de conexión y `resetRealtimeClient()` lo descarta para que el siguiente `get` cree uno nuevo; aplica los `parsers` y el esquema de URL confirmados en T003. Solo en el cliente.
- [ ] T018 Crear `app/composables/useLiveQueries.ts` (contracts/ui.md): `useLiveQueries(sealFn, { enabled })` con el calendario de renovación (10 s antes, 1 s de reintento, pausa por `useDocumentVisibility`/`useOnline`, reanudación inmediata), `status`, `skew` (en `useState` compartido, clave `live-clock-skew`), `rows` por clave (`shallowRef`), `retry()`, la opción `key` (al cambiar, cancela, limpia y vuelve a sellar: una suscripción nunca recibe parámetros nuevos por renovación), marca de módulo para la recarga única ante 401/409 y `onScopeDispose`. El permiso vive solo en memoria. Depende de T013, T017.
- [ ] T019 [P] Añadir el bloque `live` a `app/utils/messages.ts` (`stopped`, `retry`, `unavailable`, `reconnected`, con los textos de contracts/ui.md) y ampliar `test/unit/messages.spec.ts` para comprobarlos.
- [ ] T020 **Checkpoint de la fase 2** (definición de hecho): `bun run typecheck`, `bun run test:unit`, `bun run test:nuxt`; informar la cobertura por archivo de `server/utils/realtime.ts`, `app/utils/realtime-client.ts`, `app/composables/useLiveQueries.ts` y `shared/validation/realtime.ts` (**≥ 90 % por métrica**). Verificación en navegador y e2e: **omitidas, declarándolo** (sin pantalla ni ruta nueva todavía); el spike de T003 ya validó el SDK real.

**Checkpoint**: fundación lista; las historias pueden empezar.

---

## Phase 3: User Story 1 — El equipo ve las solicitudes y los envíos en vivo (Priority: P1) 🎯 MVP

**Goal**: Administradores y editores ven en < 2 s los avisos, el contador y las listas de solicitudes de acceso, envíos y cuentas pendientes, sin consultas periódicas.

**Independent Test**: dos navegadores (editor en Inicio, invitado en `/upload`): la solicitud y el envío aparecen con aviso, contador y tarjeta en < 2 s; el otro editor ve salir la tarjeta al decidir; el panel de red no muestra peticiones periódicas, solo el WS y un POST ≈ cada 50 s; con la pestaña oculta no hay renovaciones.

### Tests de la historia 1 (escribir primero, deben fallar)

- [ ] T021 [P] [US1] Tests unitarios de los constructores del equipo en `test/unit/live-queries.spec.ts`: `teamSubmissionsLive(userId)`, `teamAccessRequestsLive(userId)` y `pendingUsersLive(userId)` devuelven `rawSql` con `$1` = id de la sesión; contienen la guarda (`EDITOR_GUARD` o `ADMIN_GUARD`) con los roles de `rolesAllowed`; **no** contienen `now()` ni `;`; usan `::int` en los conteos; llevan `LIMIT` (200, 50, 200); `accessRequests` selecciona `expires_at` y **no** filtra por vigencia; `pendingUsers` usa la guarda de administrador; ninguna selecciona `token_hash`.
- [ ] T022 [P] [US1] Tests unitarios de `POST /api/realtime/team` en `test/unit/api-realtime-team.spec.ts` (vía `installNitro`): sin sesión → 401; `expectedUserId` distinto → 409 `session-changed`; cuerpo inválido o con campos extra → 422; **no se llama a `useDb`**; 200 con `{ url, serverTime, expiresAt, queries: { submissions, accessRequests, pendingUsers } }` y `$1` = id de la sesión en las tres; sin secreto → 503. Clasificar la ruta en `test/unit/endpoint-guards.spec.ts` (solo sesión, sin rol, la guarda está en el SQL).
- [ ] T023 [P] [US1] Test del fragmento compartido en `test/unit/server-files.spec.ts` (ampliar): `readyPendingSubmissionsSql()` y `teamSubmissionsLive` contienen el **mismo** fragmento `FROM … JOIN … WHERE … GROUP BY` (constante exportada); cambiar uno sin el otro falla la prueba (research C13).
- [ ] T024 [P] [US1] Tests de componente de `useTeamLive` en `test/nuxt/useTeamLive.spec.ts` (con el cliente falso): el **primer** resultado no lanza avisos pero cuenta; cada id nuevo se anuncia **una sola vez**; un reemplazo de `rows` (reconexión) y un remontaje del layout no repiten; las solicitudes con `expires_at` vencido según `skew` no se cuentan ni se anuncian y salen a la hora de caducidad sin evento de la base; `pendingUsers` es 0 para un editor y la longitud para el administrador; `live` pasa a `true` en el primer resultado; `status` y `retry()` se propagan; toast con acción "Ver" → `/solicitudes` y textos de `messages.submissions.received` y `messages.access.requested`.
- [ ] T025 [P] [US1] Tests de componente de `LiveStatusBanner` en `test/nuxt/LiveStatusBanner.spec.ts`: no se ve con `connecting`, `live` ni `stale`; con `error` muestra `role="status"` con el texto `messages.live.stopped` y un botón "Reintentar" (`getByRole('button', { name: 'Reintentar' })`) de tamaño `btn` base que llama a `retry()`; desaparece al volver a `live`.
- [ ] T026 [P] [US1] **Portar** las pruebas del pulso a la nueva implementación (no descartarlas): `test/nuxt/dashboard-layout.spec.ts`, `test/nuxt/AccessRequestCard.spec.ts`, `test/nuxt/pages-guests.spec.ts`, `test/nuxt/pages-app.spec.ts`, `test/nuxt/navigation-actions.spec.ts`, `test/nuxt/four-states.spec.ts` y `test/nuxt/composables.spec.ts` dejan de usar `usePulse`/`refreshPulse` y usan `useTeamLive` con el cliente falso; los casos de contadores, avisos únicos, `AccessRequestCard` y cuatro estados se conservan con las mismas aserciones.
- [ ] T027 [P] [US1] Crear el e2e `test/e2e/team-live.spec.ts` (contra la rama de pruebas): un invitado pide acceso y completa un envío; un editor conectado ve aviso, badge y tarjeta (la latencia se registra); un segundo editor ve salir la tarjeta al decidir el primero; una solicitud vencida sale a su hora; el badge coincide con `openAccessRequests + pendingCount` de `GET /api/dashboard` (research C13); `pendingUsers` aparece para el admin y no para el editor; una cuenta desactivada deja de recibir datos; **ninguna petición repetida** (en una ventana de 12 s, ≤ 2 peticiones a `/api/realtime/` y ninguna a `/api/realtime/pulse`). **Sin esperas fijas de 3 o 5 s**: esperar por condición con un tope generoso (15 s) y registrar la latencia medida; el **< 2 s se comprueba en la fila de tiempos del scorecard (T073/T075)**, no como aserción e2e (contra un servicio beta sin SLA la volvería inestable, y AGENTS.md prohíbe aflojar una prueba después). La **ausencia de renovaciones con la pestaña oculta no se prueba aquí** (exigiría esperar ≈ 60 s): la cubren T010 (relojes simulados) y T073 (navegador).
- [ ] T028 [P] [US1] Actualizar los e2e existentes que esperaban el sondeo: `test/e2e/guest-queue.spec.ts` (aviso y contador en vivo), `test/e2e/users.spec.ts` (cuenta pendiente en vivo) y `test/e2e/routes-guard.spec.ts` (`POST /api/realtime/team` sin sesión → 401; con cuenta pendiente → 200 sin filas).

### Implementación de la historia 1

- [ ] T029 [US1] En `server/utils/files.ts`, extraer el `FROM … JOIN … WHERE … GROUP BY` de `readyPendingSubmissionsSql` a una **constante de fragmento SQL** exportada (sin parámetros) que usa tanto `readyPendingSubmissionsSql` (`sql.raw`) como la consulta en vivo; el comportamiento del REST (`/api/dashboard`, pulso) no cambia. Depende de T023.
- [ ] T030 [US1] Crear `server/utils/live-queries.ts` (la primera historia que lo toca lo crea; si US2 o US3 se hacen antes, lo crean con solo lo que necesiten) con los ayudantes `editorGuard()` y `adminGuard()` (armados con `rolesAllowed`, reutilizados por las historias siguientes), `teamSubmissionsLive(userId)`, `teamAccessRequestsLive(userId)` y `pendingUsersLive(userId)` (data-model, "Equipo"): `rawSql` de `server/utils/realtime.ts`, `$1` = id de la sesión, `EDITOR_GUARD`/`ADMIN_GUARD` armados con `rolesAllowed`, claves `id`/`user_id`, `LIMIT` 200/50/200, `::int` en `file_count`. Depende de T011, T014, T029.
- [ ] T031 [US1] Crear `server/api/realtime/team.post.ts` (contracts/api.md): `requireSessionUser` → `readValid(event, sealInput)` → `requireSameUser` → `sealAll({ submissions, accessRequests, pendingUsers })` con las tres consultas del usuario de la sesión; `Cache-Control: no-store`; sin `useDb`. Depende de T015, T016, T030.
- [ ] T032 [US1] Crear `app/composables/useTeamLive.ts` (contracts/ui.md): llama a `useLiveQueries` con `POST /api/realtime/team` y `expectedUserId = useMe().profile.userId`; calcula `pendingCount`, `openAccessRequests` (filtrado por `expires_at` con `skew`, reevaluado con el reloj de 1 s), `pendingUsers`, `accessRequests`, `submissionIds`, `userIds`, `live`, `status`, `retry`; avisos por diferencia de ids con `announced` a nivel de módulo (primer resultado solo siembra). Estado en `useState` (`team-*`). Depende de T018, T024.
- [ ] T033 [P] [US1] Crear `app/components/LiveStatusBanner.vue` (contracts/ui.md): `alert alert-warning` con `lucide:wifi-off`, `messages.live.stopped`, `role="status"` y botón `btn` base "Reintentar"; visible solo con `status === 'error'`. Depende de T019, T025.
- [ ] T034 [US1] En `app/layouts/dashboard.vue`: sustituir `usePulse()` + `usePulsePolling()` por **una** llamada a `useTeamLive()`; badges `/solicitudes` = `pendingCount + openAccessRequests` y `/usuarios` = `pendingUsers`; montar `<LiveStatusBanner />` sobre el contenido. Depende de T032, T033.
- [ ] T035 [P] [US1] En `app/pages/index.vue`: pasar del resumen del servidor a lo en vivo cuando `live` es verdadero (hoy espera `cursor`); conservar el primer render con SSR. Depende de T032.
- [ ] T036 [US1] En `app/pages/solicitudes.vue`: `watch(submissionIds, refresh)` (refetch dirigido por evento: las tarjetas necesitan URL firmadas); quitar `refreshPulse()`; el reintento tras una recarga fallida usa un `RETRY_DELAY_MS` propio (hoy usa `POLL_INTERVAL_MS`, `solicitudes.vue:39`); los cuatro estados desde `status`. Depende de T032.
- [ ] T037 [P] [US1] En `app/components/guests/AccessRequestList.vue` y `AccessRequestCard.vue`: dibujar desde `accessRequests` (vigentes); "Dar acceso" y "Rechazar" siguen siendo POST y la fila sale por la suscripción; quitar `refreshPulse()`; conservar la cuenta atrás de 30 s. Depende de T032.
- [ ] T038 [P] [US1] En `app/pages/usuarios.vue` y `app/composables/useUserAdmin.ts`: `watch(userIds, refresh)`; quitar `refreshPulse()`. Depende de T032.
- [ ] T039 [US1] **Checkpoint de la historia 1** (definición de hecho completa): `bun run typecheck`, `test:unit`, `test:nuxt`, `test:e2e` y `test:coverage`; cobertura por archivo ≥ 90 % de `live-queries.ts` (parte del equipo), `team.post.ts`, `useTeamLive.ts`, `LiveStatusBanner.vue`; **verificación en navegador** con `agent-browser` (`bun run dev`, `.env.development`, dos sesiones): escenarios 1, 2, 3, 5, 6, 7, 8, 11, 12, 13 y 15 de `quickstart.md`, a 360 px y ≥ 1280 px, en oscuro y claro, con loading/vacío/error/contenido, foco y consola limpia; anotar los tiempos medidos. Reportar antes de marcar.

**Checkpoint**: US1 desplegable sola (MVP). El invitado y la página de archivo siguen con su sondeo hasta US2 y US3.

---

## Phase 4: User Story 2 — El invitado ve la decisión en vivo (Priority: P2)

**Goal**: La página `/upload` cambia de estado en < 2 s sin sondeo y se detiene en los estados finales.

**Independent Test**: un invitado pide acceso; un editor aprueba o rechaza; la página cambia en < 2 s sin recargar, un lector de pantalla lo anuncia y no hay peticiones periódicas a `/api/public/access/current` mientras espera.

### Tests de la historia 2 (escribir primero, deben fallar)

- [ ] T040 [P] [US2] Tests unitarios de `guestAccessLive(tokenHash)` en `test/unit/live-queries.spec.ts` (ampliar o crear): `$1` = hash de la cookie; `WHERE token_hash = $1`; selecciona solo `id`, `status`, `sender_name`, `expires_at`, `access_expires_at`; **nunca** `token_hash`, `decided_by`, `sender_key` ni `submission_id`; sin `now()` ni `;`; `LIMIT 1`; **sin** guarda de rol.
- [ ] T041 [P] [US2] Tests unitarios de `POST /api/public/access/live` en `test/unit/api-access-live.spec.ts` (vía `installNitro`): sin cookie → 401 `data: { state: 'none' }`; con cookie → 200 `{ url, serverTime, expiresAt, queries: { access } }` con el hash de la cookie; **no se llama a `useDb`**; `Cache-Control: no-store`; sin secreto → 503. Registrar en `test/unit/endpoint-guards.spec.ts` que es pública **sin limitador** por no consultar la base (excepción justificada).
- [ ] T042 [P] [US2] Tests de componente de `useGuestAccess` y `/upload` en `test/nuxt/pages-upload.spec.ts` y `test/nuxt/useGuestAccess.spec.ts`: el estado sale de `accessStateOf(fila, ahora + skew)`; los 9 estados de `/upload` se siguen dibujando igual; **se detiene** en estados finales (`enabled = false`, ningún canal ni temporizador) y se reanuda al pedir un acceso nuevo; **tras `request()` y `restart()` se vuelve a sellar** y sigue la solicitud nueva; la primera vista con SSR y el desfase de la cabecera `Date` se conservan; pausa y reanudación con pestaña oculta/offline; el anuncio `aria-live` de cada cambio.
- [ ] T043 [P] [US2] Actualizar `test/e2e/access-upload.spec.ts`: la decisión llega a la página del invitado (espera por condición con tope de 15 s y latencia registrada; el < 2 s se mide en el scorecard); **ninguna** petición repetida a `/api/public/access/current` mientras espera; un invitado rechazado que pide otra vez sigue la nueva solicitud; en un estado final no queda canal abierto; sin esperas fijas de 5 s.

### Implementación de la historia 2

- [ ] T044 [US2] Añadir `guestAccessLive(tokenHash)` a `server/utils/live-queries.ts` (data-model, "Invitado"); si el archivo todavía no existe porque US1 no se hizo, crearlo con solo este constructor (no necesita las guardas de rol). Depende de T040.
- [ ] T045 [US2] Crear `server/api/public/access/live.post.ts` (contracts/api.md): `readAccessTokenHash(event)` → 401 sin cookie → `sealAll({ access })` → `Cache-Control: no-store`; sin `useDb`, sin limitador. Depende de T014, T044, T041.
- [ ] T046 [US2] Modificar `app/composables/useGuestAccess.ts` (contracts/ui.md): reemplazar `poll` + `useIntervalFn(poll, POLL_INTERVAL_MS)` por `useLiveQueries(() => $fetch('/api/public/access/live', { method: 'POST' }), { enabled: () => !terminal.value })`; estado = `accessStateOf(fila, ahora + skew)`; conservar el SSR (`current.get.ts`), el desfase de `Date`, el reloj de 1 s, `local`, `request`, `restart` y `holdWhileUploading`; llamar a `retry()` tras `request()`/`restart()` que crean una solicitud. Depende de T018, T042.
- [ ] T047 [US2] Revisar `app/pages/upload.vue` y ajustar solo lo necesario para los estados `conectando`/`error` con `messages.live.unavailable` y "Reintentar"; sin cambios de diseño ni de copy de los 9 estados. Depende de T046.
- [ ] T048 [US2] **Checkpoint de la historia 2** (definición de hecho completa): `typecheck`, `test:unit`, `test:nuxt`, `test:e2e`, `test:coverage`; cobertura por archivo ≥ 90 % de `live.post.ts` y de lo reescrito de `useGuestAccess.ts`; **verificación en navegador** (invitado sin sesión + editor): escenarios 4, 5 y 6 (sin peticiones a `/api/public/access/current`) y 8 de `quickstart.md`, a 360 px y ≥ 1280 px, oscuro y claro, los 9 estados de `/upload`, foco, consola limpia y el anuncio a lector de pantalla. Reportar antes de marcar.

**Checkpoint**: US1 y US2 funcionan; la página de archivo todavía sondea.

---

## Phase 5: User Story 3 — Comentarios y lectura de imágenes en vivo (Priority: P3)

**Goal**: El hilo de comentarios y el panel de texto de imágenes se actualizan solos en < 2 s, y una lectura atascada pasa a error a los 90 s sin cambio en la base.

**Independent Test**: dos personas del equipo en el mismo archivo: una comenta y la otra lo ve en < 2 s sin duplicados en quien comentó; una lectura de imagen pasa de "leyendo" al resultado sin peticiones repetidas y deja de seguir el estado.

### Tests de la historia 3 (escribir primero, deben fallar)

- [ ] T049 [P] [US3] Tests unitarios de `imageTextOf` en `test/unit/image-text-state.spec.ts`: mapea `text_status` (`null`→`pending`, `reading`, `ready`, `empty`, `failed`, `unavailable`); `reading` con `text_started_at` más viejo que `READING_STALE_MS` (90 000 ms) → `failed`/`timeout` (límite exacto: 90 000 → sigue `reading`; 90 001 → `failed`) y `reading` sin `text_started_at` → `failed`/`timeout`; `text` solo si `ready`; `error` solo si `failed` (por defecto `provider`); `readAt`, `editedAt` y `editedBy` (solo si hay `editedAt`). Los casos existentes de `toImageText` en `test/unit/image-text.spec.ts` siguen pasando con la función compartida.
- [ ] T050 [P] [US3] Tests unitarios de los constructores del archivo en `test/unit/live-queries.spec.ts` (ampliar o crear): `fileCommentsLive(userId, fileId)` (guarda, `$2::uuid`, `EXISTS` de archivo listo, orden `created_at, id`, `LIMIT 500`, sin `now()` ni `;`), `fileTextLive(userId, fileId)` (columnas `text_*` y `edited_by_name`, `LIMIT 1`) y `submissionFileTextLive(userId, submissionId, fileId)` (`submission_id = $2::uuid AND id = $3::uuid`, sin edición). Ninguna selecciona `token_hash`.
- [ ] T051 [P] [US3] Tests unitarios de las rutas del archivo en `test/unit/api-realtime-files.spec.ts` (vía `installNitro`): para `POST /api/realtime/files/:id` y `POST /api/realtime/submissions/:id/files/:fileId/text`: sin sesión → 401; 409 por `expectedUserId` distinto; `:id`/`:fileId` no UUID → 422; **no se llama a `useDb`**; 200 con `{ url, serverTime, expiresAt, queries }` (`comments` y `text`, o solo `text`); un archivo inexistente **no** da 404 (sellado válido con 0 filas). Clasificar ambas en `test/unit/endpoint-guards.spec.ts`.
- [ ] T052 [P] [US3] Tests de componente de `useCommentThread` en `test/nuxt/comments.spec.ts` (ampliar): se suscribe solo con el hilo visible (`useElementVisibility`) y se pone al día al volver a verlo; el comentario propio se inserta con la respuesta del POST y se **fusiona por id** sin duplicarse cuando llega en vivo; editar y borrar de otra persona llegan por reemplazo de `rows`; `canEdit`/`canDelete` se derivan en el cliente (autor, admin); los cuatro estados del hilo; ya no se envía `since`; **al cambiar `fileId`** se cancela y se vuelve a sellar el archivo nuevo, y una renovación en vuelo del archivo anterior no se aplica al nuevo.
- [ ] T053 [P] [US3] Tests de componente de `useImageText` y `ImageTextPanel` en `test/nuxt/ImageTextPanel.spec.ts` y `test/nuxt/composables.spec.ts`: se suscribe **solo** mientras `status === 'reading'` y la suscripción se **cierra** al pasar a un estado final; una lectura atascada pasa a `failed/timeout` a los 90 s con `skew` (relojes simulados) sin evento de la base; una corrección ajena actualiza el panel con quién la editó; la carga inicial y la lectura de respaldo REST no cambian; el panel de un archivo de envío y el de la biblioteca se actualizan en vivo; **al cambiar `endpoint`** se cancela y se vuelve a sellar el nuevo.
- [ ] T054 [P] [US3] Actualizar los e2e `test/e2e/comments.spec.ts` (segunda persona ve el comentario con espera por condición de tope 15 s y latencia registrada; quien comenta no ve duplicados; ninguna petición periódica al hilo) y `test/e2e/image-text.spec.ts` (con el stub de OpenRouter: pasa de "leyendo" al resultado sin peticiones repetidas y sin esperas fijas de 3 s). **El límite de 90 s no se prueba en e2e**: el cliente recalcula el desfase con cada `serverTime`, así que un reloj simulado del navegador se desharía en la siguiente renovación; lo cubren T049 y T053.

### Implementación de la historia 3

- [ ] T055 [US3] Extraer a `shared/` (p. ej. `shared/image-text-state.ts`) la derivación pura `imageTextOf(row, now)` de `server/utils/image-text.ts:36` (incluida `isStale` con `READING_STALE_MS`) y hacer que `toImageText` del servidor la reutilice sin cambiar su comportamiento. Depende de T049.
- [ ] T056 [US3] Añadir a `server/utils/live-queries.ts` `fileCommentsLive`, `fileTextLive` y `submissionFileTextLive` (data-model, "Archivo" y "Texto de imagen"); si el archivo todavía no existe porque US1 no se hizo, crearlo con `editorGuard()` (armado con `rolesAllowed`) y estos tres. Depende de T050.
- [ ] T057 [US3] Crear `server/api/realtime/files/[id].post.ts` (contracts/api.md): sesión, `paramId`, `sealInput`, `requireSameUser`, `sealAll({ comments, text })`; sin `useDb`. Depende de T014, T015, T056, T051.
- [ ] T058 [P] [US3] Crear `server/api/realtime/submissions/[id]/files/[fileId]/text.post.ts`: sesión, `paramId` ×2, `sealInput`, `requireSameUser`, `sealAll({ text })`; sin `useDb`. Depende de T014, T015, T056, T051.
- [ ] T059 [US3] Modificar `app/composables/useCommentThread.ts` (contracts/ui.md): carga inicial REST sin cambios; suscripción con `useLiveQueries(() => $fetch(`/api/realtime/files/${id}`, …), { key: fileId, enabled: hilo visible })`; fusión por id del comentario propio; quitar `since` y el sondeo (`useIntervalFn`, `POLL_INTERVAL_MS`). Depende de T018, T052, T057.
- [ ] T060 [US3] Modificar `app/composables/useImageText.ts` (y `ImageTextPanel.vue` si hace falta): suscripción solo mientras `status === 'reading'` (`enabled`) y con `key: endpoint`, estado = `imageTextOf(fila, ahora + skew)`, cancelación al estado final; quitar `useIntervalFn(poll, TEXT_POLL_INTERVAL_MS)`. Depende de T018, T053, T055, T057, T058.
- [ ] T061 [US3] **Checkpoint de la historia 3** (definición de hecho completa): `typecheck`, `test:unit`, `test:nuxt`, `test:e2e`, `test:coverage`; cobertura por archivo ≥ 90 % de `imageTextOf`, de las dos rutas y de lo reescrito de `useCommentThread.ts` y `useImageText.ts`; **verificación en navegador** (dos sesiones en el mismo archivo): escenarios 9 y 10 de `quickstart.md`, a 360 px y ≥ 1280 px, oscuro y claro, cuatro estados del hilo y del panel, foco, consola limpia y sin peticiones repetidas. Reportar antes de marcar.

**Checkpoint**: las tres historias en vivo; ya no hay consumidores del sondeo.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Retirar el sondeo, fijar la configuración de cada entorno, documentar y demostrar la barra de calidad (spec SC-007 a SC-011).

### Retiro del sondeo (FR-022)

- [ ] T062 Eliminar el pulso: `server/api/realtime/pulse.get.ts`, `profileQuery` y `attachProfile` de `server/utils/session.ts` (se conserva `requireSessionUser`), el tipo `Pulse` de `shared/types/api.ts`, `app/composables/usePulse.ts` y las pruebas que solo existían para él (`test/unit/api-core.spec.ts` y las portadas en T026 ya cubren lo nuevo; confirmar que **ninguna aserción se perdió**). Verificar con `grep -rn "usePulse\|refreshPulse\|/api/realtime/pulse\|Pulse" app server shared test` que no queda ninguna referencia.
- [ ] T063 Eliminar `POLL_INTERVAL_MS` y `PULSE_OVERLAP_MS` de `shared/constants/files.ts:44-49` y `TEXT_POLL_INTERVAL_MS` de `shared/constants/image-text.ts:16`; confirmar con `grep` que no quedan consumidores (`useGuestAccess`, `useCommentThread`, `solicitudes.vue` ya migrados) y que el reintento de `solicitudes.vue` usa su `RETRY_DELAY_MS`.
- [ ] T064 Quitar los argumentos `since` de `readyPendingSubmissionsSql` y `openAccessRequestsSql` (ambas siguen sirviendo a `/api/dashboard`), el parámetro `since` de `server/api/files/[id]/comments.get.ts`, `commentsQuery` (`shared/validation/comments.ts:10`) y `listComments` (`server/utils/comments.ts:49`), y `isoSince` (`shared/validation/core.ts:92`) si ya nadie lo usa; actualizar `test/unit/validation-comments.spec.ts`, `test/unit/validation-core.spec.ts`, `test/unit/api-comments.spec.ts` y `test/unit/server-files.spec.ts`.
- [ ] T065 [P] Ampliar `test/unit/architecture.spec.ts`: `@neon/realtime/server` se importa **solo** desde `server/utils/realtime.ts`; `@neon/realtime/client` **solo** desde `app/utils/realtime-client.ts` y siempre con `import()` dinámico (ningún `import … from '@neon/realtime/client'` estático); ninguna ruta de sellado importa `useDb`. Auditar `test/unit/endpoint-guards.spec.ts`: las 4 rutas nuevas clasificadas y ninguna entrada de `/api/realtime/pulse`.

### Documentación y gobierno (FR-023)

- [ ] T066 [P] Actualizar `AGENTS.md`: (1) regla I (cookies y sondeo de `/upload`, `PULSE_OVERLAP_MS`) y la línea de "Platform & security constraints" ("realtime is client polling every 5 s") → Neon Realtime con consultas selladas y renovación; (2) variables de entorno: `NUXT_NEON_REALTIME_URL`/`SECRET` **ahora se usan**; (3) regla IV: el acceso a Realtime solo por `server/utils/realtime.ts` (y `app/utils/realtime-client.ts` en el cliente); (4) "Known gotchas": sin `now()` en consultas en vivo, solo `rawSql`, rutas de sellado solo con sesión (sin tocar la base), `session_data` de 5 min, orígenes por rama y el permiso de ≈ 60 s; (5) tabla de stack: fila `Realtime`. La línea "Active feature" ya apunta a 004 (se cambió al crear estos documentos). Verificar que `AGENTS.md` sigue alineado con la constitución (no se requiere enmienda: la frontera única ya está en la Constitución IV).
- [ ] T067 [P] Añadir una nota de una línea **"sustituido por la feature 004"** (sin reescribir contenido) en: `specs/003-guest-upload-access-code/research.md` (B6), `specs/003-guest-upload-access-code/spec.md` (FR-007, FR-013, SC-002, SC-005), `specs/001-shared-media-drive/research.md` (R7), `specs/001-shared-media-drive/spec.md` (FR-018, SC-003) y `specs/002-note-text-extraction/spec.md` (FR-012, línea de consulta cada 3 s).

### Configuración por entorno (pedir permiso a la persona en cada paso)

- [ ] T068 **Comprobar y configurar entornos**, sin imprimir valores: que `NUXT_NEON_REALTIME_URL` de `.env.development` contenga `ep-wandering-base` y la de `.env.test`, `ep-rough-art` (`grep -c`); que `.env.example` conserve los nombres; y **pedir a la persona** que cargue `NUXT_NEON_REALTIME_URL` y `NUXT_NEON_REALTIME_SECRET` en Vercel **Production** (`ep-dry-mouse`) y **Preview**, y en su `.env` de producción local si lo usa. El agente no cambia secretos ni variables de Vercel.
- [ ] T069 **Fijar los orígenes permitidos** (cambia configuración de Neon y **reemplaza** la lista; **pedir permiso y, para producción, el dominio exacto a la persona**): `neon realtime enable --allowed-origin http://localhost:3000` (development), `--allowed-origin http://localhost:3100` (test, `E2E_PORT`) y, en production, el dominio exacto de `NUXT_PUBLIC_SITE_URL` más el alias de vista previa necesario (≤ 16, sin comodines). Anotar en `research.md` el estado final de `allowed_origins` por rama (`get_realtime`, solo lectura). Reversión documentada: restablecer la lista a `[]` (cualquier origen).
- [ ] T070 Volver a correr `bun run test:e2e` **con los orígenes cerrados** y los escenarios 1, 4 y 9 de `quickstart.md`: deben seguir pasando (research C14).

### Calidad y verificación final (spec SC-007 a SC-011)

- [ ] T071 Ejecutar `bun run build` y `bun run analyze`: cada ruta **≤ 250 KB gzip** (informe de `.sonda/`), y `@neon/realtime/client` en un chunk diferido (no en la entrada); registrar la ruta más pesada frente a ≈ 158 KiB de 003.
- [ ] T072 Ejecutar el conjunto completo (`typecheck`, `build`, `test:unit`, `test:nuxt`, `test:e2e`, `test:coverage`): el umbral del proyecto **92 %** en las cuatro métricas sin bajarlo, y el informe por archivo con **cada archivo nuevo ≥ 90 %** por métrica (el `include` de `vitest.config.ts` ya cubre `app/**`, `server/**` y `shared/**`, así que todos los archivos nuevos entran, pero solo hay umbral **global**: el 90 % por archivo se lee del informe, no basta con que el umbral esté en verde) (`server/utils/realtime.ts`, `server/utils/live-queries.ts`, las 4 rutas de sellado, `app/utils/realtime-client.ts`, `useLiveQueries`, `useTeamLive`, `LiveStatusBanner`, `shared/image-text-state.ts`, y lo reescrito de `useGuestAccess`, `useCommentThread` y `useImageText`). Confirmar que borrar el pulso no bajó el porcentaje global.
- [ ] T073 Verificación en navegador completa (`agent-browser`, `bun run dev`, `.env.development`, dos sesiones): los 15 escenarios de `quickstart.md` en **360 px oscuro, 360 px claro, 1280 px oscuro y 1280 px claro**; sin peticiones repetidas en Network (solo el WS y un POST ≈ cada 50 s), sin renovación con la pestaña oculta, cuatro estados, foco visible, navegación por teclado, consola limpia y contraste AA en ambos temas. Anotar los tiempos de SC-001 a SC-003.
- [ ] T074 **Medición de cómputo** (research C16, `quickstart.md` §4; pedir permiso para los comandos MCP): registrar `compute_time_seconds` y `active_time_seconds` de `development` (`list_branches`), dejar **una** pestaña del dashboard visible y quieta **30 min**, registrar de nuevo; esperado antes ≈ 1 800 s activos, después ≤ ≈ 300–360 s. Pedir a la persona que lea en Vercel (Functions → Invocations) las invocaciones antes y después. Informar **ambos** números en `checklists/verification-scorecard.md`.
- [ ] T075 Completar `checklists/verification-scorecard.md` (17 verificaciones, cada una **aprobada o fallida** con su evidencia) y ejecutar la validación de `quickstart.md`. 004 se integra solo con **≥ 90 % aprobadas y cero fallos** en pruebas, typecheck, build y autorización (SC-010). Preparar la nota del PR (Conventional Commits; la persona decide cuándo hacer commit y abrir el PR; rebasar sobre `main` cuando se integre 003).

**Checkpoint**: sondeo retirado, entornos configurados, documentación alineada y barra de calidad demostrada.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup & puerta G1 (Phase 1)**: sin dependencias; **T004 bloquea todo lo demás** si falla.
- **Foundational (Phase 2)**: depende de la fase 1 y **bloquea** todas las historias.
- **US1 (Phase 3)**: depende de la fase 2. Es el MVP.
- **US2 (Phase 4)** y **US3 (Phase 5)**: dependen de la fase 2 y no de US1; si se hacen después de US1 reutilizan `live-queries.ts`, pero sus pruebas son independientes. Se recomienda el orden P1 → P2 → P3.
- **Polish (Phase 6)**: depende de las tres historias (T062–T064 solo cuando ya no hay consumidores del sondeo); T069 antes de T070; T074 al final, con la feature completa.

### Dependencias dentro de las historias

- Tests primero (deben fallar) → fragmento SQL/constructores → ruta de sellado → composable → páginas y componentes → checkpoint.
- `server/utils/live-queries.ts` se amplía en cada historia (T030, T044, T056): ejecutar en orden de historia para evitar conflictos de archivo.

### Parallel Example: Phase 2

```text
# Tests (archivos distintos):
T005 test/unit/permissions.spec.ts
T006 test/unit/validation-realtime.spec.ts
T007 test/unit/realtime.spec.ts
T009 test/nuxt/helpers/fake-realtime.ts

# Implementación sin dependencias entre sí:
T011 shared/permissions.ts
T012 shared/validation/realtime.ts
T013 shared/types/api.ts
T019 app/utils/messages.ts
```

### Parallel Example: User Story 1

```text
# Tests:
T021 test/unit/live-queries.spec.ts
T022 test/unit/api-realtime-team.spec.ts
T024 test/nuxt/useTeamLive.spec.ts
T025 test/nuxt/LiveStatusBanner.spec.ts
T027 test/e2e/team-live.spec.ts

# Páginas y componentes (tras T032):
T035 app/pages/index.vue
T037 app/components/guests/AccessRequestList.vue + AccessRequestCard.vue
T038 app/pages/usuarios.vue + app/composables/useUserAdmin.ts
```

### Parallel Example: User Story 2 y 3

```text
US2: T040 · T041 · T042 · T043 (tests)  →  T044 → T045  →  T046 → T047
US3: T049 · T050 · T051 · T052 · T053 · T054 (tests)  →  T055 · T056  →  T057 ∥ T058  →  T059 ∥ T060
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (incluida la **puerta G1**) + Phase 2.
2. Phase 3 (US1): el equipo ve todo en vivo y la pestaña quieta deja dormir la base.
3. **Parar y validar** US1 con la definición de hecho de AGENTS.md → desplegar el MVP (el invitado y el archivo siguen con el sondeo, que sigue funcionando).

### Incremental Delivery

1. US1 → validar → desplegar (MVP).
2. US2 → invitado en vivo → validar → desplegar.
3. US3 → comentarios e imágenes en vivo → validar → desplegar.
4. Polish → retirar el sondeo, orígenes por rama, documentación, presupuestos, medición de cómputo y lista de verificación.

### Reversión

- Mientras no se ejecute Polish T062–T064, el sondeo sigue en el código: revertir una historia es revertir su commit.
- Después: `git revert` del merge de 004 (la rama 003 no se toca). La configuración de Neon es aditiva (el código la ignora) y los orígenes se restablecen a `[]`. No hay migración de esquema.

### Notes

- [P] = archivos distintos, sin dependencias pendientes.
- Los comandos que cambian configuración de Neon, usan MCP de base de datos o tocan variables de Vercel **se piden a la persona antes** (AGENTS.md).
- Hacer commit solo cuando la persona lo pida, con Conventional Commits.

---

## Trazabilidad requisito → tareas

| Requisito | Tareas |
|-----------|--------|
| FR-001 aviso y contador < 2 s | T021, T022, T024, T027, T030–T032, T034 |
| FR-002 cuentas pendientes (solo admin) | T021, T024, T027, T030, T038 |
| FR-003 una sola vez por pestaña | T024, T027, T032 |
| FR-004 listas al día / decisiones REST | T026, T027, T036–T038 |
| FR-005 caducidad con la hora del servidor | T024, T027, T032, T037 |
| FR-006 autorización en el SQL | T005, T021, T027, T030, T050 |
| FR-007 estado del invitado en vivo | T040–T043, T045, T046 |
| FR-008 SSR + desfase de reloj | T042, T046 |
| FR-009 se detiene en estado final y sigue la solicitud nueva | T042, T043, T046 |
| FR-010 permiso del invitado solo por cookie | T040, T041, T045 |
| FR-011 comentarios en vivo, propio sin duplicar | T050, T052, T054, T056, T057, T059 |
| FR-012 mismo acceso que la lectura normal | T050, T051, T056 |
| FR-013 cuatro estados del hilo | T052, T059 |
| FR-014 texto de imagen en vivo, 90 s | T049, T053, T054, T055, T060 |
| FR-015 paneles de biblioteca y Solicitudes | T050, T053, T058, T060 |
| FR-016 sin peticiones periódicas | T010, T018, T027, T043, T054, T073 |
| FR-017 mantenimiento sin base, pausado oculto | T003, T004, T008, T010, T016, T018, T073 |
| FR-018 401/409 → recarga única; reintento 1 s | T008, T010, T015, T018 |
| FR-019 cuatro estados + reintento | T010, T019, T025, T033, T034, T047, T073 |
| FR-020 permiso solo en cuerpos | T007, T010, T014, T018, T022 |
| FR-021 una sola definición de contadores | T023, T027, T029 |
| FR-022 retiro del sondeo | T062–T065 |
| FR-023 entorno por rama, orígenes exactos | T066, T068–T070 |
| FR-024 sin esquema | T001, T002 |
| SC-007 medición de cómputo | T004, T074 |
| SC-008 presupuesto 250 KB | T071 |
| SC-010 / SC-011 calidad y cobertura | T072, T075 |
