// Copia JPEG de vista previa de una HEIC antigua (solo Safari decodifica HEIC): 302 a una URL firmada; el binario nunca
// pasa por la función. Las HEIC nuevas ya se suben convertidas a JPEG; 404 si el archivo no tiene copia.
import { createError } from 'h3'
import { presignGet } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  requireRole(event, 'editor')
  const file = await getVisibleFile(paramId(event))
  if (!file.previewKey) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'El archivo no tiene vista previa' })
  const url = await presignGet(file.previewKey)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=600')
  return sendRedirect(event, url, 302)
})
