// Contenido de una carpeta (`root` = raíz): subcarpetas + archivos paginados (FR-011, FR-012).
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { FolderChildren } from '#shared/types/api'
import { uuid } from '#shared/validation/core'
import { listQuery } from '#shared/validation/files'
import { files, folders, profiles } from '../../../db/schema'

export default defineEventHandler(async (event): Promise<FolderChildren> => {
  requireRole(event, 'editor')
  const rawId = getRouterParam(event, 'id')
  const idCheck = rawId === 'root' ? null : uuid()(rawId)
  if (idCheck && !idCheck.ok) throw createError({ statusCode: 404, statusMessage: 'No encontrado' })
  const folderId = idCheck?.ok ? idCheck.value : null

  const { sort = 'name', dir = 'asc', type, cursor } = queryValid(event, listQuery)
  const db = useDb()

  const keyset = filesKeyset(sort, dir, cursor)
  const filesQuery = db
    .select({ ...fileColumns, commentCount: commentCountSql() })
    .from(files)
    .leftJoin(profiles, eq(files.uploadedBy, profiles.userId))
    .where(and(
      sameFolder(files.folderId, folderId),
      visibleFilesWhere(),
      type ? eq(files.category, type) : undefined,
      keyset.where,
    ))
    .orderBy(...keyset.orderBy)
    .limit(PAGE_SIZE)

  // Las subcarpetas van completas en la primera página y se ocultan al filtrar por tipo.
  const subfoldersQuery = db
    .select({ folder: folders, itemCount: folderItemCountSql() })
    .from(folders)
    .where(and(sameFolder(folders.parentId, folderId), isNull(folders.deletedAt), cursor || type ? sql`false` : undefined))
    .orderBy(sort === 'date' && dir === 'desc' ? sql`${folders.createdAt} desc` : asc(sql`lower(${folders.name})`))

  // Un solo viaje a Neon (Constitución I): con el driver HTTP cada consulta en paralelo abre su propia conexión
  // y una fría cuesta más que todo el batch. En la raíz, la carpeta y las migas no devuelven filas.
  const [folderRows, fileRows, subfolderRows, ancestors] = await db.batch([
    visibleFolderQuery(folderId),
    filesQuery,
    subfoldersQuery,
    breadcrumbsQuery(folderId),
  ])
  const folder = folderRows[0]
  if (folderId && !folder) throw folderNotFound()

  return {
    folder: folder ? toFolderItem(folder) : null,
    breadcrumbs: cursor ? [] : toBreadcrumbs(ancestors.rows),
    folders: subfolderRows.map(row => toFolderItem(row.folder, row.itemCount)),
    files: fileRows.map(row => toFileItem(row, { commentCount: row.commentCount })),
    nextCursor: keyset.nextCursor(fileRows),
  }
})
