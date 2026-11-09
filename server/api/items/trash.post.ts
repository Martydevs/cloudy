// Enviar a la papelera varios archivos y carpetas a la vez (selección múltiple de Archivos; FR-011, FR-034).
// Misma lógica que `DELETE /api/files/:id` y `DELETE /api/folders/:id` (`trashFileOps`, `trashFolderOps`), en un solo
// `db.batch`: o todo va a la papelera o nada. Lo que ya no está visible (otra persona lo movió a la papelera, o el id
// no existe) se salta y se informa en `skipped`, sin fallar el resto.
import { and, inArray, isNull } from 'drizzle-orm'
import type { TrashItemsResult } from '#shared/types/api'
import { trashItemsInput } from '#shared/validation/files'
import { files, folders } from '../../db/schema'

export default defineEventHandler(async (event): Promise<TrashItemsResult> => {
  const { profile } = requireRole(event, 'editor')
  const input = await readValid(event, trashItemsInput)
  const fileIds = [...new Set(input.fileIds)]
  const folderIds = [...new Set(input.folderIds)]

  const db = useDb()
  // Dos consultas para toda la selección (sin N+1): lo que sigue visible de cada tipo.
  const [fileRows, folderRows] = await Promise.all([
    fileIds.length
      ? db.select({ id: files.id, name: files.name }).from(files).where(and(inArray(files.id, fileIds), visibleFilesWhere()))
      : [],
    folderIds.length
      ? db.select({ id: folders.id, name: folders.name }).from(folders).where(and(inArray(folders.id, folderIds), isNull(folders.deletedAt)))
      : [],
  ])

  const visible = new Set([...fileRows, ...folderRows].map(row => row.id))
  const skipped = [...fileIds, ...folderIds].filter(id => !visible.has(id))

  // Primero los archivos: si también se eligió su carpeta, quedan como raíz propia de la papelera (igual que al
  // eliminar un archivo y después su carpeta) y la sentencia de la carpeta ya no los toca.
  const queries = [
    ...fileRows.flatMap(file => trashFileOps(file, profile)),
    ...folderRows.map(folder => trashFolderOps(folder, profile)),
  ]
  if (queries.length > 0) {
    // `db.batch` pide una tupla no vacía; aquí la lista se arma según la selección.
    await db.batch(queries as unknown as Parameters<typeof db.batch>[0])
  }

  return { trashed: visible.size, skipped }
})
