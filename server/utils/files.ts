// Consultas y mapeos compartidos por los endpoints de carpetas y archivos.
import { and, eq, getTableColumns, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { createError } from 'h3'
import type { Breadcrumb, FileItem, FolderItem } from '#shared/types/api'
import { files, folders, profiles } from '../db/schema'

export type FileRow = typeof files.$inferSelect
export type FolderRow = typeof folders.$inferSelect

/** Columnas de `files` + nombre de quien subió (requiere `leftJoin(profiles, …)`). */
export const fileColumns = {
  ...getTableColumns(files),
  uploaderName: profiles.name,
}

export type FileWithUploader = FileRow & { uploaderName: string | null }

export function toFileItem(row: FileWithUploader, extra: Partial<Pick<FileItem, 'path' | 'commentCount'>> = {}): FileItem {
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    extension: row.extension,
    mimeType: row.mimeType,
    category: row.category,
    sizeBytes: Number(row.sizeBytes),
    hasThumbnail: !!row.thumbKey,
    origin: row.origin,
    uploadedBy: row.uploadedBy ? { id: row.uploadedBy, name: row.uploaderName ?? 'Usuario' } : null,
    guestName: row.guestName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...extra,
  }
}

export function toFolderItem(row: FolderRow, itemCount?: number): FolderItem {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(itemCount === undefined ? {} : { itemCount }),
  }
}

/** Solo archivos listos y fuera de la papelera (FR-017, FR-034). */
export function visibleFilesWhere(): SQL {
  return and(isNull(files.deletedAt), eq(files.uploadStatus, 'ready'))!
}

export function sameFolder(column: typeof files.folderId | typeof folders.parentId, folderId: string | null): SQL {
  return folderId ? eq(column, folderId) : isNull(column)
}

/**
 * Nombres ya usados en la carpeta que podrían chocar con `name` (el mismo nombre o sus variantes
 * con sufijo). Se filtra en SQL para no traer carpetas enteras.
 */
export async function takenNames(kind: 'file' | 'folder', folderId: string | null, name: string, excludeId?: string): Promise<Set<string>> {
  const dot = kind === 'file' ? name.lastIndexOf('.') : -1
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase()
  const escaped = base.replace(/[\\%_]/g, m => `\\${m}`)
  const db = useDb()

  if (kind === 'file') {
    const rows = await db.select({ name: files.name }).from(files).where(and(
      sameFolder(files.folderId, folderId),
      visibleFilesWhere(),
      sql`(lower(${files.name}) = ${name.toLowerCase()} OR lower(${files.name}) LIKE ${`${escaped} (%`})`,
      excludeId ? sql`${files.id} <> ${excludeId}` : undefined,
    ))
    return new Set(rows.map(r => r.name))
  }
  const rows = await db.select({ name: folders.name }).from(folders).where(and(
    sameFolder(folders.parentId, folderId),
    isNull(folders.deletedAt),
    sql`(lower(${folders.name}) = ${name.toLowerCase()} OR lower(${folders.name}) LIKE ${`${escaped} (%`})`,
    excludeId ? sql`${folders.id} <> ${excludeId}` : undefined,
  ))
  return new Set(rows.map(r => r.name))
}

/** Reintenta `fn` si choca con un índice único (dos subidas con el mismo nombre a la vez). */
export async function retryOnUniqueViolation<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    }
    catch (error) {
      const code = (error as { code?: string, cause?: { code?: string } }).code
        ?? (error as { cause?: { code?: string } }).cause?.code
      if (code !== '23505' || i >= attempts) throw error
    }
  }
}

/** Carpeta visible (no en papelera) o 404. */
export async function getVisibleFolder(id: string): Promise<FolderRow> {
  const [folder] = await useDb().select().from(folders).where(and(eq(folders.id, id), isNull(folders.deletedAt))).limit(1)
  if (!folder) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'La carpeta no existe o está en la papelera' })
  return folder
}

/** Ancestros de la carpeta, desde la raíz, con un CTE recursivo. */
export async function buildBreadcrumbs(folderId: string | null): Promise<Breadcrumb[]> {
  const root: Breadcrumb = { id: null, name: 'Archivos' }
  if (!folderId) return [root]
  const result = await useDb().execute<{ id: string, name: string, depth: number }>(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id, 0 AS depth FROM folders WHERE id = ${folderId}
      UNION ALL
      SELECT f.id, f.name, f.parent_id, a.depth + 1 FROM folders f JOIN ancestors a ON f.id = a.parent_id
    )
    SELECT id, name, depth FROM ancestors ORDER BY depth DESC
  `)
  return [root, ...result.rows.map(r => ({ id: r.id, name: r.name }))]
}

/** Nombres de las carpetas ancestro (incluida la propia) de cada carpeta pedida. */
export async function folderPaths(folderIds: (string | null)[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(folderIds.filter((id): id is string => !!id))]
  const paths = new Map<string, string[]>()
  if (ids.length === 0) return paths
  const result = await useDb().execute<{ start_id: string, name: string, depth: number }>(sql`
    WITH RECURSIVE chain AS (
      SELECT id AS start_id, id, name, parent_id, 0 AS depth FROM folders
      WHERE id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})
      UNION ALL
      SELECT c.start_id, f.id, f.name, f.parent_id, c.depth + 1 FROM folders f JOIN chain c ON f.id = c.parent_id
    )
    SELECT start_id, name, depth FROM chain ORDER BY start_id, depth DESC
  `)
  for (const row of result.rows) {
    const list = paths.get(row.start_id) ?? []
    list.push(row.name)
    paths.set(row.start_id, list)
  }
  return paths
}

/** 409 si `newParentId` es la propia carpeta o uno de sus descendientes. */
export async function assertNoCycle(folderId: string, newParentId: string | null): Promise<void> {
  if (!newParentId) return
  if (newParentId === folderId) {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Una carpeta no puede moverse dentro de sí misma' })
  }
  const result = await useDb().execute<{ hit: number }>(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM folders WHERE id = ${newParentId}
      UNION ALL
      SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
    )
    SELECT 1 AS hit FROM ancestors WHERE id = ${folderId} LIMIT 1
  `)
  if (result.rows.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'No puedes mover una carpeta dentro de una de sus subcarpetas' })
  }
}

/** Envíos de invitados pendientes cuyos archivos ya terminaron de subir. */
export function readyPendingSubmissionsSql(): SQL {
  return sql`
    SELECT s.id, s.sender_name, s.created_at, count(f.id)::int AS file_count
    FROM guest_submissions s
    JOIN guest_submission_files f ON f.submission_id = s.id
    WHERE s.status = 'pending'
    GROUP BY s.id
    HAVING bool_and(f.upload_status = 'ready')
  `
}
