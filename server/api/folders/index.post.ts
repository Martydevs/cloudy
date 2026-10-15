// Crear carpeta (FR-011). Un nombre repetido recibe sufijo ` (2)`.
import { randomUUID } from 'node:crypto'
import type { FolderItem } from '#shared/types/api'
import { folderInput } from '#shared/validation/files'
import { folders } from '../../db/schema'

export default defineEventHandler(async (event): Promise<FolderItem> => {
  const { profile } = requireRole(event, 'editor')
  const { name, parentId } = await readValid(event, folderInput)
  if (parentId) await getVisibleFolder(parentId)

  const db = useDb()
  const id = randomUUID()
  const created = await retryOnUniqueViolation(async () => {
    const finalName = withSuffix(name, await takenNames('folder', parentId, name))
    const [row] = await db.batch([
      db.insert(folders).values({ id, name: finalName, parentId, createdBy: profile.userId }).returning(),
      activityInsert(profile, 'folder.create', { type: 'folder', id, label: finalName }),
    ])
    return row[0]!
  })

  setResponseStatus(event, 201)
  return toFolderItem(created, 0)
})
