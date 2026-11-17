// Generar una imagen de peticiones (feature 007, contracts/api.md § 2, enmienda de historial; revisión antes de generar):
// 1–4 ids de peticiones → una imagen sobre la plantilla, con el texto que una persona verificó para cada una (lo carga el
// servidor; sin él, `409 transcript_unverified`). El servidor comprueba que sigan disponibles, sube la imagen al bucket
// (`peticiones/<id>.<ext>`), guarda su fila y responde `201` con el JSON de la imagen: el binario ya no vuelve por esta
// función. Si no se puede guardar, `502 save_failed` sin dejar el objeto suelto. Con `generationId` (página de generación),
// las peticiones deben ser uno de sus grupos (`404 generation_not_found`, `409 generation_mismatch`) y la imagen queda ligada a ella.
import { setResponseHeader, setResponseStatus } from 'h3'
import type { PrayerGeneratedImage } from '#shared/types/api'
import { prayerImageInput } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<PrayerGeneratedImage> => {
  const { profile } = requireRole(event, 'editor')
  const { fileIds, generationId } = await readValid(event, prayerImageInput)
  // Cada imagen gasta crédito: el límite va antes de leer nada.
  try {
    await hitRateLimit(event, `peticiones-img:${profile.userId}`, { limit: 60, windowSec: 3600 })
  }
  catch (error) {
    const limited = error as { statusCode?: number, data?: Record<string, unknown> }
    if (limited.statusCode === 429) throw prayerError('rate_limited', limited.data ?? {})
    throw error
  }

  if (generationId) await assertPrayerGenerationGroup(generationId, fileIds)

  // Si la persona cierra la pestaña o cancela, se deja de esperar al proveedor.
  const controller = new AbortController()
  event.node.res.once('close', () => {
    if (!event.node.res.writableFinished) controller.abort()
  })

  const image = await createPrayerImage(fileIds, { abortSignal: controller.signal })
  const saved = await savePrayerImage({
    fileIds,
    mediaType: image.mediaType,
    data: image.data,
    author: profile,
    generationId: generationId ?? null,
  })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, 201)
  return saved
})
