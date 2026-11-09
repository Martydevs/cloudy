// Crea una descarga o una copia de reproducción de hasta 10 videos (FR-007, FR-008, FR-020). El servicio sondea los
// videos antes de encolar; si alguno no se puede, 422 con `data.videos` y no se crea nada. Sin `engine` prueba el
// motor `v2` y, si falla, `v1`; con `engine` usa solo ese (el navegador repite en `v1` lo que falló dentro de un trabajo).
import { setResponseStatus } from 'h3'
import type { YoutubeJob } from '#shared/types/api'
import { youtubeJobInput } from '#shared/validation/youtube'

export default defineEventHandler(async (event): Promise<YoutubeJob> => {
  requireRole(event, 'editor')
  const { videoIds, format, engine } = await readValid(event, youtubeJobInput)
  const job = await createJob(videoIds, format, event, engine)
  setResponseStatus(event, 202)
  return queuedJob(job.jobId, videoIds, format, job.engine)
})
