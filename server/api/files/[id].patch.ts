// Renombrar o mover un archivo; la extensión no cambia (FR-011).
import { eq } from 'drizzle-orm'
import type { FileItem } from '#shared/types/api'
import { ensureExtension, fileRenameInput } from '#shared/validation/files'
import { files } from '../../db/schema'

export default defineEventHandler(async (event): Promise<FileItem> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const input = await readValid(event, fileRenameInput)
  const file = await getVisibleFile(id)

  const targetFolder = input.folderId === undefined ? file.folderId : input.folderId
  const moving = targetFolder !== file.folderId
  if (moving && targetFolder) await getVisibleFolder(targetFolder)

  const db = useDb()
  const updated = await retryOnUniqueViolation(async () => {
    const wanted = input.name ? ensureExtension(input.name, file.extension) : file.name
    const finalName = withSuffix(wanted, await takenNames('file', targetFolder, wanted, id))
    const renamed = finalName !== file.name
    const [rows] = await db.batch([
      db.update(files)
        .set({ name: finalName, folderId: targetFolder, updatedAt: new Date() })
        .where(eq(files.id, id))
        .returning(),
      ...(renamed ? [activityInsert(profile, 'file.rename', { type: 'file', id, label: finalName }, { from: file.name, to: finalName })] : []),
      ...(moving ? [activityInsert(profile, 'file.move', { type: 'file', id, label: finalName }, { from: file.folderId, to: targetFolder })] : []),
    ])
    return rows[0]!
  })

  return toFileItem({ ...updated, uploaderName: file.uploaderName }, { commentCount: file.commentCount })
})
