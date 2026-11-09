// Lectura y reescritura mínimas de `.zip` (lote de presentaciones): saca `manifest.json` del archivo que manda cloudy-api y
// lo quita del que recibe la persona.
import { describe, expect, it } from 'vitest'
import { readZipEntry, withoutZipEntry } from '../../server/utils/zip'
import { makeZip } from './helpers/zip'

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null)
const u16 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at, true)
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true)
/** Posición del registro de fin (sin comentario, está en los últimos 22 bytes). */
const eocdOf = (bytes: Uint8Array, comment = 0) => bytes.length - 22 - comment

describe('readZipEntry', () => {
  it('lee una entrada guardada entre otras, por nombre exacto', () => {
    const zip = makeZip({ 'Alpha.pptx': new Uint8Array([1, 2, 3]), 'manifest.json': '{"items":[]}' })
    expect(text(readZipEntry(zip, 'manifest.json'))).toBe('{"items":[]}')
    expect([...readZipEntry(zip, 'Alpha.pptx')!]).toEqual([1, 2, 3])
    expect(readZipEntry(zip, 'MANIFEST.json')).toBeNull()
  })

  it('lee entradas comprimidas, con comentario al final y con nombres en UTF-8', () => {
    const zip = makeZip({ 'Canción.txt': 'Señor'.repeat(50) }, { deflate: true, comment: 'hecho por cloudy-api' })
    expect(text(readZipEntry(zip, 'Canción.txt'))).toBe('Señor'.repeat(50))
  })

  it('lo que no es un zip, está cortado o usa un método desconocido → null', () => {
    expect(readZipEntry(new Uint8Array([1, 2, 3]), 'manifest.json')).toBeNull()
    expect(readZipEntry(new Uint8Array(0), 'manifest.json')).toBeNull()
    const zip = makeZip({ 'manifest.json': '{}' })
    // Directorio central que apunta fuera del archivo.
    const broken = zip.slice()
    new DataView(broken.buffer).setUint32(broken.length - 6, 9999, true)
    expect(readZipEntry(broken, 'manifest.json')).toBeNull()
    // Método 99 en el directorio central.
    const odd = zip.slice()
    const central = new DataView(odd.buffer).getUint32(odd.length - 6, true)
    new DataView(odd.buffer).setUint16(central + 10, 99, true)
    expect(readZipEntry(odd, 'manifest.json')).toBeNull()
    // Datos comprimidos inválidos.
    const bad = makeZip({ 'manifest.json': '{}' }).slice()
    const badCentral = new DataView(bad.buffer).getUint32(bad.length - 6, true)
    new DataView(bad.buffer).setUint16(badCentral + 10, 8, true)
    bad[30 + 'manifest.json'.length] = 0xFF
    expect(readZipEntry(bad, 'manifest.json')).toBeNull()
  })
})

describe('withoutZipEntry', () => {
  it('quita el manifest y conserva los .pptx legibles, con conteo y desplazamientos correctos', () => {
    const zip = makeZip({ 'Uno.pptx': new Uint8Array([1, 2, 3]), 'manifest.json': '{"items":[]}', 'Dos.pptx': new Uint8Array([4, 5]) })
    const clean = withoutZipEntry(zip, 'manifest.json')!
    expect(clean).not.toBeNull()
    expect(readZipEntry(clean, 'manifest.json')).toBeNull()
    expect([...readZipEntry(clean, 'Uno.pptx')!]).toEqual([1, 2, 3])
    expect([...readZipEntry(clean, 'Dos.pptx')!]).toEqual([4, 5])
    // El mismo archivo que armaría `makeZip` sin el manifest: registros locales, directorio y fin coinciden byte a byte.
    expect([...clean]).toEqual([...makeZip({ 'Uno.pptx': new Uint8Array([1, 2, 3]), 'Dos.pptx': new Uint8Array([4, 5]) })])
    const eocd = eocdOf(clean)
    expect(u16(clean, eocd + 8)).toBe(2)
    expect(u16(clean, eocd + 10)).toBe(2)
    expect(u32(clean, eocd + 16)).toBe(30 + 'Uno.pptx'.length + 3 + 30 + 'Dos.pptx'.length + 2)
    expect(clean.length).toBe(zip.length - (30 + 46 + 2 * 'manifest.json'.length + '{"items":[]}'.length))
  })

  it('funciona con entradas comprimidas y conserva el comentario final', () => {
    const zip = makeZip({ 'Canción.pptx': 'Señor'.repeat(50), 'manifest.json': '{"items":[1]}' }, { deflate: true, comment: 'cloudy-api' })
    const clean = withoutZipEntry(zip, 'manifest.json')!
    expect(text(readZipEntry(clean, 'Canción.pptx'))).toBe('Señor'.repeat(50))
    expect(readZipEntry(clean, 'manifest.json')).toBeNull()
    expect(text(clean.subarray(clean.length - 'cloudy-api'.length))).toBe('cloudy-api')
    expect(u16(clean, eocdOf(clean, 'cloudy-api'.length) + 10)).toBe(1)
  })

  it('un nombre que no está devuelve el mismo archivo; uno roto, null', () => {
    const zip = makeZip({ 'Uno.pptx': 'x' })
    expect(withoutZipEntry(zip, 'manifest.json')).toBe(zip)
    expect(withoutZipEntry(new Uint8Array([1, 2, 3]), 'manifest.json')).toBeNull()
    // Registro local que no está donde dice el directorio central.
    const broken = makeZip({ 'manifest.json': '{}', 'Uno.pptx': 'x' }).slice()
    const central = new DataView(broken.buffer).getUint32(broken.length - 6, true)
    const second = central + 46 + 'manifest.json'.length
    new DataView(broken.buffer).setUint32(second + 42, 7, true)
    expect(withoutZipEntry(broken, 'manifest.json')).toBeNull()
  })
})
