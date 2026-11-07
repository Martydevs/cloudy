// Lectura y reescritura mínimas de un `.zip` en memoria (feature 006, lote de presentaciones): sacar el `manifest.json`
// que cloudy-api pone en el lote y quitarlo antes de enviárselo a la persona, sin agregar una dependencia. Las dos
// funciones comparten una lectura del directorio central; acepta entradas guardadas (método 0, lo que manda el servicio)
// y comprimidas (método 8). Sin ZIP64 ni cifrado: lo que no entiende es `null`.
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054B50
const CENTRAL = 0x02014B50
const LOCAL = 0x04034B50
const EOCD_SIZE = 22
const CENTRAL_SIZE = 46
const LOCAL_SIZE = 30
const MAX_COMMENT = 0xFFFF

interface Entry {
  name: string
  method: number
  size: number
  /** Posición del registro local. */
  local: number
  /** Posición y largo del registro en el directorio central. */
  central: number
  centralLength: number
}

interface Directory {
  entries: Entry[]
  /** Posición del directorio central y del registro de fin (EOCD). */
  offset: number
  eocd: number
}

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** Directorio central, o `null` si el archivo no se puede leer (sin ZIP64). */
function readDirectory(zip: Uint8Array): Directory | null {
  if (zip.length < EOCD_SIZE) return null
  const view = viewOf(zip)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)

  // El fin del directorio central está al final, seguido de un comentario opcional.
  let eocd = -1
  for (let at = zip.length - EOCD_SIZE; at >= Math.max(0, zip.length - EOCD_SIZE - MAX_COMMENT); at--) {
    if (u32(at) === EOCD) {
      eocd = at
      break
    }
  }
  if (eocd < 0) return null

  const decoder = new TextDecoder()
  const offset = u32(eocd + 16)
  const entries: Entry[] = []
  let at = offset
  for (let n = u16(eocd + 10); n > 0; n--) {
    if (at + CENTRAL_SIZE > eocd || u32(at) !== CENTRAL) return null
    const nameLength = u16(at + 28)
    const centralLength = CENTRAL_SIZE + nameLength + u16(at + 30) + u16(at + 32)
    if (at + centralLength > eocd) return null
    entries.push({
      name: decoder.decode(zip.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength)),
      method: u16(at + 10),
      size: u32(at + 20),
      local: u32(at + 42),
      central: at,
      centralLength,
    })
    at += centralLength
  }
  return { entries, offset, eocd }
}

/** Bytes de la entrada `name`, o `null` si no está o el archivo no se puede leer. */
export function readZipEntry(zip: Uint8Array, name: string): Uint8Array | null {
  const entry = readDirectory(zip)?.entries.find(e => e.name === name)
  if (!entry) return null
  const view = viewOf(zip)
  const { local, size, method } = entry
  if (local + LOCAL_SIZE > zip.length || view.getUint32(local, true) !== LOCAL) return null
  const start = local + LOCAL_SIZE + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
  if (start + size > zip.length) return null
  const data = zip.subarray(start, start + size)
  if (method === 0) return data
  if (method !== 8) return null
  try {
    return new Uint8Array(inflateRawSync(data))
  }
  catch {
    return null
  }
}

/**
 * Copia de `zip` sin la entrada `name` (el mismo `zip` si no está). Cada registro local se copia entero, hasta el siguiente
 * registro o el directorio central, así que los descriptores de datos vienen con él; los desplazamientos del directorio
 * central y el registro de fin (con su comentario) se recalculan. `null` si el archivo no se puede leer.
 */
export function withoutZipEntry(zip: Uint8Array, name: string): Uint8Array | null {
  const dir = readDirectory(zip)
  if (!dir) return null
  if (!dir.entries.some(e => e.name === name)) return zip
  const view = viewOf(zip)

  // Fin de cada registro local: el inicio del siguiente (por posición) o el directorio central.
  const starts = [...new Set(dir.entries.map(e => e.local))].sort((a, b) => a - b)
  const endOf = (local: number) => starts[starts.indexOf(local) + 1] ?? dir.offset

  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of dir.entries) {
    if (entry.name === name) continue
    const end = endOf(entry.local)
    if (entry.local + LOCAL_SIZE > end || view.getUint32(entry.local, true) !== LOCAL) return null
    locals.push(zip.subarray(entry.local, end))
    const central = new Uint8Array(zip.subarray(entry.central, entry.central + entry.centralLength))
    viewOf(central).setUint32(42, offset, true)
    centrals.push(central)
    offset += end - entry.local
  }

  const end = new Uint8Array(zip.subarray(dir.eocd))
  const endView = viewOf(end)
  endView.setUint16(8, centrals.length, true)
  endView.setUint16(10, centrals.length, true)
  endView.setUint32(12, centrals.reduce((n, c) => n + c.length, 0), true)
  endView.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
