// Despierta el servicio de descargas y dice cómo está (FR-010, research D7). 503 si no está configurado.
import { setResponseHeader } from 'h3'
import type { YoutubeServiceHealth } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<YoutubeServiceHealth> => {
  requireRole(event, 'editor')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return pingService()
})
