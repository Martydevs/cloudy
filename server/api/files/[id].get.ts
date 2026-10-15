import type { FileItem } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<FileItem> => {
  requireRole(event, 'editor')
  const row = await getVisibleFile(paramId(event))
  const paths = await folderPaths([row.folderId])
  return toFileItem(row, {
    commentCount: row.commentCount,
    path: row.folderId ? paths.get(row.folderId) ?? [] : [],
  })
})
