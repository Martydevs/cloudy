// Enviar una carpeta con todo su contenido a la papelera (FR-011, FR-034).
// Una sola sentencia (`trashFolderOps`): marca carpeta, subcarpetas y archivos y registra la actividad (atómico).

export default defineEventHandler(async (event): Promise<{ trashedItems: number }> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const folder = await getVisibleFolder(id)

  const result = await trashFolderOps({ id, name: folder.name }, profile)

  const row = result.rows[0]
  return { trashedItems: (row?.folders ?? 0) + (row?.files ?? 0) }
})
