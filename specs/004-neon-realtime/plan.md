# Implementation Plan: Actualización en vivo sin sondeo

**Branch**: `004-neon-realtime` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-neon-realtime/spec.md` · Plan de origen: `neon-realtime-migration-plan.md`

## Summary

Cloudy simula el tiempo real preguntando al servidor cada 3 o 5 s (pulso del equipo, estado del invitado en `/upload`, hilo
de comentarios, lectura de imágenes). Cada pregunta cuesta una invocación de Vercel y una ida a Neon, y como llega antes de los
5 minutos de suspensión, la base **no puede dormirse mientras una pestaña del equipo esté visible**. Esta feature sustituye
todo ese sondeo por **consultas en vivo de Neon Realtime**: el servidor sella consultas de solo lectura, el navegador se
suscribe y recibe los cambios cuando ocurren (< 2 s), y cada vista en vivo solo renueva su permiso de lectura ≈ cada 50 s.

**Enfoque técnico**:
- **Una frontera por lado** (Constitución IV): `server/utils/realtime.ts` es la única puerta a `@neon/realtime/server` (sellado) y
  `app/utils/realtime-client.ts` la única a `@neon/realtime/client` (cargado de forma diferida) (research C7, C17).
- **Sellado local, sin base**: las rutas `/api/realtime/**` leen solo la sesión de la cookie firmada y sellan con Web Crypto; la
  **autorización va dentro del SQL** (guarda `EXISTS … profiles`, roles generados desde `shared/permissions.ts`), lo que da
  revocación en vivo (C2, C3).
- **Consultas deterministas con `rawSql`**: sin `now()`; las vigencias se filtran en el navegador con el desfase de reloj, con
  funciones puras compartidas (`accessStateOf` ya existe; **`imageTextOf` se extrae** para que una lectura atascada pase a error a
  los 90 s sin cambio en la base) (C4, C5).
- **Un sellado por vista en vivo** (una pestaña quieta del dashboard = 1 renovación ≈ cada 50 s; cada vista adicional suma la
  suya), renovación 10 s antes con reintento de 1 s, pausada con la pestaña oculta o sin conexión, y `key` para cancelar y volver
  a sellar si cambian los parámetros; **401 o 409 (otra persona en la sesión) → recarga completa única** (C6, C9).
- **Composable propio** `useLiveQueries` sobre `client.subscribe()` (no existe binding de Vue) y `useTeamLive` que sustituye a
  `usePulse` con avisos por **diferencia de conjuntos de ids** (C7, C8).
- **Las escrituras siguen por REST**; donde la tarjeta necesita URL firmadas, un `watch` de ids dispara el `refresh()` existente
  (C10). El resumen SSR (`/api/dashboard`) y `current.get.ts` se conservan (C18).
- **Sin sondeo de respaldo** y versión **exacta** del SDK: el servicio es una beta sin SLA; si falla, `ErrorState`/banner con
  "Reintentar" (C15).
- **Puerta G1** (Fase 1, go/no-go): antes de construir se demuestra que el canal **más** la caché de sesión de 5 min dejan dormir
  la base (C2, C16); si no, la persona decide el rumbo.

## Technical Context

**Language/Version**: TypeScript 5 (estricto) · Vue 3.5 · Nuxt 4.6 (Nitro 2, h3 1) · Bun (local) / Node 22 (Vercel)

**Primary Dependencies**:
- **Una dependencia nueva**: `@neon/realtime` (cliente y servidor), versión **exacta** (Complexity Tracking). Sin
  `@neon/realtime-drizzle` ni `@neon/realtime-react`.
- **Reutilizadas**:
  - Servidor: `session.ts` (`requireSessionUser`, nuevo `requireSameUser`), `validation.ts` (`readValid`, `paramId`),
    `access-requests.ts` (`readAccessTokenHash`), `files.ts` (fragmento SQL de envíos listos) y `shared/permissions.ts`.
  - Cliente: `useMe`, `useToast`, `useRelativeTime`, `useApiFetch`, `SkeletonList`, `EmptyState`, `ErrorState`.
  - VueUse: `useDocumentVisibility`, `useOnline`, `useElementVisibility`, `useIntervalFn` (reloj local de 1 s) y `useTimeoutFn`.
  - Funciones puras compartidas: `accessStateOf` (`shared/constants/access.ts`) e `imageTextOf` (nueva, `shared/`).

**Storage**: **Neon Postgres sin cambios de esquema ni migración** ([data-model.md](./data-model.md)). Bucket sin cambios.
Las consultas leen `profiles`, `guest_submissions`, `guest_submission_files`, `guest_access_requests`, `files` y `comments`,
todas con clave primaria (identidad de réplica estable).

**Testing**: Vitest con los proyectos `unit`, `nuxt` y `e2e`.
- Unit: constructores de consultas (guardas, sin `now()`/`;`), selladores, rutas de sellado (401/409/422/503 y **sin `useDb`**),
  middleware, `imageTextOf`, `rolesAllowed`, arquitectura.
- Nuxt: cliente falso `test/nuxt/helpers/fake-realtime.ts` (renovación, pausa, 401/409, error→reintento, diferencia de ids).
- E2E: contra la rama de pruebas con su propia configuración de datos en vivo (`.env.test`, `E2E_PORT` 3100); OpenRouter sigue
  simulado con el stub local.

**Target Platform**: Vercel (preset `vercel`, Node) y navegadores desde 360 px. WebSocket saliente del navegador a la URL de
Realtime de cada rama; **orígenes permitidos por rama** (producción exactos).

**Project Type**: Aplicación web full-stack, el mismo proyecto Nuxt (`app/`, `server/`, `shared/`).

**Performance Goals** (spec SC-001–SC-008):
- Novedad al equipo, decisión al invitado y comentario ajeno en **< 2 s**.
- Pestaña visible y quieta: 0 peticiones periódicas cortas; ≈ 72 invocaciones/h (−90 %) y 0 consultas a la base en reposo.
- Con una pestaña quieta 30 min en `development`: tiempo activo de ≈ 1 800 s a ≤ ≈ 360 s.
- JS inicial por ruta ≤ 250 KB gzip (la biblioteca en vivo, diferida).

**Constraints**:
- Funciones sin estado: ningún estado compartido en memoria del servidor; el cliente de Realtime vive en el navegador.
- El permiso sellado es un *bearer token* de ≈ 60 s: solo en cuerpos de respuesta, nunca en URL, registros, almacenamiento ni SSR.
- Consultas de una sola sentencia `SELECT`, deterministas (sin `now()`), con `LIMIT`.
- Secretos solo en `runtimeConfig` (`NUXT_NEON_REALTIME_SECRET`, privado); la URL del canal sale del servidor en la respuesta de
  sellado para que los nombres de variables no cambien.
- Beta sin SLA: sin sondeo de respaldo.

**Scale/Scope**:
- Servidor: **4 rutas nuevas** de sellado, 2 módulos nuevos (`realtime.ts`, `live-queries.ts`), 3 archivos modificados
  (`session.ts`, `middleware/session.ts`, `files.ts`) y, en Polish, 1 ruta eliminada y 4 parámetros `since` retirados.
- Cliente: 1 componente nuevo (`LiveStatusBanner`), 3 composables nuevos (`useLiveQueries`, `useTeamLive` y la utilidad
  `realtime-client`), 5 composables/páginas modificados y 6 páginas/componentes rewireados.
- 3 historias: US1 (P1, MVP) equipo en vivo; US2 (P2) invitado en vivo; US3 (P3) comentarios e imágenes en vivo.
- 75 tareas en 6 fases (`tasks.md`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluado contra la constitución **v1.1.0**.

| Principio | Pre-diseño | Post-diseño: cómo se cumple |
|-----------|------------|-----------------------------|
| **I. Rendimiento** | ✅ | Ver el detalle bajo la tabla. |
| **II. Funcional y efectivo** | ✅ | Ver el detalle bajo la tabla. |
| **III. Mobile first** | ✅ | No hay pantallas nuevas: solo `LiveStatusBanner` (`alert` + botón `btn` base de 45 px, a lo ancho en 360 px) y estados de conexión/error en las pantallas existentes. Nada depende de `hover`. Verificación a 360 px y ≥ 1280 px (quickstart §3, T073). |
| **IV. Calidad de código** | ✅ | Ver el detalle bajo la tabla. |
| **V. Pruebas** | ✅ | Ver el detalle bajo la tabla. |
| **VI. Consistencia de UX** | ✅ | Ver el detalle bajo la tabla. |
| **Restricciones técnicas** | ✅ | Ver el detalle bajo la tabla. |
| **Flujo y gates** | ✅ | Rama `004-neon-realtime` (creada por la persona; parte de la punta de `003-public-photos-upload`, `b8b9892`). Conventional Commits. DoD de AGENTS.md por fase (typecheck → tests → navegador). Se rebasa sobre `main` cuando se integre 003. |

**Detalle de los principios**:

- **I. Rendimiento**:
  - Presupuesto de JS: `@neon/realtime/client` se carga con `import()` dinámico dentro de `realtime-client.ts` (fuera del chunk de
    entrada); la ruta más pesada de 003 mide ≈ 158 KiB gzip, así que queda margen bajo los 250 KB (T071 lo mide con `analyze`).
  - El objetivo de la feature **es** rendimiento: −90 % de invocaciones, −100 % de consultas en reposo y la base que puede
    dormir (SC-006, SC-007). Se demuestra con la puerta G1 y la medición final (T004, T074).
  - Sin consultas nuevas por petición: cada consulta en vivo usa índices ya existentes (data-model) y lleva `LIMIT`; sin N+1.
  - Binarios sin cambios (URL firmadas); las miniaturas de Solicitudes se piden por evento con el `refresh()` existente.
  - La primera vista sigue con SSR (`/api/dashboard`, `current.get.ts`); lo en vivo solo se activa tras hidratar.
- **II. Funcional y efectivo**:
  - 3 historias desplegables por separado, en orden de prioridad: US1 (equipo, MVP), US2 (invitado), US3 (archivo). El sondeo
    se retira solo en Polish, cuando ya no tiene consumidores.
  - YAGNI: sin escrituras optimistas, presencia, TanStack DB ni sondeo de respaldo (spec, "Fuera de alcance"); sin
    `@neon/realtime-drizzle` ni binding de React; el componente nuevo (`LiveStatusBanner`) existe porque sin él los contadores se
    congelarían en silencio si el canal falla.
  - Reutilización antes que código nuevo: VueUse para visibilidad/conexión, `useApiFetch`/`refresh()` para los refetch por
    evento, `accessStateOf` para el invitado, `ErrorState`/`SkeletonList`/`EmptyState` para los estados.
  - Sin huérfanos ni filas a medias: la feature **no escribe** en la base. Si el canal falla, las escrituras REST siguen y la
    pantalla dice cómo seguir ("Reintentar").
- **IV. Calidad de código**:
  - **Frontera única y verificada**: `realtime.ts` (servidor) y `realtime-client.ts` (cliente) son las únicas puertas al SDK;
    `architecture.spec.ts` lo hace cumplir (T065). Ninguna ruta de sellado importa `useDb`.
  - **Reglas compartidas una sola vez en `shared/`**: roles de las guardas desde `rolesAllowed` (no escritos a mano en el SQL),
    `accessStateOf` e `imageTextOf` para la hora, `sealInput` para la entrada y `LiveStatus`/`RealtimeSeal` para los tipos.
  - **Dos definiciones de "listo por revisar" y "solicitud abierta"** (REST y en vivo): el fragmento SQL de envíos listos es
    **una constante compartida** con prueba; las solicitudes difieren solo por `now()` (en vivo se filtra en el navegador) y se
    verifica en e2e que el badge coincide con `GET /api/dashboard` (research C13, T023, T027).
  - **Todo endpoint valida y autoriza en el servidor**: las rutas de sellado validan el cuerpo y exigen sesión; la autorización
    de **datos** está dentro del SQL de cada consulta y se prueba (guarda presente, `$1` = id de la sesión, sin `now()`/`;`, sin
    `token_hash`). El 200 de una cuenta sin rol no entrega filas (api.md, "Matriz de acceso").
  - **Identidad**: 401 y 409 (`expectedUserId`) fuerzan una recarga única; nunca se mezclan datos de dos personas (C9).
  - Sin `any`; sin código muerto: el pulso, sus constantes, tipos y parámetros `since` se eliminan (T062–T064).
- **V. Pruebas**:
  - **Unit**: constructores, selladores, rutas (401/409/422/503, **sin `useDb`**), middleware, `rolesAllowed`, `imageTextOf`
    (límite exacto de 90 s), arquitectura y `endpoint-guards`.
  - **Componente**: `useLiveQueries` (renovación, pausa, 401/409, error→reintento, cliente nuevo), `useTeamLive` (diferencia de
    ids, sin repetir tras reconexión), `useGuestAccess`, hilo y texto de imagen, `LiveStatusBanner`, con el cliente falso.
  - **E2E en cada historia** (no solo en Polish): `team-live`, `access-upload`, `guest-queue`, `users`, `comments`,
    `image-text` y `routes-guard`, sin esperas de 3/5 s; y de nuevo con los orígenes cerrados (T070).
  - **Cobertura**: umbral del proyecto 92 % sin bajarlo y **cada archivo nuevo ≥ 90 %** por métrica (T072). Las pruebas del
    pulso se portan, no se descartan.
  - Todos los tests seleccionan con `getByRole`/`getByLabel`; los e2e solo tocan la rama de pruebas con identidades únicas por corrida.
- **VI. Consistencia de UX**:
  - Cuatro estados en cada vista en vivo con `SkeletonList`/`EmptyState`/`ErrorState` (contracts/ui.md) y banner `role="status"`
    para el fallo del canal sin vaciar la pantalla.
  - Textos en español en `app/utils/messages.ts` (bloque `live`); errores HTTP solo con `serverMessage()`.
  - Colores solo con tokens (`alert-warning`; sin `text-warning` sobre `base-100`), iconos lucide, foco visible y `prefers-reduced-motion`.
  - Los avisos al equipo siguen siendo toasts con acción "Ver"; el estado del invitado sigue anunciándose a lectores de pantalla.
- **Restricciones técnicas**:
  - **Sin estado en el servidor**: sellar es una función pura de (sesión, secreto); el cliente de Realtime vive en el navegador.
  - **Secretos**: `NUXT_NEON_REALTIME_SECRET` privado en `runtimeConfig`; la URL del canal no es secreta y sale de la respuesta de
    sellado. Los permisos sellados nunca van en URL, registros ni almacenamiento.
  - **Datos**: sin migración ni cambio de esquema (`db:generate` no debe producir archivos).
  - **Privacidad**: el invitado sigue guardando solo nombre y nota; la consulta del invitado nunca selecciona `token_hash` ni datos del equipo.

**Riesgo de plataforma identificado (Constitución II, "flujos fallidos")**: el servicio es una beta sin SLA; si cae, las
pantallas muestran el banner/`ErrorState` con "Reintentar" y todo lo que escribe sigue funcionando por REST. No se conserva un
sondeo de respaldo por decisión de la persona responsable.

## Puerta G1 (go/no-go antes de construir)

Hecho verificado: `fetchSession` usa la caché firmada `session_data` de **5 minutos** y, al caducar, llama a Neon Auth
(`get-session`) y la vuelve a firmar (`server/utils/auth.ts:34-49`). Si esa llamada despierta el cómputo, una renovación cada
≈ 50 s la dispararía cada 5 minutos —justo el tiempo de suspensión— y la base seguiría despierta aunque se elimine el sondeo.

- **Cuándo**: Fase 1 (T004), **antes** de escribir código de producción.
- **Qué se mide** (solo lectura, con permiso de la persona; detalle en `quickstart.md` §4): (1) una suscripción abierta > 10 min
  deja suspender el cómputo de `development`; (2) un `get-session` tras caducar la caché **no** lo despierta.
- **Si falla**: detenerse y preguntar a la persona cuál de las opciones de research C2 sigue (verificador de solo cookie con
  tope documentado y revisión de seguridad, renovar la sesión solo con interacción, conservar la feature **sin** SC-007, o
  abandonar). Este plan no elige.

## Project Structure

### Documentation (this feature)

```text
specs/004-neon-realtime/
├── plan.md              # Este archivo
├── spec.md              # Qué y por qué (agnóstico de tecnología)
├── research.md          # Decisiones C1–C18, hechos del código, resultados del spike y de G1
├── data-model.md        # Sin migración; consultas en vivo, guardas, estados, diferencia de ids
├── quickstart.md        # Validación: pruebas, escenarios manuales, medición de cómputo
├── contracts/
│   ├── api.md           # 4 rutas de sellado; rutas y parámetros que se eliminan; matriz de acceso
│   └── ui.md            # Composables, consumidores, LiveStatusBanner, cuatro estados, copy
├── checklists/
│   ├── requirements.md          # Calidad de la especificación
│   └── verification-scorecard.md # 17 verificaciones de la barra ≥ 90 %
└── tasks.md             # 75 tareas en 6 fases
```

### Source Code (repository root)

```text
shared/
├── permissions.ts                       # + rolesAllowed(action)
├── image-text-state.ts                  # NUEVO: imageTextOf(row, now) (extraído del servidor)
├── validation/realtime.ts               # NUEVO: sealInput
├── types/api.ts                         # + LiveStatus, RealtimeSeal, filas en vivo; − Pulse (Polish)
└── constants/{files,image-text}.ts      # − POLL_INTERVAL_MS, PULSE_OVERLAP_MS, TEXT_POLL_INTERVAL_MS (Polish)

server/
├── utils/
│   ├── realtime.ts                      # NUEVO: única frontera con @neon/realtime/server (sealAll, rawSql)
│   ├── live-queries.ts                  # NUEVO: constructores rawSql con guarda y sin now()
│   ├── session.ts                       # + requireSameUser; − profileQuery/attachProfile (Polish)
│   ├── files.ts                         # fragmento SQL compartido de envíos listos
│   ├── image-text.ts                    # toImageText reutiliza imageTextOf
│   └── comments.ts                      # − since (Polish)
├── middleware/session.ts                # DEFERRED_PROFILE → ['/api/realtime/']
└── api/
    ├── realtime/
    │   ├── team.post.ts                 # NUEVO
    │   ├── files/[id].post.ts           # NUEVO
    │   ├── submissions/[id]/files/[fileId]/text.post.ts  # NUEVO
    │   └── pulse.get.ts                 # ELIMINADO (Polish)
    ├── public/access/live.post.ts       # NUEVO
    └── files/[id]/comments.get.ts       # − ?since (Polish)

app/
├── utils/
│   ├── realtime-client.ts               # NUEVO: cliente único y perezoso (import() dinámico)
│   └── messages.ts                      # + bloque live
├── composables/
│   ├── useLiveQueries.ts                # NUEVO
│   ├── useTeamLive.ts                   # NUEVO (sustituye a usePulse.ts, ELIMINADO en Polish)
│   ├── useGuestAccess.ts                # poll → suscripción
│   ├── useCommentThread.ts              # sondeo → suscripción
│   ├── useImageText.ts                  # sondeo → suscripción mientras `reading`
│   └── useUserAdmin.ts                  # − refreshPulse
├── components/
│   ├── LiveStatusBanner.vue             # NUEVO
│   └── guests/{AccessRequestList,AccessRequestCard}.vue   # desde filas en vivo
├── layouts/dashboard.vue                # useTeamLive + banner
└── pages/{index,solicitudes,usuarios,upload}.vue          # rewireados

test/
├── unit/                                # live-queries, realtime, api-realtime-*, api-access-live, image-text-state,
│                                        # validation-realtime, permissions, server-session, architecture, endpoint-guards
├── nuxt/                                # helpers/fake-realtime, useLiveQueries, useTeamLive, LiveStatusBanner,
│                                        # useGuestAccess/pages-upload, comments, ImageTextPanel, + pruebas del pulso portadas
└── e2e/                                 # team-live (nuevo); access-upload, guest-queue, users, comments, image-text, routes-guard
```

**Structure Decision**: mismo proyecto Nuxt. Cada lado tiene una sola frontera con el SDK (`server/utils/realtime.ts`,
`app/utils/realtime-client.ts`); los constructores de consultas viven aparte (`server/utils/live-queries.ts`) para probarlos como
SQL puro; las reglas de tiempo y permisos viven en `shared/`. Los constructores y rutas de sellado de cada vista se implementan
en la historia que los usa (no todos en la fundación) para que cada historia sea desplegable sola.

## Gestión de entornos y operación

- **Orígenes permitidos**: hoy `[]` (cualquier origen) en las 3 ramas. Las historias 1–3 corren con la lista abierta; en Polish
  (T069, con permiso y el dominio de producción dado por la persona) se fijan por rama y se repiten los e2e (T070).
  Reversión: restablecer la lista a `[]`.
- **Variables**: `NUXT_NEON_REALTIME_URL` y `NUXT_NEON_REALTIME_SECRET` ya existen en `.env.development` y `.env.test` y se mapean
  en `nuxt.config.ts:25-26`; faltan en Vercel Production y Preview (la persona las carga, T068). Comprobación sin imprimir
  valores: URL de desarrollo con `ep-wandering-base`, de pruebas con `ep-rough-art`, de producción con `ep-dry-mouse`.
- **Estado verificado el 2026-10-31 (solo lectura)**: proyecto `produccion` (`spring-voice-56232422`) en `aws-us-east-2`
  (región admitida), replicación lógica activa y Realtime **habilitado** en las 3 ramas (producción `br-shy-leaf-ae84dgvc`,
  desarrollo `br-lucky-paper-ae1kdk6t`, pruebas `br-patient-wind-aejizcd5`). El `TRUNCATE` del e2e
  (`test/e2e/setup/global-setup.ts`) no toca la configuración de Realtime.
- **Reversión de la feature**: la 003 no se toca; `git revert` del merge de 004. La configuración de Neon es aditiva (el código la
  ignora). Sin migración.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| La renovación de sesión (caché de 5 min) mantiene despierta la base y anula SC-007 | **Puerta G1** antes de construir; opciones de research C2; la persona decide |
| Beta sin SLA, protocolo cambiante | Versión exacta (T002); `ErrorState`/banner con "Reintentar"; escrituras por REST; sin sondeo de respaldo (decisión de la persona) |
| Entrega de eventos no garantizada / reemplazo `rows` al reconectar | Avisos por diferencia de conjuntos de ids; `announced` a nivel de módulo (C8) |
| Una lectura de imagen atascada no emite ningún cambio | `imageTextOf` compartida con `READING_STALE_MS`; el cliente resuelve el 90 s con el desfase de reloj (C5, T049, T053) |
| El invitado pide un acceso nuevo y su suscripción apunta al token viejo | `retry()` tras `request()`/`restart()` (C11, T042, T046) |
| Otra persona inicia sesión en otra pestaña y la vieja recibe datos ajenos | `expectedUserId` → 409 → recarga única (C9, T008, T010) |
| Una cuenta desactivada sigue renovando | La guarda está en el SQL: recibe 0 filas desde el siguiente cambio (C3); probado en e2e (T027) |
| Contadores distintos entre el resumen SSR y lo en vivo | Fragmento SQL compartido y e2e que compara el badge con `/api/dashboard` (C13, T023, T027) |
| El permiso sellado es un *bearer token* | Solo en cuerpos POST, `no-store`, nunca en URL/registros/almacenamiento/SSR; pruebas en T007, T010 y T022 |
| Una consulta sin tope infla el *egress* | `LIMIT` en cada consulta (C12) |
| URL de datos en vivo apuntando a la rama equivocada | Comprobación entorno↔rama sin imprimir valores (T068, quickstart §1) |
| Retirar el sondeo antes de tiempo rompe un consumidor | Polish solo tras US3; `grep` de cero referencias (T062–T064) |
| Reintento de renovación martilla un servidor caído | Reintento de 1 s acotado a ≤ 10 intentos (de −10 s a 0 s); luego `error` (C6, FR-018) |

## Complexity Tracking

| Dependencia | Por qué | Costo y alternativa descartada |
|-------------|---------|--------------------------------|
| `@neon/realtime` (cliente `@neon/realtime/client` y servidor `@neon/realtime/server`), versión **exacta** | Es lo único que entrega los cambios de una consulta SQL desde el motor incremental de Postgres sin que las funciones de Vercel (sin estado, sin conexiones largas) mantengan sockets, y es lo que permite que la base duerma mientras una pestaña está abierta. Sustituye ≈ 4 sondeos propios (`usePulse`, `useGuestAccess`, `useCommentThread`, `useImageText`) y la lógica de cursor con solape. | Servicio en **beta sin SLA** y protocolo cambiante: se mitiga fijando la versión, con `ErrorState`/banner y sin sondeo de respaldo (decisión de la persona). Sin costo durante la beta; precio posterior no publicado. El cliente se carga de forma diferida (presupuesto de 250 KB). Descartadas: seguir con el sondeo (mantiene la base despierta), SSE/WebSocket propio (inviable en Vercel), Neon Functions + push (no es para filas de la base), una librería de sincronización de terceros (dependencia y servicio nuevos), `@neon/realtime-drizzle` (exige claves iguales a las columnas y el esquema usa camelCase; una dependencia más) y `@neon/realtime-react` (no aplica a Vue). |

## Siguientes pasos

1. `/speckit-analyze` (consistencia entre spec, plan y tasks) y revisión de la persona.
2. Tras su visto bueno, `/speckit-implement`, empezando por la **puerta G1** (T001–T004).
