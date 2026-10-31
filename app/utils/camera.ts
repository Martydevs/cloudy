// Cámara dentro de Cloudy (feature 003, research B8): funciones puras de la foto. La foto sale como JPEG de
// ≤ 5 MB, igual que la copia de una HEIC (`heic-copy.ts`), para que la lectura de texto (feature 002) la acepte.
import { MAX_IMAGE_TEXT_BYTES } from '#shared/constants/image-text'

const QUALITY = 0.85
/** Segundo intento si la primera pasada supera 5 MB. */
const RETRY_QUALITY = 0.7

export type CameraErrorKey = 'denied' | 'notFound' | 'busy' | 'failed'

const pad = (n: number) => String(n).padStart(2, '0')

/** `foto-AAAAMMDD-HHMMSS.jpg` con la hora local de quien la toma. */
export function photoFileName(date: Date): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `foto-${day}-${time}.jpg`
}

/** Error de `getUserMedia` → clave de `messages.camera`. */
export function cameraErrorKey(error: unknown): CameraErrorKey {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'notFound'
    case 'NotReadableError':
    case 'AbortError':
      return 'busy'
    default:
      return 'failed'
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('No se pudo codificar la foto'))), 'image/jpeg', quality)
  })
}

/** JPEG a calidad 0.85; si pasa de 5 MB, una segunda pasada a 0.7. */
export async function encodeJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const first = await toBlob(canvas, QUALITY)
  return first.size > MAX_IMAGE_TEXT_BYTES ? toBlob(canvas, RETRY_QUALITY) : first
}
