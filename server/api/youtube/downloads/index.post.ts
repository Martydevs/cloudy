// Registra una descarga ya guardada por el navegador (hasta 10 videos, como el trabajo que la produjo). Solo cuentan los
// videos que Cloudy conoce; devuelve cuántos quedaron registrados.
import { youtubeJobInput } from '#shared/validation/youtube'

export default defineEventHandler(async (event): Promise<{ recorded: number }> => {
  const { profile } = requireRole(event, 'editor')
  const { videoIds, format } = await readValid(event, youtubeJobInput)
  return { recorded: await recordDownloads(videoIds, format, profile) }
})
