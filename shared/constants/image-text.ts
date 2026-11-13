// Reglas de la copia JPEG que el navegador hace de un HEIC antes de subirlo, compartidas por cliente y servidor.
// Lo que queda de la feature 002: la lectura del texto de las imágenes se retiró, pero la copia sigue subiéndose
// (`textsrc/<id>.jpg`) y la limpieza diaria la borra junto al original.

const IMAGE_TEXT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic'] as const

/** 5 MB: se compara con el tamaño original del archivo (y con la copia JPEG de una HEIC). */
export const MAX_IMAGE_TEXT_BYTES = 5_242_880

/** Imagen JPG/JPEG/PNG/HEIC de hasta 5 MB: solo estas llevan copia JPEG cuando son HEIC. */
export function isImageTextEligible({ category = 'image', extension, size }: { category?: string, extension: string, size: number }): boolean {
  return category === 'image'
    && (IMAGE_TEXT_EXTENSIONS as readonly string[]).includes(extension.toLowerCase())
    && size > 0
    && size <= MAX_IMAGE_TEXT_BYTES
}
