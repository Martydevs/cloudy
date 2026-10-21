// Estado del texto de una imagen (feature 002, contracts/api): el panel lo consulta mientras dura `reading`.
import type { ImageText } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<ImageText> => {
  requireRole(event, 'editor')
  const { id } = await getVisibleImage(paramId(event))
  return getImageText({ table: 'files', id })
})
