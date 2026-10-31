// Dar acceso a un invitado (feature 003, FR-009–FR-011): UPDATE condicionado + actividad en una sentencia.
export default defineEventHandler(async (event): Promise<null> => {
  const { profile } = requireRole(event, 'editor')
  const id = paramId(event)
  assertDecided(await decideAccessRequest(id, 'approved', profile))
  setResponseStatus(event, 204)
  return null
})
