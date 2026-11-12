// Generar una imagen de peticiones (feature 007, contracts/api.md § 2): 1–4 ids → una imagen sobre la plantilla. El servidor
// relee los textos. La imagen (≤ 4 000 000 bytes) pasa por aquí porque nace en el servidor y no se guarda: segunda excepción
// acotada a «no retransmitir binarios» (plan, Complexity Tracking). No se escribe nada en el bucket ni en la base.
import { setResponseHeader } from 'h3'
import { prayerImageInput } from '#shared/validation/prayers'

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export default defineEventHandler(async (event): Promise<Buffer> => {
  const { profile } = requireRole(event, 'editor')
  const { fileIds } = await readValid(event, prayerImageInput)
  // Cada imagen gasta crédito: el límite va antes de leer nada.
  try {
    await hitRateLimit(event, `peticiones-img:${profile.userId}`, { limit: 60, windowSec: 3600 })
  }
  catch (error) {
    const limited = error as { statusCode?: number, data?: Record<string, unknown> }
    if (limited.statusCode === 429) throw prayerError('rate_limited', limited.data ?? {})
    throw error
  }

  // Si la persona cierra la pestaña o cancela, se deja de esperar al proveedor.
  const controller = new AbortController()
  event.node.res.once('close', () => {
    if (!event.node.res.writableFinished) controller.abort()
  })

  const image = await createPrayerImage(fileIds, { abortSignal: controller.signal })
  const extension = EXTENSIONS[image.mediaType]
  // Un formato que el navegador no sabe nombrar ni mostrar cuenta como salida inválida.
  if (!extension) throw prayerError('invalid_output')

  setResponseHeader(event, 'Content-Type', image.mediaType)
  setResponseHeader(event, 'Content-Disposition', `inline; filename="peticiones.${extension}"`)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'X-Peticiones-Count', String(image.count))
  return Buffer.from(image.data)
})
