// Validación del contenido real por firma binaria (magic bytes), research R6 / FR-009.
// Recibe los primeros 4 KB del objeto; no depende de librerías externas.

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length))

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte)

const isZip = (b: Uint8Array) => startsWith(b, [0x50, 0x4B, 0x03, 0x04])
const isOle = (b: Uint8Array) => startsWith(b, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
const isRiff = (b: Uint8Array, format: string) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === format
const ftypBrand = (b: Uint8Array) => ascii(b, 4, 4) === 'ftyp' ? ascii(b, 8, 4) : null

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'])
const QUICKTIME_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'])

/** Texto del contenedor ZIP visible en los primeros bytes (nombres de entradas y XML sin comprimir). */
function zipText(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes)
}

/**
 * Distingue documentos OOXML/ODF dentro de un ZIP. Si los primeros 4 KB no muestran de qué tipo
 * es (por ejemplo, `[Content_Types].xml` comprimido), se acepta el ZIP para la extensión de Office/ODF.
 */
function zipMatches(bytes: Uint8Array, wanted: 'pptx' | 'docx' | 'odp' | 'key'): boolean {
  if (!isZip(bytes)) return false
  const text = zipText(bytes)
  const looksPptx = text.includes('ppt/') || text.includes('presentationml')
  const looksDocx = text.includes('word/') || text.includes('wordprocessingml')
  const odfMime = /application\/vnd\.oasis\.opendocument\.([a-z-]+)/.exec(text)?.[1]
  switch (wanted) {
    case 'pptx':
      return !looksDocx && !odfMime
    case 'docx':
      return !looksPptx && !odfMime
    case 'odp':
      return !looksPptx && !looksDocx && (!odfMime || odfMime === 'presentation')
    case 'key':
      return !looksPptx && !looksDocx && !odfMime
  }
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0x00)) return false
  try {
    // `stream: true` tolera un carácter multibyte cortado al final de los 4 KB.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true })
    return true
  }
  catch {
    return false
  }
}

const isMp3 = (b: Uint8Array) =>
  ascii(b, 0, 3) === 'ID3' || (b[0] === 0xFF && [0xFB, 0xFA, 0xF3, 0xF2].includes(b[1] ?? 0))

const isAdts = (b: Uint8Array) => b[0] === 0xFF && (b[1] === 0xF1 || b[1] === 0xF9)

export function matchesSignature(ext: string, bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  switch (ext.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return startsWith(bytes, [0xFF, 0xD8, 0xFF])
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    case 'gif':
      return ascii(bytes, 0, 4) === 'GIF8'
    case 'webp':
      return isRiff(bytes, 'WEBP')
    case 'heic':
      return HEIC_BRANDS.has(ftypBrand(bytes) ?? '')
    case 'mp4':
    case 'm4a':
      return ftypBrand(bytes) !== null
    case 'mov':
      return ftypBrand(bytes) !== null || QUICKTIME_ATOMS.has(ascii(bytes, 4, 4))
    case 'mp3':
      return isMp3(bytes)
    case 'aac':
      return isAdts(bytes) || ascii(bytes, 0, 4) === 'ADIF' || ascii(bytes, 0, 3) === 'ID3'
    case 'wav':
      return isRiff(bytes, 'WAVE')
    case 'ogg':
      return ascii(bytes, 0, 4) === 'OggS'
    case 'pdf':
      return ascii(bytes, 0, Math.min(bytes.length, 1024)).includes('%PDF-')
    case 'ppt':
      return isOle(bytes)
    case 'pptx':
    case 'docx':
    case 'odp':
      return zipMatches(bytes, ext.toLowerCase() as 'pptx' | 'docx' | 'odp')
    case 'key':
      return zipMatches(bytes, 'key') || isOle(bytes)
    case 'txt':
    case 'md':
      return isUtf8Text(bytes)
    default:
      return false
  }
}
