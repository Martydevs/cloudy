// Conversión HEIC → JPEG en el navegador antes de subir: solo Safari decodifica HEIC, así que la foto se guarda como
// JPEG (`IMG_0001.heic` → `IMG_0001.jpg`) y la HEIC no se sube. `heic-to` (~3 MB) solo funciona en el navegador y se
// carga con `import()` dinámico solo cuando de verdad se va a convertir.
import { getExtension } from '#shared/constants/files'
import { hasHeicBrand, isHeicConvertible, MAX_HEIC_CONVERSION_BYTES } from '#shared/constants/heic'

const QUALITY = 0.85
/** Segundo intento si el primer JPEG supera 5 MB. */
const RETRY_QUALITY = 0.7

const convertible = (file: File) => isHeicConvertible({ extension: getExtension(file.name), size: file.size })

/** Los primeros bytes del archivo son de una HEIC. Nunca rechaza. */
async function looksLikeHeic(file: File): Promise<boolean> {
  try {
    return hasHeicBrand(new Uint8Array(await file.slice(0, 16).arrayBuffer()))
  }
  catch {
    return false
  }
}

/** `IMG_0001.HEIC` → `IMG_0001.jpg`. */
export function jpegName(name: string): string {
  return name.replace(/\.heic$/i, '.jpg')
}

/**
 * ¿Se convierte este archivo? Tiene que ser una HEIC de hasta 5 MB. En un dispositivo Apple (de donde salen casi
 * todas las HEIC) basta con la extensión; en cualquier otro, antes de descargar `heic-to` se comprueba la firma del
 * archivo, porque una HEIC que llega a Windows o Android por cable o WhatsApp es justo la que más lo necesita.
 */
export async function shouldConvertHeic(file: File, apple = isAppleDevice()): Promise<boolean> {
  if (!convertible(file)) return false
  return apple || await looksLikeHeic(file)
}

/**
 * JPEG de ≤ 5 MB de una HEIC convertible, con el nombre cambiado a `.jpg`, o `null` (no es convertible o falló): quien
 * llama sube entonces el original, para que la subida nunca se bloquee. Nunca rechaza.
 */
export async function convertHeicToJpeg(file: File): Promise<File | null> {
  if (!convertible(file)) return null
  try {
    const { heicTo } = await import('heic-to')
    for (const quality of [QUALITY, RETRY_QUALITY]) {
      const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality })
      if (jpeg.size > 0 && jpeg.size <= MAX_HEIC_CONVERSION_BYTES) {
        return new File([jpeg], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified })
      }
    }
    return null
  }
  catch {
    return null
  }
}
