// Reglas compartidas de la conversión HEIC → JPEG al subir (`shared/constants/heic.ts`).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasHeicBrand, isHeicConvertible, MAX_HEIC_CONVERSION_BYTES } from '../../shared/constants/heic'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/files/${name}`, import.meta.url))).subarray(0, 4096)
const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode(`ftyp${brand}`)])

describe('isHeicConvertible', () => {
  it('solo una HEIC de hasta 5 MB', () => {
    expect(MAX_HEIC_CONVERSION_BYTES).toBe(5_242_880)
    expect(isHeicConvertible({ extension: 'heic', size: 3_000_000 })).toBe(true)
    expect(isHeicConvertible({ extension: 'HEIC', size: MAX_HEIC_CONVERSION_BYTES })).toBe(true)
    expect(isHeicConvertible({ extension: 'heic', size: MAX_HEIC_CONVERSION_BYTES + 1 })).toBe(false)
    expect(isHeicConvertible({ extension: 'heic', size: 0 })).toBe(false)
    expect(isHeicConvertible({ extension: 'jpg', size: 1000 })).toBe(false)
    expect(isHeicConvertible({ extension: 'png', size: 1000 })).toBe(false)
  })
})

describe('hasHeicBrand', () => {
  it('reconoce las HEIC de los fixtures y las marcas HEIF', () => {
    expect(hasHeicBrand(fixture('nota.heic'))).toBe(true)
    expect(hasHeicBrand(fixture('paisaje.heic'))).toBe(true)
    for (const brand of ['heic', 'heix', 'mif1', 'msf1']) expect(hasHeicBrand(ftyp(brand))).toBe(true)
  })

  it('rechaza otros contenedores y bytes cortos', () => {
    expect(hasHeicBrand(fixture('foto.jpg'))).toBe(false)
    expect(hasHeicBrand(ftyp('isom'))).toBe(false)
    expect(hasHeicBrand(ftyp('qt  '))).toBe(false)
    expect(hasHeicBrand(new Uint8Array([0, 0, 0, 24, 0x66, 0x74]))).toBe(false)
  })
})
