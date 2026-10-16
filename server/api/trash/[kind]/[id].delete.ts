// Eliminar definitivamente un elemento de la papelera (FR-035).
export default defineEventHandler(async (event) => {
  const { profile } = requireRole(event, 'editor')
  const kind = paramTrashKind(event)
  const id = paramId(event)
  const root = await getTrashRoot(kind, id)

  if (await purge([id])) {
    await activityInsert(profile, kind === 'file' ? 'file.purge' : 'folder.purge', { type: kind, id, label: root.name })
  }

  setResponseStatus(event, 204)
  return null
})
