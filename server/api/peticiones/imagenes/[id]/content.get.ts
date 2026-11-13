// Ver o descargar una imagen generada (feature 007, enmienda de historial): 302 a una URL firmada; el binario nunca pasa por
// la función. Con `?download=1`, `Content-Disposition: attachment` y el nombre `peticiones-AAAA-MM-DD-<id>.<ext>`.
import { getQuery, sendRedirect, setResponseHeader } from 'h3'
import { presignGet } from '../../../../utils/storage'

export default defineEventHandler(async (event) => {
  requireRole(event, 'editor')
  const image = await getPrayerImage(paramId(event))
  const download = getQuery(event).download === '1'
  const url = await presignGet(image.storageKey, download ? { download: prayerImageFilename(image) } : {})
  setResponseHeader(event, 'Cache-Control', 'private, max-age=600')
  return sendRedirect(event, url, 302)
})
