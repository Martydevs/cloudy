// Genera las fixtures binarias de test/fixtures/files (< 200 KB cada una).
// Uso: `bun test/fixtures/generate.ts`. Las imágenes salen del canvas de Chromium para que sean decodificables.
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'
import { chromium } from 'playwright-core'

const dir = new URL('./files/', import.meta.url)
mkdirSync(dir, { recursive: true })
const write = (name: string, data: Uint8Array | string) => writeFileSync(new URL(name, dir), data)

// ---------------------------------------------------------------- imágenes (canvas)
const browser = await chromium.launch()
const page = await browser.newPage()
const images = await page.evaluate(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 640, 480)
  gradient.addColorStop(0, '#f59e0b')
  gradient.addColorStop(1, '#0ea5e9')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 640, 480)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 72px sans-serif'
  ctx.fillText('Cloudy', 180, 260)
  // El PNG no tiene pérdida: se codifica desde una copia pequeña para no pasar de 200 KB.
  const small = document.createElement('canvas')
  small.width = 160
  small.height = 120
  small.getContext('2d')!.drawImage(canvas, 0, 0, 160, 120)
  const encode = (source: HTMLCanvasElement, type: string) => new Promise<number[]>((resolve) => {
    source.toBlob(async blob => resolve([...new Uint8Array(await blob!.arrayBuffer())]), type, 0.8)
  })
  return {
    jpg: await encode(canvas, 'image/jpeg'),
    png: await encode(small, 'image/png'),
    webp: await encode(canvas, 'image/webp'),
  }
})
await browser.close()
write('foto.jpg', new Uint8Array(images.jpg))
write('imagen.png', new Uint8Array(images.png))
write('imagen.webp', new Uint8Array(images.webp))

// GIF 1×1 transparente.
write('anim.gif', Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')))

// ---------------------------------------------------------------- audio y video
function wav(seconds: number, rate = 8000): Uint8Array {
  const samples = seconds * rate
  const buffer = Buffer.alloc(44 + samples)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate, 28)
  buffer.writeUInt16LE(1, 32)
  buffer.writeUInt16LE(8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples, 40)
  for (let i = 0; i < samples; i++) buffer[44 + i] = 128 + Math.round(40 * Math.sin(i / 8))
  return buffer
}
write('audio.wav', wav(1))

// MP3: etiqueta ID3v2 vacía + frames MPEG-1 Layer III de 128 kbps / 44.1 kHz en silencio.
const id3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const frame = Buffer.alloc(417)
frame.set([0xFF, 0xFB, 0x90, 0x64])
write('audio.mp3', Buffer.concat([id3, ...Array.from({ length: 40 }, () => frame)]))

// OGG: página inicial con la firma `OggS` (no se reproduce; sirve para la validación de firma).
write('audio.ogg', Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200, 1)]))

// MP4: caja `ftyp` isom + `free`.
const ftyp = Buffer.alloc(24)
ftyp.writeUInt32BE(24, 0)
ftyp.write('ftypisom', 4)
ftyp.writeUInt32BE(512, 12)
ftyp.write('isommp41', 16)
const free = Buffer.alloc(64)
free.writeUInt32BE(64, 0)
free.write('free', 4)
write('clip.mp4', Buffer.concat([ftyp, free]))

// ---------------------------------------------------------------- documentos
/** ZIP sin compresión (método 0), suficiente para OOXML de prueba. */
function zip(entries: Record<string, string>): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content)
    const nameBuf = Buffer.from(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

const contentTypes = (main: string) => `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/main.xml" ContentType="${main}"/></Types>`
write('deck.pptx', zip({
  '[Content_Types].xml': contentTypes('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'),
  'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
}))
write('doc.docx', zip({
  '[Content_Types].xml': contentTypes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'),
  'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
}))

write('slides.pdf', `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF
`)
write('notas.txt', 'Notas del domingo: revisar audio del coro.\n')
write('notas.md', '# Notas\n\n- Ensayo a las 9:00\n- Llevar cables XLR\n')

// Ejecutable con la cabecera `MZ` renombrado a .jpg: el servidor debe rechazarlo (FR-009).
write('falso.jpg', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(510, 0x90)]))

console.log('Fixtures generadas en test/fixtures/files/')
