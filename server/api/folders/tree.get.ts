// Árbol ligero de carpetas para "Mover a…" y "Aprobar en…".
import { asc, isNull, sql } from 'drizzle-orm'
import type { FolderTreeNode } from '#shared/types/api'
import { folders } from '../../db/schema'

export default defineEventHandler(async (event): Promise<FolderTreeNode[]> => {
  requireRole(event, 'editor')
  return useDb()
    .select({ id: folders.id, name: folders.name, parentId: folders.parentId })
    .from(folders)
    .where(isNull(folders.deletedAt))
    .orderBy(asc(sql`lower(${folders.name})`))
})
