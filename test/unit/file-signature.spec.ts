import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matchesSignature } from '../../server/utils/file-signature'

const head = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/files/${name}`, import.meta.url))).subarray(0, 4096)

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)

describe('matchesSignature con las fixtures', () => {
  it.each([
    ['jpg', 'foto.jpg'],
    ['jpeg', 'foto.jpg'],
    ['png', 'imagen.png'],
    ['webp', 'imagen.webp'],
    ['gif', 'anim.gif'],
    ['mp3', 'audio.mp3'],
    ['wav', 'audio.wav'],
    ['ogg', 'audio.ogg'],
    ['mp4', 'clip.mp4'],
    ['pptx', 'deck.pptx'],
    ['docx', 'doc.docx'],
    ['pdf', 'slides.pdf'],
    ['txt', 'notas.txt'],
    ['md', 'notas.md'],
  ])('%s ← %s', (ext, file) => {
    expect(matchesSignature(ext, head(file))).toBe(true)
  })

  it('rechaza un ejecutable renombrado (MZ)', () => {
    expect(matchesSignature('jpg', head('falso.jpg'))).toBe(false)
    expect(matchesSignature('txt', head('falso.jpg'))).toBe(false)
  })

  it('rechaza contenido de otro tipo', () => {
    expect(matchesSignature('png', head('foto.jpg'))).toBe(false)
    expect(matchesSignature('mp3', head('audio.wav'))).toBe(false)
    expect(matchesSignature('pdf', head('deck.pptx'))).toBe(false)
  })

  it('distingue PPTX de DOCX dentro del ZIP', () => {
    expect(matchesSignature('pptx', head('doc.docx'))).toBe(false)
    expect(matchesSignature('docx', head('deck.pptx'))).toBe(false)
  })
})

describe('matchesSignature con bytes construidos', () => {
  it('texto con bytes nulos no es TXT', () => {
    expect(matchesSignature('txt', bytes(0x68, 0x6F, 0x00, 0x6C, 0x61))).toBe(false)
  })

  it('UTF-8 inválido no es TXT, pero un carácter cortado al final sí se tolera', () => {
    expect(matchesSignature('md', bytes(0x61, 0xC3, 0x28))).toBe(false)
    expect(matchesSignature('md', bytes(0x61, 0x62, 0xC3))).toBe(true)
    expect(matchesSignature('txt', text('Canción de entrada — ñandú'))).toBe(true)
  })

  it('ZIP sin pistas del tipo se acepta para Office/ODF', () => {
    const zip = bytes(0x50, 0x4B, 0x03, 0x04, 0x14, 0x00)
    expect(matchesSignature('pptx', zip)).toBe(true)
    expect(matchesSignature('odp', zip)).toBe(true)
    expect(matchesSignature('key', zip)).toBe(true)
  })

  it('ODP por su mimetype', () => {
    const odp = new Uint8Array([...bytes(0x50, 0x4B, 0x03, 0x04), ...text('mimetypeapplication/vnd.oasis.opendocument.presentation')])
    const odt = new Uint8Array([...bytes(0x50, 0x4B, 0x03, 0x04), ...text('mimetypeapplication/vnd.oasis.opendocument.text')])
    expect(matchesSignature('odp', odp)).toBe(true)
    expect(matchesSignature('odp', odt)).toBe(false)
    expect(matchesSignature('pptx', odt)).toBe(false)
  })

  it('PPT y Keynote antiguos usan OLE', () => {
    const ole = bytes(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)
    expect(matchesSignature('ppt', ole)).toBe(true)
    expect(matchesSignature('key', ole)).toBe(true)
    expect(matchesSignature('ppt', bytes(0x50, 0x4B, 0x03, 0x04))).toBe(false)
  })

  it('HEIC, MOV, M4A y AAC', () => {
    const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...text('ftyp'), ...text(brand)])
    expect(matchesSignature('heic', ftyp('heic'))).toBe(true)
    expect(matchesSignature('heic', ftyp('mif1'))).toBe(true)
    expect(matchesSignature('heic', ftyp('isom'))).toBe(false)
    expect(matchesSignature('mov', ftyp('qt  '))).toBe(true)
    expect(matchesSignature('mov', new Uint8Array([0, 0, 0, 8, ...text('wide')]))).toBe(true)
    expect(matchesSignature('m4a', ftyp('M4A '))).toBe(true)
    expect(matchesSignature('aac', bytes(0xFF, 0xF1, 0x50))).toBe(true)
    expect(matchesSignature('aac', bytes(0xFF, 0xFB, 0x50))).toBe(false)
  })

  it('MP3 por frame sync sin ID3', () => {
    expect(matchesSignature('mp3', bytes(0xFF, 0xFB, 0x90, 0x64))).toBe(true)
    expect(matchesSignature('mp3', bytes(0xFF, 0xD8, 0xFF))).toBe(false)
  })

  it('PDF con cabecera desplazada dentro del primer KB', () => {
    expect(matchesSignature('pdf', text('\n\n%PDF-1.7'))).toBe(true)
  })

  it('vacío o extensión desconocida', () => {
    expect(matchesSignature('jpg', new Uint8Array())).toBe(false)
    expect(matchesSignature('exe', bytes(0x4D, 0x5A))).toBe(false)
  })
})
