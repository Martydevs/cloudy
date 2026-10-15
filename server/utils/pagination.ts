// Paginación por cursor (keyset) sobre `files` (Constitución I): estable y sin OFFSET.
import { asc, desc, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { createError } from 'h3'
import type { SortKey } from '#shared/validation/files'
import { files } from '../db/schema'

export const PAGE_SIZE = 60

interface CursorData {
  v: string
  id: string
}

export function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url')
}

export function decodeCursor(cursor: string | undefined): CursorData | null {
  if (!cursor) return null
  try {
    const data = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorData>
    if (typeof data.v === 'string' && typeof data.id === 'string') return { v: data.v, id: data.id }
  }
  catch {
    // Se responde 422 abajo.
  }
  throw createError({ statusCode: 422, statusMessage: 'Validation failed', data: { errors: { cursor: 'Cursor no válido' } } })
}

function sortExpression(sort: SortKey): SQL {
  switch (sort) {
    case 'name': return sql`lower(${files.name})`
    case 'size': return sql`${files.sizeBytes}`
    // Postgres guarda microsegundos y el cursor viaja en milisegundos (Date de JS): se trunca
    // para que el orden y la comparación del cursor usen la misma precisión.
    case 'date': return sql`date_trunc('milliseconds', ${files.createdAt})`
  }
}

function cursorValue(sort: SortKey, v: string): SQL {
  switch (sort) {
    case 'name': return sql`${v}::text`
    case 'size': return sql`${v}::bigint`
    case 'date': return sql`${v}::timestamptz`
  }
}

/** Orden, condición de "después del cursor" y cómo leer el cursor de la última fila. */
export function filesKeyset(sort: SortKey, dir: 'asc' | 'desc', cursor: string | undefined) {
  const key = sortExpression(sort)
  const after = decodeCursor(cursor)
  const op = dir === 'asc' ? sql`>` : sql`<`
  const where = after ? sql`(${key}, ${files.id}) ${op} (${cursorValue(sort, after.v)}, ${after.id}::uuid)` : undefined
  const orderBy = dir === 'asc' ? [asc(key), asc(files.id)] : [desc(key), desc(files.id)]

  function nextCursor(rows: { id: string, name: string, sizeBytes: number, createdAt: Date }[]): string | null {
    if (rows.length < PAGE_SIZE) return null
    const last = rows[rows.length - 1]!
    const v = sort === 'name' ? last.name.toLowerCase() : sort === 'size' ? String(last.sizeBytes) : last.createdAt.toISOString()
    return encodeCursor({ v, id: last.id })
  }

  return { where, orderBy, nextCursor }
}

/** Cantidad de comentarios por archivo como subconsulta agregada (sin N+1). */
export function commentCountSql(): SQL<number> {
  return sql<number>`(SELECT count(*)::int FROM comments c WHERE c.file_id = ${files.id})`
}
