// Renombrar o mover una carpeta, sin crear ciclos (FR-011).
import { eq } from 'drizzle-orm'
import type { FolderItem } from '#shared/types/api'
import { folderPatchInput } from '#shared/validation/files'
import { folders } from '../../db/schema'

export default defineEventHandler(async (event): Promise<FolderItem> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const input = await readValid(event, folderPatchInput)
  const folder = await getVisibleFolder(id)

  const targetParent = input.parentId === undefined ? folder.parentId : input.parentId
  const moving = targetParent !== folder.parentId
  if (moving) {
    if (targetParent) await getVisibleFolder(targetParent)
    await assertNoCycle(id, targetParent)
  }

  const db = useDb()
  const updated = await retryOnUniqueViolation(async () => {
    const wanted = input.name ?? folder.name
    const finalName = withSuffix(wanted, await takenNames('folder', targetParent, wanted, id))
    const renamed = finalName !== folder.name
    const [rows] = await db.batch([
      db.update(folders)
        .set({ name: finalName, parentId: targetParent, updatedAt: new Date() })
        .where(eq(folders.id, id))
        .returning(),
      ...(renamed ? [activityInsert(profile, 'folder.rename', { type: 'folder', id, label: finalName }, { from: folder.name, to: finalName })] : []),
      ...(moving ? [activityInsert(profile, 'folder.move', { type: 'folder', id, label: finalName }, { from: folder.parentId, to: targetParent })] : []),
    ])
    return rows[0]!
  })

  return toFolderItem(updated)
})
