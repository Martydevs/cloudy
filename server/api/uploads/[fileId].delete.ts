// Cancelar una subida en curso: borra el objeto y el registro.
export default defineEventHandler(async (event) => {
  const { profile } = requireRole(event, 'editor')
  const row = await getOwnUpload(paramId(event, 'fileId'), profile.userId)
  await discardUpload(row)
  setResponseStatus(event, 204)
  return null
})
