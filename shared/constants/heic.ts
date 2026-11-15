// Conversión HEIC → JPEG al subir, compartida por cliente y servidor. Solo Safari decodifica HEIC: el navegador
// convierte la foto (`app/utils/heic-to-jpeg.ts`) y sube el JPEG como el archivo; la HEIC no se guarda.

/** 5 MB: tope del original HEIC que se convierte y del JPEG que sale (también el de las fotos de la cámara). */
export const MAX_HEIC_CONVERSION_BYTES = 5_242_880

/** Marcas `ftyp` de un contenedor HEIF/HEIC. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'])

/** Una HEIC de hasta 5 MB se convierte a JPEG antes de subirla; una más grande se sube tal cual. */
export function isHeicConvertible({ extension, size }: { extension: string, size: number }): boolean {
  return extension.toLowerCase() === 'heic' && size > 0 && size <= MAX_HEIC_CONVERSION_BYTES
}

/** Los primeros bytes son de un contenedor HEIC (`....ftyp<marca>`). */
export function hasHeicBrand(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const text = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4))
  return text(4) === 'ftyp' && HEIC_BRANDS.has(text(8))
}
