# Contrato de UI: Actualización en vivo sin sondeo

**Feature**: [spec.md](../spec.md) · **API**: [api.md](./api.md) · **Modelo**: [data-model.md](../data-model.md)

Reglas de siempre: mobile first (360 px base, `lg:` amplía), `btn` base (nunca `btn-sm`/`btn-xs` como base), iconos lucide,
colores solo con clases semánticas de daisyUI (sin `text-warning` sobre `base-100` en el tema claro), copy en
`app/utils/messages.ts`, errores HTTP con `serverMessage()`, y cuatro estados con `SkeletonList`/`EmptyState`/`ErrorState`.
Esta feature **no cambia el diseño** de las pantallas: solo de dónde salen los datos y los estados de conexión y error.

## Composables

### `useLiveQueries(sealFn, options)` (`app/composables/useLiveQueries.ts`, nuevo)

Une el cliente del SDK (`app/utils/realtime-client.ts`) con el calendario de renovación (research C6, C7).

```ts
function useLiveQueries<K extends string, Rows extends Record<K, unknown[]>>(
  sealFn: () => Promise<RealtimeSeal<K>>,    // un POST que sella todas las consultas de esta vista en vivo
  options?: {
    enabled?: MaybeRefOrGetter<boolean>
    /** Identidad de los parámetros de la vista (p. ej. el id del archivo). Si cambia, se cancela la suscripción y se sella de nuevo. */
    key?: MaybeRefOrGetter<string | number | null>
  },
): {
  rows: { [Key in K]: ShallowRef<Rows[Key] | undefined> }  // undefined hasta el primer resultado
  status: Ref<LiveStatus>                                  // 'connecting' | 'live' | 'stale' | 'error'
  skew: Ref<number | null>                                 // serverTime − Date.now(), de la respuesta de sellado
  retry: () => Promise<void>                               // sella de nuevo; cliente nuevo si falló la conexión
}
```

Reglas:

- **Un cliente por aplicación** (suscripciones compartidas, una base por cliente), creado de forma perezosa con
  `import('@neon/realtime/client')` dinámico (fuera del chunk de entrada, presupuesto de 250 KB).
- **Un sellado por vista en vivo** (no por página): `sealFn` sella todas las consultas de esa vista en un POST y la renovación
  lo llama de nuevo con **los mismos parámetros**. Una pestaña quieta del dashboard tiene una sola vista activa (`team`, en el
  layout); la página de un archivo suma la del archivo; cada panel de imagen en lectura suma la suya mientras dura.
- **Parámetros que cambian**: una suscripción nunca recibe parámetros nuevos por renovación. Si `key` cambia (p. ej. `useCommentThread`
  con otro `fileId` o `useImageText` con otro `endpoint`), `useLiveQueries` **cancela** la suscripción y los temporizadores,
  limpia `rows`, vuelve a `connecting` y sella de nuevo con los parámetros actuales; ninguna renovación en vuelo de la clave
  anterior puede aplicarse a la nueva. No se depende de que la página se vuelva a montar (hoy `NuxtPage` sí lo hace al cambiar
  `:fileId`, pero es un detalle del framework, no del contrato).
- **Renovación** a `expiresAt − 10 s`, reintento cada 1 s hasta `expiresAt`; pausada con `useDocumentVisibility()` ≠ `visible` o
  `useOnline()` = `false` (`status` = `stale`); al volver: renueva de inmediato → `live`.
- **401 o 409** en una renovación → marca de módulo y `window.location.reload()` **una sola vez**.
- **`enabled = false`** cancela la suscripción y libera el cliente de esa página (`useImageText`, `useGuestAccess` en estado final).
- `onScopeDispose` cancela suscripciones y temporizadores. Sin permisos en `localStorage`, `sessionStorage`, URL ni `useState`
  (que viajaría en el payload SSR): viven solo en memoria del cliente.
- Solo corre en el cliente (`import.meta.client`); en SSR devuelve `status = 'connecting'` y filas `undefined`, sin llamar al SDK.

### `useTeamLive()` (`app/composables/useTeamLive.ts`, nuevo; sustituye a `usePulse.ts`)

```ts
function useTeamLive(): {
  pendingCount: Ref<number>           // envíos listos por revisar
  openAccessRequests: Ref<number>     // solicitudes abiertas y vigentes (con skew)
  pendingUsers: Ref<number>           // cuentas pendientes (solo administrador; 0 para editor)
  accessRequests: ComputedRef<LiveAccessRequestRow[]>  // vigentes, para AccessRequestList
  submissionIds: Ref<string[]>        // para que Solicitudes haga refetch por evento
  userIds: Ref<string[]>              // para que Usuarios haga refetch por evento
  live: Ref<boolean>                  // ya hubo un primer resultado (Inicio pasa del resumen SSR a lo vivo)
  status: Ref<LiveStatus>
  retry: () => Promise<void>
}
```

- Se monta **una sola vez** en `app/layouts/dashboard.vue`; las páginas lo leen con el mismo `useTeamLive()` (estado en
  `useState`, compartido).
- Avisos (`useToast().info(...)` con acción "Ver" → `/solicitudes`) por **diferencia de conjuntos de ids**: el primer resultado
  no avisa; `announced` a nivel de módulo evita repetir tras reconexión o remontaje (research C8, data-model).
- Textos existentes: `messages.submissions.received(nombre, n)` y `messages.access.requested(nombre)`.

### Consumidores que cambian (US1)

| Archivo | Cambio |
|---------|--------|
| `app/layouts/dashboard.vue` | `useTeamLive()` en lugar de `usePulse()` + `usePulsePolling()`; badges `/solicitudes` = `pendingCount + openAccessRequests`, `/usuarios` = `pendingUsers`; `LiveStatusBanner` cuando `status === 'error'` |
| `app/pages/index.vue` | pasa del resumen SSR a lo vivo cuando `live` es verdadero (hoy espera `cursor`) |
| `app/pages/solicitudes.vue` | `watch(submissionIds, refresh)` (refetch dirigido por evento: las tarjetas necesitan URL firmadas); sin `refreshPulse()`; el reintento tras una recarga fallida usa `RETRY_DELAY_MS` propio |
| `app/components/guests/AccessRequestList.vue`, `AccessRequestCard.vue` | se dibujan directamente de `accessRequests`; "Dar acceso" y "Rechazar" siguen siendo POST y la fila sale por la suscripción; sin `refreshPulse()`; se conserva la cuenta atrás de 30 s |
| `app/pages/usuarios.vue`, `app/composables/useUserAdmin.ts` | `watch(userIds, refresh)`; sin `refreshPulse()` |

### `useGuestAccess()` (modificado, US2)

Conserva la primera carga con SSR (`current.get.ts`), el desfase de reloj (`Date`), el reloj local de 1 s, `request()`,
`restart()`, `holdWhileUploading()` y toda la API que lee `app/pages/upload.vue`. **Cambia solo cómo se actualiza**:

- Reemplaza `poll` + `useIntervalFn` por `useLiveQueries(() => $fetch('/api/public/access/live', { method: 'POST' }), { enabled: () => !terminal.value })`.
- Estado = `accessStateOf(fila, ahora + skew)`; sin fila → `none`. `local` (respuesta del POST) cubre el hueco hasta el primer
  resultado, como hoy.
- Tras `request()` y `restart()` que crean una solicitud, llama a `retry()` (cambió el token de la cookie; research C11).
- Estado final (`TERMINAL_ACCESS_STATES`) → `enabled = false`: no queda canal ni temporizador.
- La región `role="status" aria-live="polite"` y todos los textos de los 9 estados de `/upload` no cambian.

### `useCommentThread()` y `useImageText()` (modificados, US3)

- `useCommentThread(fileId, target)`: la carga inicial REST no cambia (`useApiFetch`, para el 404/409 y el SSR del estado
  vacío); suscripción mientras `useElementVisibility(target)`. El comentario propio se inserta con la respuesta del POST y se
  **fusiona por id** con lo que llegue en vivo (sin duplicar); editar y borrar llegan por reemplazo de `rows`. Sin `since`.
  `canEdit`/`canDelete` se derivan en el cliente (`authorId === me.userId`, `isAdmin`).
- `useImageText(endpoint, options)`: la carga inicial y la lectura de respaldo no cambian (REST); mientras `status === 'reading'`
  se suscribe (`enabled`), y al llegar a un estado final se cancela. El DTO visible es `imageTextOf(fila, ahora + skew)`,
  de modo que una lectura atascada pasa a `failed/timeout` a los 90 s sin cambio en la base.

## Componente nuevo

### `LiveStatusBanner` (`app/components/LiveStatusBanner.vue`, US1)

Visible solo cuando `useTeamLive().status === 'error'` (en el layout del equipo, sobre el contenido).

- `alert alert-warning` con icono `lucide:wifi-off`, el texto `messages.live.stopped` y un botón `btn` base (no `btn-sm`)
  "Reintentar" que llama a `retry()` (objetivo táctil ≥ 44 px).
- `role="status"` (no interrumpe); desaparece al volver a `live`.

## Cuatro estados de las vistas en vivo

| Vista | Conectando | Vacío | Error con reintento | Contenido |
|-------|-----------|-------|---------------------|-----------|
| Solicitudes (solicitudes de acceso + envíos) | `SkeletonList` (hoy) | `EmptyState` (hoy) | `ErrorState` con "Reintentar" (hoy) + `LiveStatusBanner` si solo falla lo en vivo | tarjetas |
| Usuarios (pendientes) | `SkeletonList` | `EmptyState` | `ErrorState` | lista |
| Hilo de comentarios | `SkeletonList` (carga REST) | `EmptyState` | `ErrorState` (REST o en vivo) | hilo |
| Panel de texto de imagen | esqueleto del panel | "Sin texto" (hoy) | mensaje de error con "Reintentar" (hoy) | texto |
| `/upload` | `SkeletonList` | — | `ErrorState` con "Reintentar" | estado del invitado |

Un fallo **solo** del canal en vivo no vacía la pantalla: se conserva lo último mostrado (`stale`/`error` mantienen las filas) y
se añade el banner; no se sustituye el contenido por un error a menos que no haya habido nunca un resultado.

## Copy (`app/utils/messages.ts`, nuevo bloque `live`)

| Clave | Texto | Dónde |
|-------|-------|-------|
| `messages.live.stopped` | "Las actualizaciones en vivo se detuvieron. Reintenta para volver a recibirlas." | `LiveStatusBanner` |
| `messages.live.retry` | "Reintentar" | botón del banner |
| `messages.live.unavailable` | "No pudimos conectar las actualizaciones en vivo. Revisa tu conexión e inténtalo de nuevo." | `ErrorState` de `/upload`, hilo y panel |
| `messages.live.reconnected` | "Actualizaciones en vivo restablecidas" | toast corto al volver de `error` a `live` |

Los textos de avisos de envíos y solicitudes, y todo el copy de `/upload`, **no cambian**. Los errores HTTP de las rutas de
sellado (401/409/503) se manejan en el composable (recarga o `status = 'error'`) y se muestran con los textos de arriba; no se
usa `data.message` directo (`serverMessage()` si se muestra alguno).

## Accesibilidad y movimiento

- El banner usa `role="status"`; los avisos del equipo siguen siendo toasts (`aria-live` de `useToast`); el estado del invitado
  sigue anunciándose en `/upload` (FR-007).
- Foco visible y navegación por teclado sin cambios; "Reintentar" es un `button` real con etiqueta visible.
- `prefers-reduced-motion`: los esqueletos y el indicador `loading-dots` ya respetan la preferencia; no se agregan animaciones.
- Contraste ≥ 4.5:1 en ambos temas (el banner usa los tokens de `alert-warning`, no `text-warning` sobre `base-100`).
