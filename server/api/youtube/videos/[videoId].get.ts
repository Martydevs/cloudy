// Ficha de un video y registro en el historial compartido (FR-006, FR-022, research D10): sonda → upsert en un
// `db.batch` → respuesta. Si la sonda dice que el video no existe o es privado, se devuelve lo guardado (si hay).
import { setResponseHeader } from 'h3'
import type { YoutubeVideoDetail } from '#shared/types/api'
import { isBlockReason } from '#shared/constants/youtube'

export default defineEventHandler(async (event): Promise<YoutubeVideoDetail> => {
  const { profile } = requireRole(event, 'editor')
  const videoId = videoIdParam(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')

  let detail: YoutubeVideoDetail
  try {
    detail = await probeVideo(videoId)
  }
  catch (error) {
    const { statusCode, data } = error as { statusCode?: number, data?: { code?: unknown } }
    if (statusCode !== 404) throw error
    // Sin fila previa no hay qué mostrar: el 404 de la frontera sale tal cual y no se registra nada.
    const stored = await findStoredVideo(videoId)
    if (!stored) throw error
    const video = toYoutubeVideo(stored)
    await useDb().batch([upsertVideoView(video, profile)])
    return { ...video, availableHeights: [], downloadable: false, reason: isBlockReason(data?.code) ? data.code : 'unavailable' }
  }

  await useDb().batch([upsertVideoView(detail, profile)])
  return { ...detail, ...cleanVideo(detail) }
})
