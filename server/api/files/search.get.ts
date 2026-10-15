// Búsqueda por nombre (FR-012): ILIKE apoyado en el índice trigram; carpetas y archivos con su ruta.
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { FileItem, FolderItem } from '#shared/types/api'
import { searchQuery } from '#shared/validation/files'
import { files, folders, profiles } from '../../db/schema'

interface SearchResult {
  folders: (FolderItem & { path: string[] })[]
  files: FileItem[]
  nextCursor: string | null
}

export default defineEventHandler(async (event): Promise<SearchResult> => {
  requireRole(event, 'editor')
  const { q, type, sort = 'name', dir = 'asc', cursor } = queryValid(event, searchQuery)
  const pattern = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`
  const db = useDb()

  const keyset = filesKeyset(sort, dir, cursor)
  const fileRows = await db
    .select({ ...fileColumns, commentCount: commentCountSql() })
    .from(files)
    .leftJoin(profiles, eq(files.uploadedBy, profiles.userId))
    .where(and(
      visibleFilesWhere(),
      sql`${files.name} ILIKE ${pattern}`,
      type ? eq(files.category, type) : undefined,
      keyset.where,
    ))
    .orderBy(...keyset.orderBy)
    .limit(PAGE_SIZE)

  const folderRows = cursor || type
    ? []
    : await db.select().from(folders)
        .where(and(isNull(folders.deletedAt), sql`${folders.name} ILIKE ${pattern}`))
        .orderBy(asc(sql`lower(${folders.name})`))
        .limit(20)

  // Rutas de todos los resultados en una sola consulta recursiva (sin N+1).
  const paths = await folderPaths([...fileRows.map(r => r.folderId), ...folderRows.map(r => r.parentId)])

  return {
    folders: folderRows.map(row => ({ ...toFolderItem(row), path: row.parentId ? paths.get(row.parentId) ?? [] : [] })),
    files: fileRows.map(row => toFileItem(row, {
      commentCount: row.commentCount,
      path: row.folderId ? paths.get(row.folderId) ?? [] : [],
    })),
    nextCursor: keyset.nextCursor(fileRows),
  }
})
