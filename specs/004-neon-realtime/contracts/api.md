# Contrato de API: Actualización en vivo sin sondeo

**Feature**: [spec.md](../spec.md) · **Modelo**: [data-model.md](../data-model.md)

Convenciones existentes: validación con `readValid`/`paramId` (`server/utils/validation.ts`), errores `createError` con `message`
en español (el cliente siempre usa `serverMessage()`), y guardas por endpoint. Esta feature **no agrega rutas de lectura de
datos**: agrega 4 rutas que **sellan** consultas (devuelven un permiso de lectura temporal, no datos) y quita una.

## Reglas comunes de las rutas de sellado

- **Método**: siempre `POST` (el permiso solo viaja en cuerpos de respuesta, nunca en una URL; spec FR-020).
- **Cabeceras de respuesta**: `Cache-Control: no-store`. El cuerpo con los permisos **nunca** se registra (sin `console.log`, sin
  registro de actividad) ni se incluye en el payload SSR.
- **Sin acceso a la base de datos**: ninguna ruta de sellado llama a `useDb()` ni a `ensureProfile` (la prueba de cada endpoint
  falla si se invoca `useDb`). Sellar es criptografía local; la autorización va dentro del SQL (research C2, C3).
- **Respuesta 200** (`RealtimeSeal<K>`, data-model):

  ```ts
  {
    url: string          // URL del canal en vivo, de runtimeConfig.neonRealtimeUrl (privado); no es secreta
    serverTime: string   // ISO: hora del servidor, para calcular el desfase de reloj (research C5)
    expiresAt: string    // ISO: serverTime + vigencia del permiso (≈ 60 s; confirmada en el spike)
    queries: Record<string, SealedQuery>  // una por clave de vista; opacas para el navegador
  }
  ```

- **`debugMode`** del SDK solo en desarrollo (`import.meta.dev`); en producción los errores de la base no se detallan.
- **503** `{ message: 'El servicio en vivo no está disponible. Intenta de nuevo en un momento' }` si falta
  `neonRealtimeSecret` o `neonRealtimeUrl` (servicio no configurado). El cliente muestra `ErrorState` con "Reintentar".
- **409** `data: { reason: 'session-changed' }` si `expectedUserId` no es el id de la sesión (research C9). El cliente
  trata 401 y 409 igual: recarga completa una sola vez.

## Equipo (sesión)

### `POST /api/realtime/team`: vistas en vivo del equipo (FR-001–FR-006)

- **Auth**: solo sesión (`requireSessionUser`, resuelta por el middleware con perfil diferido); sin sesión → **401**
  `{ message: 'Inicia sesión para continuar' }`.
- **Body**: `{ expectedUserId: string }` (`sealInput`, data-model "Validación").
- **Flujo**: valida el cuerpo; compara `expectedUserId` con la sesión (409); sella en **un** llamado las 3 consultas con
  `$1 = sessionUser.id`.
- **200** → `RealtimeSeal<'submissions' | 'accessRequests' | 'pendingUsers'>`.
- **No** exige rol: una cuenta pendiente o sin rol recibe 0 filas (la guarda está en el SQL); el contador de Usuarios para un
  editor es 0 por la misma razón.
- **Errores**: 401, 409, 422 cuerpo inválido, 503.

### `POST /api/realtime/files/:id`: comentarios y texto de un archivo (FR-011, FR-012, FR-014, FR-015)

- **Auth**: solo sesión (401). **Params**: `:id` UUID (`paramId`, 422 si no lo es).
- **Body**: `{ expectedUserId: string }`.
- **200** → `RealtimeSeal<'comments' | 'text'>`.
- **Nota**: como no consulta la base, **no distingue 404**: un archivo inexistente, en la papelera o sin permiso devuelve un
  sellado válido con 0 filas. La carga inicial de la página (`useApiFetch` REST, sin cambios) sigue dando el 404/409 que
  muestra el `ErrorState`.
- **Errores**: 401, 409, 422, 503.

### `POST /api/realtime/submissions/:id/files/:fileId/text`: texto de un archivo de un envío (FR-014, FR-015)

- **Auth**: solo sesión (401). **Params**: `:id` y `:fileId` UUID.
- **Body**: `{ expectedUserId: string }`.
- **200** → `RealtimeSeal<'text'>`.
- **Errores**: 401, 409, 422, 503.

## Invitado (sin sesión)

### `POST /api/public/access/live`: estado en vivo de la solicitud del invitado (FR-007–FR-010)

- **Auth**: la cookie `cloudy-guest-access` (`readAccessTokenHash`). Sin cookie → **401** `data: { state: 'none' }`.
  Vive bajo `/api/public/**`, donde `server/middleware/session.ts` no resuelve sesión.
- **Body**: ninguno.
- **Flujo**: sella `guestAccessLive(tokenHash)` con el hash de la cookie **del momento**. Si la cookie cambió (el invitado pidió
  un acceso nuevo), el siguiente sellado sigue la nueva solicitud; no hay comprobación de identidad adicional porque la cookie
  **es** la identidad del invitado y solo puede ver su propia fila (research C9, C11).
- **200** → `RealtimeSeal<'access'>`. `Cache-Control: no-store`.
- **Sin limitador de ritmo**: no hace ninguna consulta a la base (a diferencia de `current.get.ts`, que sí lee un índice
  único); se registra como excepción justificada en `test/unit/endpoint-guards.spec.ts`.
- **Privacidad**: la consulta nunca selecciona `token_hash`, `decided_by` ni datos del equipo (data-model).
- **Errores**: 401, 503.

## Rutas que se conservan sin cambios de contrato

- `GET /api/dashboard` (resumen SSR del equipo) y `GET /api/public/access/current` (estado SSR del invitado y desfase de
  reloj por la cabecera `Date`).
- Todas las escrituras: `POST /api/access-requests/:id/approve|reject`, `POST /api/public/access`, comentarios, usuarios,
  lectura de imágenes, envíos.

## Rutas y parámetros que se eliminan (Polish)

| Elemento | Motivo |
|----------|--------|
| `GET /api/realtime/pulse` (`server/api/realtime/pulse.get.ts`) y el tipo `Pulse` | Sustituidos por `POST /api/realtime/team` |
| `?since=` de `GET /api/files/:id/comments` (`commentsQuery`, `listComments(since)`) | El hilo ya no pide solo los nuevos |
| `since` en `readyPendingSubmissionsSql` y `openAccessRequestsSql` | Solo lo usaba el pulso; ambas siguen sirviendo a `/api/dashboard` |
| `profileQuery` y `attachProfile` (`server/utils/session.ts`) | Solo los usaba el pulso (`requireSessionUser` se conserva) |

## Middleware

- `server/middleware/session.ts`: `DEFERRED_PROFILE` pasa de `['/api/realtime/pulse']` a `['/api/realtime/']`: todas las
  rutas de sellado del equipo leen solo la sesión (sin `ensureProfile`, sin viaje a Neon). `/api/public/**` sigue en `SKIP`.

## Matriz de acceso (para `test/unit/endpoint-guards.spec.ts` y e2e de rutas protegidas)

| Ruta | Sin sesión | Cuenta pendiente | Editor | Admin |
|------|-----------|------------------|--------|-------|
| `POST /api/realtime/team` | 401 | 200 (0 filas en las 3 vistas) | 200 (`pendingUsers` vacío) | 200 |
| `POST /api/realtime/files/:id` | 401 | 200 (0 filas) | 200 | 200 |
| `POST /api/realtime/submissions/:id/files/:fileId/text` | 401 | 200 (0 filas) | 200 | 200 |
| `POST /api/public/access/live` | 401 sin cookie | — | — | — |

La seguridad real está en el SQL (data-model): el 200 de una cuenta sin rol **no** entrega datos. Cada ruta de sellado tiene una
prueba que lo demuestra revisando que la consulta contiene la guarda y recibe el id de la sesión como `$1`.
