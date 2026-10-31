# Research: Actualización en vivo sin sondeo

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Fecha**: 2026-10-31

Cada decisión resuelve una incógnita del Technical Context. Formato: Decisión · Razón · Alternativas.
Las referencias `archivo:línea` son del estado del repositorio el 2026-10-31 (rama `004-neon-realtime`, que parte de la
punta de `003-public-photos-upload`, commit `b8b9892`). Las afirmaciones sobre el SDK de Neon Realtime salen del skill
`neon-realtime` instalado en `.claude/skills/` y del plan de migración; **lo marcado «a confirmar en el spike» no se
asume**: la tarea T003 lo verifica contra la rama de desarrollo antes de escribir código de producción.

## Hechos verificados en el código (no suposiciones)

| Hecho | Fuente |
|-------|--------|
| El pulso del equipo hace un `db.batch` de 6 sentencias por sondeo, cada 5 s. | `server/api/realtime/pulse.get.ts:19-34`, `app/composables/usePulse.ts:72` |
| `/upload` sondea `current.get.ts` cada 5 s; el hilo de comentarios, cada 5 s con `?since=`; la lectura de imágenes, cada 3 s. | `useGuestAccess.ts:122`, `useCommentThread.ts:55`, `useImageText.ts:27` |
| `POLL_INTERVAL_MS` tiene **5 consumidores** (no solo el pulso): `usePulse`, `useGuestAccess`, `useCommentThread`, `pages/solicitudes.vue:39` (retardo del reintento) y su definición. | `shared/constants/files.ts:44` |
| La sesión se resuelve con `fetchSession`: lee la caché firmada `session_data` de 5 min y, **al caducar, llama a Neon Auth (`get-session`) y la vuelve a firmar**. | `server/utils/auth.ts:34-49` (comentario del bloque) |
| `DEFERRED_PROFILE = ['/api/realtime/pulse']` ya existe: el middleware solo resuelve la sesión (sin `ensureProfile`) y deja `event.context.sessionUser`. | `server/middleware/session.ts:5-14` |
| Una lectura de imagen `reading` con más de `READING_STALE_MS` (90 s) se **muestra** como `failed/timeout` sin que la fila cambie. | `server/utils/image-text.ts:30-46`, `shared/constants/image-text.ts:14` |
| `readyPendingSubmissionsSql` y `openAccessRequestsSql` sirven al pulso **y** a `/api/dashboard`. | `server/utils/files.ts:214`, `server/utils/access-requests.ts:263`, `server/api/dashboard.get.ts:18-20` |
| Los roles son `admin` y `editor`; `can(role, action)` es la matriz única. | `shared/permissions.ts` |
| `nuxt.config.ts` ya mapea `neonRealtimeUrl` y `neonRealtimeSecret`; ningún código los usa. | `nuxt.config.ts:25-26`, `.env.example:6-7` |
| `.specify/feature.json` está en `.gitignore` (es local). | `.specify/.gitignore:6` |

## C1. Reemplazar el sondeo por consultas en vivo de Neon Realtime (decisión central)

- **Decisión**: el servidor **sella** consultas de solo lectura (con `NUXT_NEON_REALTIME_SECRET`), el navegador se suscribe
  por WebSocket a la API de SQL en vivo y recibe el resultado inicial y luego los cambios de cada transacción. Se elimina
  todo sondeo de intervalo fijo (spec FR-022). Sustituye a 003 B6 y a 001 R7.
- **Razón** (modelo de costo, de la medición de la rama en el periodo actual, vía MCP en solo lectura):
  - Tiempo activo del proyecto: **167 300 s ≈ 46,5 h** (producción 17 480 s, desarrollo 74 788 s, pruebas 74 724 s), con piso de
    0,25 CU, autoescala a 2 y suspensión a los 5 minutos.
  - Un sondeo cada 5 s es menor que los 5 minutos de suspensión: con una pestaña visible la base **no escala a cero nunca**.
  - Con Realtime, según la documentación de Neon, mantener una suscripción abierta no despierta el cómputo ni usa una conexión
    (a confirmar en el spike, puerta G1, porque es el motivo de la feature).

  | Por pestaña visible | Antes | Después | Cambio |
  |---|---|---|---|
  | Invocaciones de Vercel (equipo) | 720/h | ≈ 72/h (una renovación por ≈ 50 s) | −90 % |
  | Sentencias SQL a Neon (equipo, en reposo) | 4 320/h | 0/h | −100 % |
  | Cómputo de Neon | despierto 100 % del tiempo visible (≥ 44 CU-h/mes con una pestaña 8 h/día, 22 días, a 0,25 CU) | despierto tras escrituras y suscripciones nuevas; ≈ 4,6 CU-h/mes con 10 ráfagas/día | ≈ −90 % (**a verificar**) |
  | Invitado esperando (≤ 8 min) | ≤ 96 llamadas + 96 consultas | ≤ 1 sellado + 9 renovaciones, 0 consultas | −90 % / −100 % |
  | Invitado con acceso aprobado (≤ 30 min) | ≤ 360 + 360 | ≤ 36 renovaciones, 0 consultas | −90 % / −100 % |
  | Comentarios (por hora, además de la renovación del equipo) | 720 + 720 lotes | 72 renovaciones, 0 consultas | −90 % / −100 % |
  | Lectura de imagen (10–45 s) | 3–15 llamadas | 1 sellado, normalmente 0 renovaciones | −67…−93 % |
  | Pestaña oculta | 0 | 0 (renovación pausada) | — |

- **Costos que quedan**: Realtime es gratis durante la beta (precio posterior no publicado); el resultado inicial y los
  cambios cuentan como *egress* de Neon; iniciar una suscripción despierta el cómputo; el motor trabaja al escribir (algo de
  WAL; la replicación ya está activa). Las invocaciones de Vercel no son visibles desde aquí: se leen en el panel antes y después.
- **Alternativas**:
  - Seguir con el sondeo: simple pero mantiene la base despierta (el problema de origen).
  - Subir el intervalo a > 5 min: rompe SC-001/SC-002.
  - SSE o WebSocket propio en Vercel: las funciones no tienen estado ni conexiones largas (Constitución, plataforma).
  - Neon Functions + push: sirve para presencia o escritura en vivo, no para filas de la base (el skill lo desaconseja para este caso).
  - Biblioteca de sincronización de terceros: dependencia y servicio nuevos sin ventaja sobre el proveedor ya contratado.

## C2. Rutas de sellado solo con sesión (sin perfil) y el riesgo de la caché de sesión (puerta G1)

- **Decisión**: todas las rutas `/api/realtime/**` de sellado leen **solo la sesión** de la cookie firmada (`getAuthUser`, sin
  `ensureProfile`): se generaliza `DEFERRED_PROFILE` a `['/api/realtime/']` (`session.ts:5`). Sellar es criptografía local
  (Web Crypto), así que renovar no necesita a Neon. La autorización va dentro del SQL (C3).
- **Riesgo encontrado (nuevo, no está en el plan de migración)**: la sesión no es "solo la cookie". `fetchSession` usa la
  caché firmada `session_data` de **5 minutos**; al caducar llama a Neon Auth (`get-session`) y la vuelve a firmar. Se **supone, sin verificar**, que Neon Auth
  guarda su información en la base de la rama. Si esa llamada despierta el cómputo, una pestaña con renovaciones cada ≈ 50 s
  provocaría **una activación cada 5 minutos, exactamente el tiempo de suspensión**, y la base seguiría despierta casi todo
  el tiempo: la feature perdería su motivo principal aunque el sondeo desaparezca.
- **Qué se sabe y qué no**:
  - Sabido: la caché dura 5 min y se refresca contra Neon Auth al caducar (código).
  - **No sabido**: si esa llamada a Neon Auth toca el cómputo de la rama del proyecto o un servicio aparte. Se decide midiendo.
  - **No sabido**: si `realtime.seal()` es de verdad **local** (sin ninguna petición de red). FR-017, el modelo de costo y G1
    lo suponen y las pruebas de "sin `useDb`" no pueden ver una llamada hecha dentro del SDK: el spike (T003) lo comprueba con
    un espía de red durante un sellado.
- **Puerta G1 (Fase 1, go/no-go)**: con la sesión **real** y un bucle de renovación de 50 s, mantener una suscripción y la
  renovación durante **> 10 minutos** (más que la suspensión y que dos caducidades de la caché) en la rama de desarrollo y
  leer el estado del endpoint de cómputo (`list_branch_computes` / `get_postgres_endpoint`, solo lectura) para confirmar si
  se suspende. Resultados posibles, que **decide la persona responsable** (no se elige en este documento):
  1. **Se suspende** → seguir con el plan.
  2. **No se suspende por la renovación de sesión** → opciones: (a) un verificador de solo cookie firmada para `/api/realtime/**`
     que acepte la caché caducada hasta un máximo documentado (revisión de seguridad, Constitución IV; la revocación de rol
     sigue viva por el SQL, pero el cierre de sesión se vería hasta el siguiente refresco); (b) renovar la sesión solo cuando
     la persona interactúa; (c) conservar la feature solo por latencia e invocaciones y **retirar SC-007**; (d) abandonar 004.
  3. **No se suspende por otra causa** → abandonar o replantear antes de construir la Fase 2.
- **Alternativas** descartadas por ahora: llamar a `ensureProfile` en cada renovación (garantiza 1 consulta por renovación y
  vuelve a despertar la base cada ≈ 50 s).

## C3. La autorización va dentro de la consulta

- **Decisión**: cada consulta sellada lleva `$1 = id de usuario de la sesión` y una guarda
  `EXISTS (SELECT 1 FROM profiles me WHERE me.user_id = $1 AND me.status = 'active' AND me.role IN (…))`. Los roles salen de
  `shared/permissions.ts` (un ayudante `rolesAllowed(action)` que devuelve los roles con `can(role, action) === true`) para
  que el SQL y la matriz no diverjan; una prueba unitaria compara ambos con la tabla de verdad.
  - Equipo (`submissions.review`, `content.read`): `admin` y `editor`. Cuentas pendientes (`users.manage`): solo `admin`; un
    editor recibe 0 filas, no un error, y el contador es la longitud.
- **Razón**: da **revocación en vivo** (FR-006): una cuenta desactivada recibe 0 filas desde la siguiente actualización, aunque
  siga renovando; y la ruta de sellado no necesita tocar la base.
- **Alternativas**: comprobar el rol al sellar (se vuelve a la consulta por renovación de C2); seguridad por filas de la base
  (no se admite todavía, y no se usa en el proyecto).

## C4. `rawSql` y no el adaptador de Drizzle

- **Decisión**: las consultas son SQL directo con `rawSql` de `@neon/realtime/server` (una sola sentencia `SELECT`, sin `;`,
  placeholders `$n`). Los parámetros sin tipo llegan como texto: se castean (`$2::uuid`) y los conteos con `::int` (un `int8`
  llega como texto).
- **Razón**: el adaptador exige que las claves seleccionadas sean iguales a los nombres de columna y el esquema usa camelCase;
  evita además `@neon/realtime-drizzle`: **una dependencia menos**.
- **Alternativas**: `@neon/realtime-drizzle` (dependencia extra y reescribir los alias); Kysely (no se usa).

## C5. Consultas deterministas: la hora se resuelve en el dispositivo

- **Decisión**: ninguna consulta usa `now()`, `gen_random_uuid()` ni similares. Las vigencias se filtran en el navegador con
  `serverTime`: la respuesta de sellado trae `serverTime` y el cliente guarda `skew = serverTime − Date.now()`; el invitado
  conserva su `skew` de la cabecera `Date`. Las reglas son **funciones puras compartidas** (`shared/`):
  - `accessStateOf(row, now)` (ya existe, `shared/constants/access.ts:27`): estado del invitado y vigencia de solicitudes.
  - **`imageTextOf(row, now)` (nueva)**: se extrae de `server/utils/image-text.ts:36` la derivación del DTO (incluida la regla
    `READING_STALE_MS` de 90 s) a `shared/`, y `toImageText` del servidor la reutiliza. Sin esto, una lectura que se quedó en
    `reading` **nunca** cambiaría en vivo (la fila no cambia: solo pasa el tiempo) y el panel mostraría "leyendo" para
    siempre. Es un hueco del plan de migración.
- **Razón**: la base no emite un cambio cuando solo pasa el tiempo (caducidad a los 8 min, acceso a los 30, lectura a los 90 s).
- **Alternativas**: pasar la hora como parámetro sellado (cambia en cada renovación y obligaría a una suscripción nueva); un
  temporizador de servidor (funciones sin estado).

## C6. Un sellado por vista en vivo y calendario de renovación

- **Decisión**: cada **vista en vivo** sella **todas** sus consultas en **un** POST (`team`; `files/:id` con `comments` y `text`;
  `submissions/…/text`; `access`), así que hay **una renovación por vista activa y periodo**, no una por página: el layout del
  equipo mantiene `team` siempre activa (una pestaña quieta del dashboard = 1 renovación ≈ cada 50 s); la página de un archivo
  suma `files/:id` (2 en total); y en Solicitudes cada tarjeta cuya imagen se está leyendo suma la suya mientras dura la
  lectura. El permiso vive 60 s (a confirmar en el spike) y se renueva **10 s antes**, con reintento cada 1 s, como
  el binding de React. La renovación se **pausa** con la pestaña oculta (`useDocumentVisibility`) o sin conexión (`useOnline`);
  al volver, el estado pasa a `stale` → renueva → `live`. Un 401 en la renovación activa una marca de módulo y una recarga
  completa **una sola vez**.
- **Razón**: minimiza invocaciones (−90 %) y costo por pestaña; el reintento acotado (≤ 10 intentos, de −10 s a 0 s) evita
  martillar un servidor caído (FR-018).
- **Alternativas**: un sellado por consulta (3× invocaciones); renovar con la pestaña oculta (consumo inútil, SC-005).

## C7. Sin binding de Vue: composable propio

- **Decisión**: no existe `@neon/realtime-vue`. Se escribe `useLiveQueries(sealFn, { enabled })` sobre
  `client.subscribe()`, con el calendario de C6. Devuelve por clave un `shallowRef` de filas, `status`
  (`connecting | live | stale | error`), `skew` y `retry()`; `onScopeDispose` cancela la suscripción. El cliente es **uno por
  aplicación** (las suscripciones comparten su conexión, y **una base por cliente**), creado de forma perezosa con
  `import('@neon/realtime/client')` dinámico (presupuesto de 250 KB, Constitución I) y **vuelto a crear tras un error de
  conexión** (`error` es final aun con `renew()`).
- **Razón**: el binding de React no sirve en Vue; el cliente de bajo nivel (`seal`, `subscribe`, `getSnapshot`, `onChange`,
  `onStateChange`) es la API documentada para otros frameworks.
- **Alternativas**: `@neon/realtime-react` (no aplica); envolver `useLiveQuery` con una isla React (dependencia enorme).
- **A confirmar en el spike**: esquema de URL que acepta el cliente (`https` → `wss` solo si lo exige), TTL real y analizadores
  de tipos de fecha (`parsers`) para que las fechas lleguen como texto ISO, igual que en SSR (spec, edge cases).

## C8. Avisos por diferencia de conjuntos de identificadores

- **Decisión**: la entrega de cada evento no está garantizada y una reconexión envía un reemplazo completo de `rows`. Los
  avisos salen de comparar **conjuntos de ids** entre instantáneas: se salta el primer resultado, se anuncia cada id nuevo una
  vez y se conserva el `announced` (un `Set` a nivel de módulo) para que un remontaje del layout no repita (hoy ya hace
  `usePulse.ts:20`). Reemplaza el cursor con solape (`PULSE_OVERLAP_MS`).
- **Razón**: es robusto ante eventos perdidos o duplicados; y el filtrado por caducidad ocurre antes de comparar.
- **Alternativas**: usar cada evento de cambio como aviso (se pierde o se repite al reconectar).

## C9. Identidad de la sesión en cada renovación (hueco del plan)

- **Decisión**: además del 401, la renovación comprueba que **la persona de la sesión sea la misma para la que se cargó la
  página**. El cliente envía en el cuerpo `expectedUserId` (el id que ya conoce de `useAuth`) y el servidor responde **409** si
  difiere de `event.context.sessionUser.id`; el cliente trata 401 y 409 igual: marca de módulo y `location.reload()` una vez.
  `expectedUserId` sale de `useMe().profile.userId`. **El invitado no lleva esta comprobación**: su identidad es su propia
  cookie, el servidor siempre sella la fila de la cookie del momento y solo puede ver su propia solicitud; no hay riesgo de
  datos ajenos (research C11).
- **Razón**: el skill de Realtime exige comprobar "en cada renovación y escritura que el usuario de la sesión es aquel para el
  que se cargó la página"; sin esto, si otra persona inicia sesión en otra pestaña, una renovación sella consultas de la
  persona nueva y la pantalla vieja recibe datos ajenos (FR-018, edge case "cambio de sesión").
- **Alcance**: la comprobación se aplica a las **renovaciones de sellado**. Las escrituras REST ya usan la cookie de sesión
  vigente (comportamiento actual, fuera de alcance); la ventana de riesgo queda acotada porque la siguiente renovación
  (≤ 50 s) fuerza la recarga.
- **Alternativas**: solo 401 (deja pasar el cambio de persona); recarga periódica (cara); huella del invitado en el cuerpo
  (innecesaria: ver arriba).

## C10. Las escrituras siguen siendo REST; las listas con URL firmada se vuelven a pedir por evento

- **Decisión**: dar acceso, rechazar, aprobar usuario, comentar y leer una imagen siguen siendo peticiones POST/PATCH. El
  resultado se refleja porque la fila sale o cambia en la suscripción. Donde la tarjeta necesita URL firmadas de miniaturas
  (`Solicitudes`) o datos enriquecidos (`Usuarios`), un `watch` del conjunto de ids de la vista en vivo dispara `refresh()`
  del `useFetch` existente (**refetch dirigido por evento**, no por reloj).
- **Razón**: las URL firmadas se generan en el servidor (Constitución I: los binarios no pasan por funciones) y las
  consultas en vivo no pueden firmarlas.
- **Alternativas**: firmar miniaturas en la consulta (imposible: son SQL); dejar `refreshPulse()` (se elimina con el pulso).

## C11. Invitado: sellado por cookie, sin base de datos, y nuevo sellado al cambiar de solicitud

- **Decisión**: `POST /api/public/access/live` lee la cookie con `readAccessTokenHash` y sella `guestAccessLive(tokenHash)`
  (`WHERE token_hash = $1`, solo los campos que necesita `accessStateOf`, **nunca** `token_hash`). Sin cookie → 401. No hace
  **ninguna** consulta a la base, así que no necesita limitador (se registra en `test/unit/endpoint-guards.spec.ts`).
  `useGuestAccess` conserva la primera carga con SSR (`current.get.ts`), el desfase de reloj de la cabecera `Date` y el reloj
  local de 1 s; reemplaza `poll` por una suscripción mientras el estado no sea final (`TERMINAL_ACCESS_STATES`); el estado es
  `accessStateOf(fila, ahora + skew)`.
- **Hueco del plan**: `request()` y `restart()` cambian el token de la cookie, así que la suscripción anterior (sellada con el
  hash viejo) deja de ver la solicitud nueva. Tras crearla hay que **volver a sellar y suscribirse** (`retry()`), y mientras
  tanto el estado local (`local`) cubre el hueco como hoy.
- **Razón**: cada invitado paga 0 consultas de lectura y obtiene la decisión al instante.

## C12. Cotas de las consultas y volumen

- **Decisión**: cada consulta lleva `LIMIT` (envíos listos 200, solicitudes de acceso 50 como en 003, cuentas pendientes 200,
  comentarios 500, texto de imagen 1 fila). Volumen real: decenas de solicitudes por domingo y unos cientos de envíos al mes
  (003). Si se alcanzara el tope, el contador muestra el tope (límite documentado).
- **Razón**: una suscripción sin cota enviaría un resultado inicial sin límite y contaría como *egress*.

## C13. Una sola definición de "listo por revisar" y "solicitud abierta" (Constitución IV)

- **Decisión**:
  - **Envíos listos**: el `FROM … JOIN … WHERE … GROUP BY` de `readyPendingSubmissionsSql` pasa a una **constante de fragmento
    SQL** (`server/utils/files.ts`) que usan el REST (`sql.raw`, sin parámetros) y la consulta en vivo; una prueba unitaria
    verifica que ambas la contienen.
  - **Solicitudes abiertas**: difieren por `expires_at > now()` (REST) frente al filtro del navegador (en vivo), porque la
    consulta en vivo no admite `now()` (C5). La equivalencia se verifica en e2e: el contador de la barra lateral coincide con
    `openAccessRequests` de `GET /api/dashboard` en el mismo momento.
- **Razón**: dos definiciones que divergen producen contadores distintos entre SSR y vivo.

## C14. Orígenes permitidos por rama

- **Decisión**: `allowed_origins` hoy es `[]` (cualquier origen) en las tres ramas. En la fase de cierre, con confirmación de la
  persona (cambia configuración y **reemplaza** la lista): desarrollo `http://localhost:3000`, pruebas `http://localhost:3100`
  (`E2E_PORT`), producción el dominio exacto de `NUXT_PUBLIC_SITE_URL` más el alias de vista previa que haga falta (≤ 16, sin
  comodines; **el dominio lo da la persona en ese paso**). Antes, comprobar sin imprimir valores que `NUXT_NEON_REALTIME_URL`
  de `.env.development` contiene `ep-wandering-base` y el de `.env.test`, `ep-rough-art`; y poner ambas variables en Vercel
  (Production = `ep-dry-mouse`, y Preview).
- **Razón**: una URL de datos en vivo apuntando a la rama equivocada leería o escribiría el entorno ajeno; y producción solo
  debe aceptar su propio origen. Las historias 1–3 corren con la lista abierta; **tras cerrar los orígenes se vuelven a
  correr las pruebas e2e** (T070).

## C15. Sin sondeo de respaldo; modo de fallo

- **Decisión**: el servicio es una **beta sin SLA** y el protocolo puede cambiar. Se fija la versión **exacta** de
  `@neon/realtime` (sin `^`). Si el canal falla: `ErrorState` con "Reintentar" (textos en `app/utils/messages.ts`); contadores,
  avisos y refrescos automáticos se detienen, pero subir, decidir y comentar siguen funcionando (son REST). Es el riesgo
  aceptado por la persona responsable (spec, Clarifications).
- **Alternativas**: sondeo de respaldo automático (reintroduce el consumo que se quiere eliminar y duplica código).

## C16. Medición de cómputo en dos momentos

- **Decisión**: (1) **Puerta G1** en la Fase 1, antes de construir (C2): demuestra que el canal más la renovación de sesión
  dejan dormir la base. (2) **Medición final** en Polish, con la feature completa: registrar `compute_time_seconds` y
  `active_time_seconds` de la rama `development` (MCP `list_branches`, solo lectura), dejar **una pestaña del dashboard
  visible y quieta 30 minutos**, volver a registrar. Esperado: antes ≈ 1 800 s activos; después ≤ ≈ 300–360 s. Informar ambos
  números, y leer las invocaciones de Vercel (Functions → Invocations) antes y después.
- **Razón**: descubrir en Polish que la base no duerme sería tarde.

## C17. Dependencia nueva y su justificación

- **Decisión**: una sola dependencia nueva, `@neon/realtime` (cliente y servidor), con versión exacta. Sin `@neon/realtime-drizzle`
  (C4) ni `@neon/realtime-react`. Se registra en **Complexity Tracking** del plan (Constitución II).
- **Alternativas**: ninguna sin nueva dependencia cumple el objetivo (WebSocket propio no es viable en Vercel, C1).

## C18. Qué se conserva

- `/api/dashboard` (resumen SSR) y `current.get.ts` (estado SSR del invitado y desfase de reloj).
- `useNow` de `CommentItem`, la cuenta atrás de 30 s de `AccessRequestCard` y el manejo de visibilidad de la cámara.
- El estampado de `created_at` con el reloj del servidor: sigue siendo correcto; solo cambia la razón en su comentario.
- Las decisiones, subidas y comentarios por REST, y toda la capa de autorización por endpoint.

## Qué se elimina (resumen; detalle en `tasks.md`, Polish)

- `server/api/realtime/pulse.get.ts`, `profileQuery` y `attachProfile` de `server/utils/session.ts` (se conserva `requireSessionUser`),
  el tipo `Pulse` (`shared/types/api.ts`), `usePulse.ts` y sus pruebas (portadas).
- `POLL_INTERVAL_MS`, `PULSE_OVERLAP_MS` (`shared/constants/files.ts:44-49`) y `TEXT_POLL_INTERVAL_MS`
  (`shared/constants/image-text.ts:16`). El retardo del reintento de `solicitudes.vue` pasa a `RETRY_DELAY_MS` propio.
- Los argumentos `since` de `readyPendingSubmissionsSql` y `openAccessRequestsSql` (ambas siguen sirviendo a `/api/dashboard`).
- `since` en `comments.get.ts`, `commentsQuery` y `listComments`; y `isoSince` (`shared/validation/core.ts:92`) si ya nadie lo usa.
