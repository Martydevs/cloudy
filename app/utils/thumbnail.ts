// Miniatura WEBP de 320 px generada en el navegador (research R9): el servidor no procesa imágenes.
const DECODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_SIDE = 320

export async function makeThumbnail(file: File): Promise<Blob | null> {
  if (!DECODABLE.has(file.type)) return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.8))
  }
  catch {
    // HEIC u otros formatos que el navegador no decodifica: se muestra el ícono de la categoría.
    return null
  }
}
