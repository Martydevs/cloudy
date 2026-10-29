# Data Model: Subida de invitados con aprobación de acceso

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Una migración Drizzle nueva (`drizzle/0004_*.sql`, generada con `bun run db:generate` desde `server/db/schema.ts`).
Nada se borra ni se renombra en tablas existentes: solo se agregan un enum, dos valores de enum, una tabla y dos columnas.

## Enums

| Enum | Valores | Cambio |
|------|---------|--------|
| `access_request_status` | `open`, `approved`, `rejected`, `used` | **Nuevo**. "Caducada" no es un valor: se deriva (research B3) |
| `submission_origin` | `link`, `permission` | **Nuevo** |
| `activity_action` | + `access.approve`, + `access.reject` | **Valores nuevos** (`ALTER TYPE … ADD VALUE`, como `file.text_edit` en 0003) |

## Tabla nueva `guest_access_requests`

| Columna | Tipo | Reglas |
|---------|------|--------|
| `id` | `uuid` PK, `defaultRandom()` | |
| `sender_name` | `text NOT NULL` | 1–80 car., mismo validador `senderName()` de `shared/validation/submissions.ts` |
| `sender_key` | `text NOT NULL` | `hashSender(ip)`: SHA-256 de IP + sal; nunca la IP (Constitución) |
| `token_hash` | `text NOT NULL`, **único** | SHA-256 del token de la cookie `cloudy-guest-access` (research B1) |
| `status` | `access_request_status NOT NULL DEFAULT 'open'` | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `expires_at` | `timestamptz NOT NULL` | `created_at + 8 min` (FR-005) |
| `decided_by` | `text REFERENCES profiles(user_id) ON DELETE SET NULL` | quien aprobó o rechazó |
| `decided_at` | `timestamptz` | |
| `access_expires_at` | `timestamptz` | solo si `approved`: `decided_at + 30 min` (FR-015) |
| `submission_id` | `uuid REFERENCES guest_submissions(id) ON DELETE SET NULL` | envío en curso o el que la usó (research B4). Se escribe **después** de insertar ese envío, en la misma transacción, para que la FK siempre apunte a una fila existente |
| `used_at` | `timestamptz` | cuando se completó el envío |

**Índices**:
- `guest_access_requests_token_idx` **único** sobre `token_hash`: consultas del invitado.
- `guest_access_requests_status_created_idx` sobre `(status, created_at)`: lista de abiertas, pulso y limpieza.

**CHECKs** (SQL manual en la migración, como en 0003):
- `char_length(sender_name) BETWEEN 1 AND 80`
- `(status = 'open') = (decided_at IS NULL)`: abierta si y solo si nadie decidió.
- `(status IN ('approved', 'used')) = (access_expires_at IS NOT NULL)`
- `(status = 'used') = (used_at IS NOT NULL)`

### Estado visible (derivado)

`AccessState` (en `shared/constants/access.ts`, usada por cliente y servidor):

| `status` en la base | Condición | Estado visible |
|---------------------|-----------|----------------|
| `open` | `now() <= expires_at` | `waiting` |
| `open` | `now() > expires_at` | `expired` |
| `approved` | `now() <= access_expires_at` | `approved` |
| `approved` | `now() > access_expires_at` | `accessExpired` |
| `rejected` | — | `rejected` |
| `used` | — | `used` |
| sin cookie o sin fila | — | `none` |

### Transiciones

```text
             (equipo: Dar acceso, antes de expires_at)
   open ───────────────────────────────────────────▶ approved ──(invitado completa un envío)──▶ used
     │                                                   │
     │ (equipo: Rechazar, antes de expires_at)           └─(30 min sin iniciar envío)─▶ [accessExpired, derivado]
     ▼
  rejected            open ──(8 min sin decisión)──▶ [expired, derivado]
```

- Cada transición es un `UPDATE … WHERE status = <origen> AND <vigencia>`; si no afecta filas, la acción
  responde 409/410 con el estado actual (research B4, B5).
- `approved` admite **crear** varios envíos si los anteriores no se completaron (cada uno reemplaza
  `submission_id`), hasta `ACCESS_SUBMIT_LIMIT`, pero solo **completar** uno.
- Crear un envío con permiso es una sola transacción (`db.batch`), en este orden: (1) `INSERT` condicional del
  envío, que toma `sender_name` y `decided_by` de la solicitud (`INSERT … SELECT … FROM guest_access_requests WHERE
  token_hash = :h AND status = 'approved' AND access_expires_at > now()`); (2) `INSERT` de sus archivos solo si el
  envío existe; (3) `UPDATE guest_access_requests SET submission_id = :id …` con las mismas condiciones y solo si el
  envío existe. Si la solicitud no está vigente, ninguna sentencia escribe y se responde 403 (research B4).

### Retención

El cron diario borra las filas con `status IN ('rejected', 'used')`, o `open` con `expires_at`, o `approved` con
`access_expires_at`, anteriores a `now() - 24 h`. Al usarse, el aprobador ya quedó copiado en el envío (abajo).

## Cambios en `guest_submissions`

| Columna | Tipo | Reglas |
|---------|------|--------|
| `origin` | `submission_origin NOT NULL DEFAULT 'link'` | los envíos existentes quedan `link` (FR-022) |
| `access_granted_by` | `text REFERENCES profiles(user_id) ON DELETE SET NULL` | copiado de `decided_by` al crear un envío `permission` (FR-020) |

No hay CHECK entre `origin` y `access_granted_by`: la FK puede quedar en `NULL` si se elimina el perfil; la UI
muestra entonces "una persona del equipo".

El resto del ciclo de vida del envío (pendiente, aprobado, rechazado, caducado a 7 días, lectura de texto) no cambia.

## Actividad (`activity_log`)

| `action` | `target_type` | `target_id` | `target_label` | `meta` |
|----------|---------------|-------------|----------------|--------|
| `access.approve` | `access_request` | id de la solicitud | nombre del invitado | `null` |
| `access.reject` | `access_request` | id de la solicitud | nombre del invitado | `null` |

Etiquetas en `app/utils/activity-labels.ts`: "dio acceso a" y "rechazó la solicitud de" (FR-011); icono
`lucide:door-open`. Ninguna entrada guarda el token ni su hash.

## Tipos compartidos (`shared/types/api.ts`)

```ts
// expired = la solicitud caducó sin que nadie la atendiera; accessExpired = el acceso aprobado venció sin usarse
type AccessState = 'none' | 'waiting' | 'approved' | 'rejected' | 'expired' | 'accessExpired' | 'used'

interface GuestAccess {          // lo que ve el invitado: sin nombres del equipo (FR-013)
  state: AccessState
  senderName: string | null
  expiresAt: string | null       // fin de la espera (waiting) o del acceso (approved)
}

interface AccessRequest {        // lo que ve el equipo
  id: string
  senderName: string
  createdAt: string
  expiresAt: string
}

type SubmissionOrigin = 'link' | 'permission'
// Submission (existente) suma:
//   origin: SubmissionOrigin
//   accessGrantedBy: { name: string } | null

// Pulse (existente) suma:
//   openAccessRequests: number
//   newAccessRequests: { id: string, senderName: string, createdAt: string }[]
```

## Constantes (`shared/constants/access.ts`)

| Nombre | Valor | Uso |
|--------|-------|-----|
| `ACCESS_WAIT_MINUTES` | 8 | FR-005 |
| `ACCESS_WINDOW_MINUTES` | 30 | FR-015 |
| `ACCESS_REQUEST_LIMIT` | `{ limit: 3, windowSec: 1800 }` | FR-006, por navegador |
| `ACCESS_NETWORK_LIMIT` | `{ limit: 30, windowSec: 1800 }` | FR-006, por red (research B2) |
| `ACCESS_SUBMIT_LIMIT` | `{ limit: 5, windowSec: 1800 }` | creaciones de envío por solicitud aprobada, clave `access:submit:{token_hash}` (research B2) |
| `ACCESS_DEVICE_COOKIE` | `'cloudy-guest-device'` | clave del límite por navegador (research B2) |
| `ACCESS_COOKIE` | `'cloudy-guest-access'` | research B1 |
| `accessStateOf(row, now)` | función pura | tabla "Estado visible" |
| `TERMINAL_ACCESS_STATES` | `['none', 'rejected', 'expired', 'accessExpired', 'used']` | el sondeo del invitado se detiene |
