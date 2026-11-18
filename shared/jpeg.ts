// Lectura mínima del encabezado de un JPEG (función pura, sin dependencias): el ancho y el alto de la plantilla de
// Peticiones, para pedirle al modelo una imagen con su misma relación de aspecto.

export interface ImageSize {
  width: number
  height: number
}

/** Marcadores SOF (inicio de trama) que llevan el tamaño: C0–CF salvo C4 (tablas Huffman), C8 (reservado) y CC (aritmética). */
const isFrameMarker = (marker: number) => marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC

/** Ancho y alto de un JPEG leídos de su segmento SOF, o `null` si los bytes no son un JPEG legible. */
export function jpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xFF) return null
    const marker = bytes[offset + 1]!
    // Relleno entre segmentos.
    if (marker === 0xFF) {
      offset += 1
      continue
    }
    // Marcadores sin longitud (RSTn, SOI, TEM).
    if ((marker >= 0xD0 && marker <= 0xD8) || marker === 0x01) {
      offset += 2
      continue
    }
    // Fin de la imagen o inicio de los datos comprimidos: ya no hay encabezados.
    if (marker === 0xD9 || marker === 0xDA) return null
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    if (length < 2) return null
    if (isFrameMarker(marker)) {
      // FF Cn · longitud (2) · precisión (1) · alto (2) · ancho (2)
      if (offset + 8 >= bytes.length) return null
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += 2 + length
  }
  return null
}

/** Relaciones de aspecto que acepta `image_config.aspect_ratio` de OpenRouter. */
export const IMAGE_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number]

/** La relación admitida más cercana a `width / height` (distancia en escala logarítmica: 2:1 y 1:2 quedan igual de lejos de 1:1). */
export function nearestAspectRatio({ width, height }: ImageSize): ImageAspectRatio {
  const target = Math.log(width / height)
  let best: ImageAspectRatio = '1:1'
  let distance = Infinity
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number) as [number, number]
    const d = Math.abs(Math.log(w / h) - target)
    if (d < distance) {
      best = ratio
      distance = d
    }
  }
  return best
}
