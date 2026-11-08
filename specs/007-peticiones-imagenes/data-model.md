# Data Model: Página Peticiones

**Feature**: `007-peticiones-imagenes` · Esta feature **no crea tablas ni enums**: lee `files` y `guest_submissions` y reutiliza el texto de
imágenes de la feature 002. Lo único que cambia en la base son **dos índices** (migración `0009`).

## Origen de los datos

```text
guest_submissions (gs)                        files (f)
  id ───────────────────────────────────────── submission_id        (FK, ON DELETE SET NULL)
  status = 'approved'                          category = 'image'
  reviewed_at   ← fecha de referencia          upload_status = 'ready'
  created_at    ← «enviada el…»                deleted_at IS NULL
  sender_name, note                            text_status / text_content / text_edited_at / text_edited_by
```

Una **petición** (tarjeta) es una fila de `files` que cumple la condición de la derecha y cuyo envío está aprobado. Al aprobar, el texto
leído ya se copió a `files` (feature 002, FR-010); desde entonces `files.text_*` es la única fuente (la corrección manual escribe ahí).

## Entidades

### Petición (`PrayerRequest`, DTO de lectura)

| Campo | Tipo | Origen |
|-------|------|--------|
| `id` | `string` (uuid) | `files.id` (también el id del archivo para `/api/files/:id/text` y `/content`) |
| `name` | `string` | `files.name` |
| `senderName` | `string` | `guest_submissions.sender_name` (1–80) |
| `note` | `string \| null` | `guest_submissions.note` (≤ 500) |
| `sentAt` | ISO 8601 | `guest_submissions.created_at` |
| `approvedAt` | ISO 8601 | `guest_submissions.reviewed_at` (orden y filtro) |
| `previewUrl` | `string` | `/api/files/<id>/content` (302 a URL firmada; sin miniatura) |
| `text` | `ImageText` | `toImageText(fila)`: `status`, `text`, `error`, `readAt`, `editedAt`, `editedBy` (**mismo DTO de la feature 002**) |

Reglas derivadas (en cliente, puras, `shared/prayers.ts`):

- **Seleccionable** ⇔ `text.status === 'ready'` y `text.text.trim() !== ''`.
- **Texto por corregir** ⇔ `hasIllegibleMark(text.text)` (corchetes que contienen «legible»).
- **Texto largo** ⇔ `text.text.length > PRAYER_LONG_TEXT_CHARS` (600; solo advertencia).
- Los estados `pending/reading/empty/failed/unavailable` se muestran con los textos de `messages.imageText.*`.

### Selección (solo cliente)

`Record<string, PrayerRequest>` en `useState('prayer-selection')`: copia de cada tarjeta elegida (sobrevive a filtros y paginación). No se
persiste; se vacía al salir de la página.

| Derivado | Cálculo |
|----------|---------|
| `count` | número de elegidas (≤ `PRAYER_MAX_SELECTION` = 40) |
| `ordered` | ordenadas por `(approvedAt, sentAt, id)` ascendente |
| `groups` | `chunkRequests(ordered, PRAYER_PER_IMAGE = 4)` → ⌈N/4⌉ grupos |
| `unreadable` | elegidas con `hasIllegibleMark` |
| `limitReached` | `count >= 40` |

### Imagen generada (solo cliente)

Elemento de la cola `usePrayerImages` (`useState('prayer-images')`; `AbortController` y `objectURL` en mapas de módulo):

| Campo | Tipo | Notas |
|-------|------|-------|
| `key` | `string` | `img-<n>` estable mientras la imagen está en la bandeja |
| `index` | `number` | posición (1-based) en el reparto; se usa en el nombre del archivo |
| `fileIds` | `string[]` (1–4) | peticiones del grupo, en el orden de `groups` |
| `status` | `'queued' \| 'running' \| 'done' \| 'failed' \| 'canceled'` | |
| `url` | `string?` | `objectURL` del blob (se revoca al descartar o salir) |
| `filename` | `string?` | `peticiones-YYYY-MM-DD-<index>.<png\|jpg>` |
| `downloaded` | `boolean` | alimenta el aviso al salir |
| `error`, `errorCode`, `retryable` | | `errorCode` = `data.code` de la API |

**Transiciones**: `queued → running → done | failed | canceled`; `failed → queued` (Reintentar); `done → queued` (Generar de nuevo);
cualquier estado final → fuera de la bandeja (Descartar). Como máximo 2 elementos `running` a la vez.

### Plantilla

Archivo estático `server/assets/peticiones/plantilla.jpg` (1152×928 JPEG, 733 KB) servido como *server asset* de Nitro
(`assets:peticiones`). No es una entidad de base de datos ni de bucket.

## Cambios de esquema (migración `0009`)

Generada con `bun run db:generate` desde `server/db/schema.ts`; aplicada por `bun run db:migrate` (desarrollo) y `db:migrate:test` / `:prod`.

```ts
// guest_submissions
index('guest_submissions_status_reviewed_idx').on(t.status, t.reviewedAt, t.id)
// files
index('files_submission_idx').on(t.submissionId).where(sql`${t.submissionId} IS NOT NULL`)
```

| Índice | Sirve a | Por qué |
|--------|---------|---------|
| `guest_submissions_status_reviewed_idx` | filtro `status='approved'`, rango y orden por `reviewed_at`, desempate | Constitución I: toda columna de filtro/orden indexada; keyset sin `OFFSET` |
| `files_submission_idx` | `JOIN files.submission_id = gs.id` | la FK no tenía índice (también acelera `ON DELETE SET NULL` y `eq(files.submissionId, id)` de la aprobación) |

Son `CREATE INDEX` (no destructivos). La búsqueda de texto **no** agrega índice (research D4).

## Consulta de listado (forma)

```sql
SELECT f.id, f.name, f.text_status, f.text_content, f.text_error, f.text_started_at, f.text_read_at, f.text_edited_at,
       (SELECT p.name FROM profiles p WHERE p.user_id = f.text_edited_by) AS edited_by_name,
       gs.sender_name, gs.note, gs.created_at AS sent_at, gs.reviewed_at
FROM files f
JOIN guest_submissions gs ON gs.id = f.submission_id
WHERE gs.status = 'approved' AND f.category = 'image' AND f.upload_status = 'ready' AND f.deleted_at IS NULL
  AND [gs.reviewed_at >= :from] AND [gs.reviewed_at < :to]
  AND [ translate(lower(gs.sender_name || ' ' || coalesce(gs.note,'') || ' ' || coalesce(f.text_content,'')), 'áéíóúüñ','aeiouun') LIKE :pattern ESCAPE '\' ]
  AND [ (date_trunc('milliseconds', gs.reviewed_at), f.id) < (:cursorAt::timestamptz, :cursorId::uuid) ]   -- '>' con dir = asc
ORDER BY gs.reviewed_at DESC, f.id DESC            -- ASC, ASC con dir = asc
LIMIT 13                                           -- página de 12 + 1 para saber si hay más
```

`nextCursor` = `(reviewed_at en ms, id)` de la última fila devuelta, o `null` si vinieron ≤ 12.

## Validación (`shared/validation/prayers.ts`, sobre `core.ts`)

| Entrada | Regla |
|---------|-------|
| `q` | opcional, `str({ min: 0, max: 100 })`; vacío = sin filtro |
| `from`, `to` | opcional, instante ISO 8601 (`from` inclusivo, `to` exclusivo); si ambos, `from < to` |
| `dir` | opcional, `oneOf(['asc','desc'])`, por defecto `desc` |
| `cursor` | opcional, `str({ max: 500 })` (decodificación en `decodeCursor`, 422 si es inválido) |
| `fileIds` | `array(uuid, { min: 1, max: 4 })` sin repetidos |

## Constantes (`shared/constants/prayers.ts`)

`PRAYER_PER_IMAGE = 4` · `PRAYER_MAX_SELECTION = 40` · `PRAYER_PAGE_SIZE = 12` · `PRAYER_LONG_TEXT_CHARS = 600` ·
`PRAYER_IMAGE_CONCURRENCY = 2` · `PRAYER_IMAGE_TIMEOUT_MS = 110_000` · `PRAYER_IMAGE_MAX_BYTES = 4_000_000` ·
`PRAYER_ERROR_CODES` y sus mensajes por código.
