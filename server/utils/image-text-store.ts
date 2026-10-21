// Capa de persistencia del texto de imágenes (feature 002, research A5): solo SQL sobre las columnas
// `text_*`, genérico sobre `files` y `guest_submission_files`. Sin IA, storage ni h3.
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { imageTextStatus } from '../db/schema'

export type ImageTextTable = 'files' | 'guest_submission_files'
export type ImageTextTarget = { table: ImageTextTable, id: string }
export type StoredTextStatus = (typeof imageTextStatus.enumValues)[number]

/** La fila de la imagen con lo que necesitan la lectura y el DTO. */
export interface ImageTextRow {
  id: string
  extension: string
  category: string
  sizeBytes: number
  storageKey: string
  textStatus: StoredTextStatus | null
  textContent: string | null
  textError: string | null
  textSourceKey: string | null
  textAttempts: number
  textStartedAt: Date | null
  textReadAt: Date | null
  textEditedAt: Date | null
  editedByName: string | null
}

/** Fila reclamada: `claimedAt` es el `text_started_at` exacto (como texto, sin perder microsegundos). */
export interface ClaimedImageText extends ImageTextRow {
  claimedAt: string
}

/** Resultado que se guarda al terminar una lectura. */
export type ImageTextOutcome =
  | { status: 'ready', text: string }
  | { status: 'empty' }
  | { status: 'failed', error: string }

type RawRow = {
  id: string
  extension: string
  category: string
  size_bytes: string | number
  storage_key: string
  text_status: StoredTextStatus | null
  text_content: string | null
  text_error: string | null
  text_source_key: string | null
  text_attempts: string | number
  text_started_at: string | Date | null
  text_read_at: string | Date | null
  text_edited_at: string | Date | null
  edited_by_name: string | null
  claimed_at?: string
}

/** Segundos tras los que una lectura en `reading` se puede volver a reclamar (`READING_STALE_MS`). */
const STALE_SECONDS = 90

const table = (target: ImageTextTarget) => sql.identifier(target.table)

const date = (value: string | Date | null): Date | null => (value === null ? null : new Date(value))

function toRow(raw: RawRow): ImageTextRow {
  return {
    id: raw.id,
    extension: raw.extension,
    category: raw.category,
    sizeBytes: Number(raw.size_bytes),
    storageKey: raw.storage_key,
    textStatus: raw.text_status,
    textContent: raw.text_content,
    textError: raw.text_error,
    textSourceKey: raw.text_source_key,
    textAttempts: Number(raw.text_attempts),
    textStartedAt: date(raw.text_started_at),
    textReadAt: date(raw.text_read_at),
    textEditedAt: date(raw.text_edited_at),
    editedByName: raw.edited_by_name,
  }
}

/** Columnas comunes de la fila; `guest_submission_files` no tiene columnas de edición. */
function columns(name: ImageTextTable): SQL {
  const edit = name === 'files'
    ? sql`t.text_edited_at, (SELECT p.name FROM profiles p WHERE p.user_id = t.text_edited_by) AS edited_by_name`
    : sql`NULL::timestamptz AS text_edited_at, NULL::text AS edited_by_name`
  return sql`t.id, t.extension, t.category, t.size_bytes, t.storage_key, t.text_status, t.text_content, t.text_error,
    t.text_source_key, t.text_attempts, t.text_started_at, t.text_read_at, ${edit}`
}

/** La fila de la imagen, o `null` si no existe. */
export async function loadImageTextRow(target: ImageTextTarget): Promise<ImageTextRow | null> {
  const result = await useDb().execute<RawRow>(sql`SELECT ${columns(target.table)} FROM ${table(target)} t WHERE t.id = ${target.id}`)
  const raw = result.rows[0]
  return raw ? toRow(raw) : null
}

/**
 * Reclamación atómica (research A5): `NULL` o una lectura vencida pasan a `reading`; con `force`, también
 * `failed`, `ready` y `empty`. Volver a leer reemplaza una corrección manual. Devuelve `null` si otro
 * lector ya tiene la fila o el estado no se puede reclamar.
 */
export async function claimImageText(target: ImageTextTarget, { force = false }: { force?: boolean } = {}): Promise<ClaimedImageText | null> {
  const allowed = force ? sql`OR t.text_status IN ('failed', 'ready', 'empty')` : sql``
  const clearEdit = target.table === 'files' ? sql`, text_edited_by = NULL, text_edited_at = NULL` : sql``
  const result = await useDb().execute<RawRow>(sql`
    UPDATE ${table(target)} t
    SET text_status = 'reading', text_started_at = now(), text_attempts = t.text_attempts + 1 ${clearEdit}
    WHERE t.id = ${target.id} AND (
      t.text_status IS NULL ${allowed}
      OR (t.text_status = 'reading' AND t.text_started_at < now() - make_interval(secs => ${STALE_SECONDS}))
    )
    RETURNING ${columns(target.table)}, t.text_started_at::text AS claimed_at
  `)
  const raw = result.rows[0]
  return raw ? { ...toRow(raw), claimedAt: raw.claimed_at! } : null
}

/**
 * Guarda el resultado solo si la fila sigue en la misma reclamación: una lectura vencida que termina
 * tarde no pisa una más nueva. Para un archivo de invitado aprobado durante la lectura, actualiza
 * también la fila de `files` con el mismo id y la misma reclamación (research A5). Devuelve si escribió.
 */
export async function saveImageTextResult(target: ImageTextTarget, claimedAt: string, outcome: ImageTextOutcome): Promise<boolean> {
  const text = outcome.status === 'ready' ? outcome.text : null
  const error = outcome.status === 'failed' ? outcome.error : null
  const update = (name: ImageTextTable) => sql`
    UPDATE ${sql.identifier(name)}
    SET text_status = ${outcome.status}::image_text_status, text_content = ${text}, text_error = ${error}, text_read_at = now()
    WHERE id = ${target.id} AND text_status = 'reading' AND text_started_at = ${claimedAt}::timestamptz
    RETURNING id
  `
  const query = target.table === 'files'
    ? sql`WITH saved AS (${update('files')}) SELECT count(*)::int AS saved FROM saved`
    : sql`WITH saved AS (${update('guest_submission_files')}), approved AS (${update('files')})
        SELECT ((SELECT count(*) FROM saved) + (SELECT count(*) FROM approved))::int AS saved`
  const result = await useDb().execute<{ saved: number }>(query)
  return Number(result.rows[0]?.saved ?? 0) > 0
}

/** Imagen no apta (formato, tamaño o HEIC sin copia): terminal, sin llamar al modelo. */
export async function markUnavailable(target: ImageTextTarget): Promise<void> {
  await useDb().execute(sql`
    UPDATE ${table(target)}
    SET text_status = 'unavailable', text_content = NULL, text_error = NULL
    WHERE id = ${target.id}
  `)
}

/** Devuelve una fila reclamada a pendiente (límite de invitados excedido) sin contar el intento. */
export async function releaseImageText(target: ImageTextTarget, claimedAt: string): Promise<void> {
  await useDb().execute(sql`
    UPDATE ${table(target)}
    SET text_status = NULL, text_started_at = NULL, text_attempts = greatest(text_attempts - 1, 0)
    WHERE id = ${target.id} AND text_status = 'reading' AND text_started_at = ${claimedAt}::timestamptz
  `)
}

/**
 * Imágenes de un envío aún sin leer (`NULL`), en el orden en que se subieron, con la clave del remitente
 * para el límite `guest-text` (research A7). La elegibilidad la decide la capa de aplicación.
 */
export async function listPendingSubmissionImages(submissionId: string): Promise<{ senderKey: string | null, rows: ImageTextRow[] }> {
  const result = await useDb().execute<RawRow & { sender_key: string }>(sql`
    SELECT ${columns('guest_submission_files')}, s.sender_key
    FROM guest_submission_files t JOIN guest_submissions s ON s.id = t.submission_id
    WHERE t.submission_id = ${submissionId} AND t.upload_status = 'ready' AND t.text_status IS NULL
      AND t.category = 'image'
    ORDER BY t.original_name, t.id
  `)
  return { senderKey: result.rows[0]?.sender_key ?? null, rows: result.rows.map(toRow) }
}

/** Guarda la clave de la copia JPEG válida de una HEIC. */
export async function setTextSourceKey(target: ImageTextTarget, sourceKey: string): Promise<void> {
  await useDb().execute(sql`UPDATE ${table(target)} SET text_source_key = ${sourceKey} WHERE id = ${target.id}`)
}

/**
 * Corrección manual de un archivo (FR-014): sin ejecutar, para incluirla en el mismo `db.batch` que la
 * actividad. Nunca pisa una lectura vigente ni una imagen no apta.
 */
export function editImageTextQuery(fileId: string, text: string, userId: string) {
  return useDb().execute(sql`
    UPDATE files
    SET text_status = 'ready', text_content = ${text}, text_error = NULL, text_edited_by = ${userId}, text_edited_at = now()
    WHERE id = ${fileId} AND (
      text_status IS NULL OR text_status IN ('ready', 'empty', 'failed')
      OR (text_status = 'reading' AND text_started_at < now() - make_interval(secs => ${STALE_SECONDS}))
    )
  `)
}
