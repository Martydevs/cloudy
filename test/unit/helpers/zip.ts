// Arma un `.zip` en memoria para las pruebas (sin dependencias): entradas guardadas (método 0, como las manda cloudy-api)
// o comprimidas (método 8). El CRC va en cero: `readZipEntry` no lo revisa.
import { deflateRawSync } from 'node:zlib'

export function makeZip(entries: Record<string, string | Uint8Array>, { deflate = false, comment = '' } = {}): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(encoder.encode(name))
    const raw = Buffer.from(typeof content === 'string' ? encoder.encode(content) : content)
    const data = deflate ? deflateRawSync(raw) : raw
    const method = deflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)

    offset += local.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const commentBytes = Buffer.from(encoder.encode(comment))
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(commentBytes.length, 20)
  return new Uint8Array(Buffer.concat([...locals, directory, end, commentBytes]))
}
