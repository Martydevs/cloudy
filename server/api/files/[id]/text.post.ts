// Lectura del texto en la petición (feature 002, contracts/api): respaldo de la lectura en segundo plano
// y, con `force`, Reintentar y Volver a leer. Un fallo de lectura responde 200 con `status: 'failed'`.
import type { ImageText } from '#shared/types/api'
import { imageTextReadInput } from '#shared/validation/image-text'

export default defineEventHandler(async (event): Promise<ImageText> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  const { force } = await readValid(event, imageTextReadInput)
  await getVisibleImage(id)
  return requestImageTextRead({ table: 'files', id }, { force })
})
