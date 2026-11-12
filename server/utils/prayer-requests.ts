// Peticiones de oración (feature 007, data-model.md § Consulta, research D3–D4): imágenes de envíos de invitados aprobados,
// leídas de `files ⋈ guest_submissions`. Único lugar con SQL de la feature: una consulta por llamada (sin N+1) y sin las
// columnas de `files` que la tarjeta no usa.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { PRAYER_PAGE_SIZE } from '#shared/constants/prayers'
import type { Paginated, PrayerRequest } from '#shared/types/api'
import type { PrayersDir } from '#shared/validation/prayers'
import { files, guestSubmissions } from '../db/schema'
import { toImageText } from './image-text'
import type { ImageTextDtoRow } from './image-text'
import { decodeCursor, encodeCursor } from './pagination'

const ACCENTED = 'áéíóúüñ'
const PLAIN = 'aeiouun'

/**
 * La búsqueda en JS, igual que `translate(lower(…), 'áéíóúüñ', 'aeiouun')` en SQL, con `%`, `_` y `\` escapados para
 * `LIKE … ESCAPE '\'`.
 */
export function normalizeSearch(q: string): string {
  const lower = q.toLowerCase()
  let out = ''
  for (const char of lower) {
    const i = ACCENTED.indexOf(char)
    out += i === -1 ? char : PLAIN[i]
  }
  return out.replace(/[\\%_]/g, m => `\\${m}`)
}

// Postgres guarda microsegundos y el cursor viaja en milisegundos: orden y comparación usan la misma precisión.
const approvedKey = sql`date_trunc('milliseconds', ${guestSubmissions.reviewedAt})`

/** Peticiones visibles: imagen lista, fuera de la papelera, de un envío aprobado. */
const visible = () => and(
  eq(guestSubmissions.status, 'approved'),
  eq(files.category, 'image'),
  eq(files.uploadStatus, 'ready'),
  sql`${files.deletedAt} IS NULL`,
)

const columns = {
  id: files.id,
  name: files.name,
  textStatus: files.textStatus,
  textContent: files.textContent,
  textError: files.textError,
  textStartedAt: files.textStartedAt,
  textReadAt: files.textReadAt,
  textEditedAt: files.textEditedAt,
  editedByName: sql<string | null>`(SELECT p.name FROM profiles p WHERE p.user_id = ${files.textEditedBy})`,
  senderName: guestSubmissions.senderName,
  note: guestSubmissions.note,
  sentAt: guestSubmissions.createdAt,
  approvedAt: guestSubmissions.reviewedAt,
}

export interface PrayerRow extends ImageTextDtoRow {
  id: string
  name: string
  senderName: string
  note: string | null
  sentAt: Date
  approvedAt: Date | null
}

const baseQuery = () => useDb()
  .select(columns)
  .from(files)
  .innerJoin(guestSubmissions, eq(guestSubmissions.id, files.submissionId))

export function toPrayerRequest(row: PrayerRow): PrayerRequest {
  return {
    id: row.id,
    name: row.name,
    senderName: row.senderName,
    note: row.note,
    sentAt: row.sentAt.toISOString(),
    // Aprobado ⇒ `reviewed_at` existe; el respaldo solo cubre datos viejos inconsistentes.
    approvedAt: (row.approvedAt ?? row.sentAt).toISOString(),
    previewUrl: `/api/files/${row.id}/content`,
    text: toImageText(row),
  }
}

export interface PrayerListQuery {
  q?: string
  from?: string
  to?: string
  dir?: PrayersDir
  cursor?: string
}

/** Página del listado (contracts/api.md § 1): keyset sobre `(reviewed_at en ms, id)`, 12 por página. */
export async function listPrayerRequests({ q, from, to, dir = 'desc', cursor }: PrayerListQuery): Promise<Paginated<PrayerRequest>> {
  const after = decodeCursor(cursor)
  const op = dir === 'asc' ? sql`>` : sql`<`
  const search = q?.trim()
  const conditions: (SQL | undefined)[] = [
    visible(),
    from ? sql`${guestSubmissions.reviewedAt} >= ${from}::timestamptz` : undefined,
    to ? sql`${guestSubmissions.reviewedAt} < ${to}::timestamptz` : undefined,
    search
      ? sql`translate(lower(${guestSubmissions.senderName} || ' ' || coalesce(${guestSubmissions.note}, '') || ' ' || coalesce(${files.textContent}, '')), ${ACCENTED}, ${PLAIN}) LIKE ${`%${normalizeSearch(search)}%`} ESCAPE '\\'`
      : undefined,
    after ? sql`(${approvedKey}, ${files.id}) ${op} (${after.v}::timestamptz, ${after.id}::uuid)` : undefined,
  ]
  const rows = await baseQuery()
    .where(and(...conditions))
    .orderBy(...(dir === 'asc' ? [asc(approvedKey), asc(files.id)] : [desc(approvedKey), desc(files.id)]))
    .limit(PRAYER_PAGE_SIZE + 1)

  const page = rows.slice(0, PRAYER_PAGE_SIZE)
  const last = page[page.length - 1]
  const nextCursor = rows.length > PRAYER_PAGE_SIZE && last?.approvedAt
    ? encodeCursor({ v: last.approvedAt.toISOString(), id: last.id })
    : null
  return { items: page.map(row => toPrayerRequest(row)), nextCursor }
}

/**
 * Peticiones que pueden ir a una imagen ahora (FR-027): las condiciones del listado más un texto listo y no vacío.
 * `found` va en el orden de las imágenes `(reviewed_at, sent_at, id)` ascendente; `missing` son los ids que no cumplen.
 */
export async function loadEligibleRequests(fileIds: string[]): Promise<{ found: PrayerRequest[], missing: string[] }> {
  if (fileIds.length === 0) return { found: [], missing: [] }
  const rows = await baseQuery()
    .where(and(
      visible(),
      inArray(files.id, fileIds),
      eq(files.textStatus, 'ready'),
      sql`btrim(coalesce(${files.textContent}, '')) <> ''`,
    ))
    .orderBy(asc(guestSubmissions.reviewedAt), asc(guestSubmissions.createdAt), asc(files.id))
  const found = rows.map(row => toPrayerRequest(row))
  const ids = new Set(found.map(r => r.id))
  return { found, missing: fileIds.filter(id => !ids.has(id)) }
}
