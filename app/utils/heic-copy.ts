// Copia JPEG de una foto HEIC para leer su texto (feature 002, research A4), generada en el navegador
// como las miniaturas: el modelo no acepta HEIC y `heic-to` solo funciona en el navegador. `heic-to`
// (~3 MB) se carga con `import()` dinámico solo cuando se elige una HEIC.
import { isImageTextEligible, MAX_IMAGE_TEXT_BYTES } from '#shared/constants/image-text'
import { getExtension } from '#shared/constants/files'

const QUALITY = 0.85
/** Segundo intento si la primera copia supera 5 MB. */
const RETRY_QUALITY = 0.7

/** Copia JPEG de ≤ 5 MB de una HEIC apta, o `null` (no es HEIC apta, no se pudo convertir o pesa demasiado). */
export async function makeTextSourceCopy(file: File): Promise<Blob | null> {
  if (getExtension(file.name) !== 'heic' || !isImageTextEligible({ extension: 'heic', size: file.size })) return null
  try {
    const { heicTo } = await import('heic-to')
    for (const quality of [QUALITY, RETRY_QUALITY]) {
      const copy = await heicTo({ blob: file, type: 'image/jpeg', quality })
      if (copy.size > 0 && copy.size <= MAX_IMAGE_TEXT_BYTES) return copy
    }
    return null
  }
  catch {
    // Sin copia la foto se sube igual y queda "no disponible" para la lectura (FR-023).
    return null
  }
}

/** Convierte y sube la copia con su PUT prefirmado. Nunca rechaza: la subida del original sigue igual. */
export async function uploadTextSourceCopy(file: File, url: string | undefined): Promise<void> {
  if (!url) return
  const copy = await makeTextSourceCopy(file)
  if (!copy) return
  await putWithProgress(url, copy, { 'content-type': 'image/jpeg' }, () => {}).catch(() => {})
}
