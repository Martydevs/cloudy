// Enviar un archivo a la papelera (FR-034).

export default defineEventHandler(async (event) => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  const file = await getVisibleFile(id)

  await useDb().batch([...trashFileOps({ id, name: file.name }, profile)])

  setResponseStatus(event, 204)
  return null
})
