// Miniatura WEBP generada en el navegador al subir (research R9); 404 si el archivo no tiene.
import { createError } from 'h3'
import { presignGet } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  requireRole(event, 'editor')
  const file = await getVisibleFile(paramId(event))
  if (!file.thumbKey) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El archivo no tiene miniatura' })
  const url = await presignGet(file.thumbKey)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=600')
  return sendRedirect(event, url, 302)
})
