// Lectura del tamaño de un JPEG y elección de la relación de aspecto que se pide al modelo de imágenes de Peticiones.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IMAGE_ASPECT_RATIOS, jpegSize, nearestAspectRatio } from '../../shared/jpeg'

/** `FF Cn 00 0B 08 <alto> <ancho> …`: una trama SOF con su tamaño. */
const frame = (marker: number, width: number, height: number) => [0xFF, marker, 0x00, 0x0B, 0x08, height >> 8, height & 0xFF, width >> 8, width & 0xFF, 0x01, 0x01, 0x11, 0x00]
/** Un segmento cualquiera (APP0, DQT…) con `size` bytes de datos. */
const segment = (marker: number, size: number) => [0xFF, marker, (size + 2) >> 8, (size + 2) & 0xFF, ...Array.from({ length: size }, () => 0)]
const jpeg = (...parts: number[][]) => new Uint8Array([0xFF, 0xD8, ...parts.flat()])

describe('jpegSize', () => {
  it('lee ancho y alto de la trama SOF0, saltando los segmentos anteriores', () => {
    expect(jpegSize(jpeg(segment(0xE0, 14), segment(0xDB, 65), frame(0xC0, 1376, 768)))).toEqual({ width: 1376, height: 768 })
  })

  it('acepta un JPEG progresivo (SOF2) y relleno FF entre segmentos', () => {
    expect(jpegSize(jpeg(segment(0xE1, 4), [0xFF], frame(0xC2, 768, 1344)))).toEqual({ width: 768, height: 1344 })
  })

  it('no confunde las tablas Huffman (C4) con una trama', () => {
    expect(jpegSize(jpeg(segment(0xC4, 20), frame(0xC0, 100, 50)))).toEqual({ width: 100, height: 50 })
  })

  it('la plantilla real de Peticiones y una foto de las pruebas se leen', () => {
    const template = jpegSize(new Uint8Array(readFileSync(new URL('../../server/assets/peticiones/plantilla.jpg', import.meta.url))))
    expect(template).not.toBeNull()
    expect(nearestAspectRatio(template!)).toBe('16:9')
    expect(jpegSize(new Uint8Array(readFileSync(new URL('../fixtures/files/foto.jpg', import.meta.url))))).toMatchObject({ width: expect.any(Number) })
  })

  it.each([
    ['vacío', new Uint8Array()],
    ['un PNG', new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
    ['solo el inicio', new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])],
    ['sin trama antes de los datos (SOS)', jpeg(segment(0xE0, 4), segment(0xDA, 4), frame(0xC0, 10, 10))],
    ['fin de imagen sin trama', jpeg([0xFF, 0xD9, 0x00, 0x00])],
    ['basura donde va un marcador', jpeg([0x00, 0x01, 0x02, 0x03])],
    ['longitud de segmento imposible', jpeg([0xFF, 0xE0, 0x00, 0x01, 0x00])],
    ['trama cortada', jpeg([0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x03])],
    ['tamaño cero', jpeg(frame(0xC0, 0, 768))],
  ])('%s → null', (_, bytes) => {
    expect(jpegSize(bytes)).toBeNull()
  })

  it('salta los marcadores sin longitud (RSTn)', () => {
    expect(jpegSize(jpeg([0xFF, 0xD0], frame(0xC0, 20, 10)))).toEqual({ width: 20, height: 10 })
  })
})

describe('nearestAspectRatio', () => {
  it.each([
    [1376, 768, '16:9'],
    [1920, 1080, '16:9'],
    [1024, 1024, '1:1'],
    [768, 1344, '9:16'],
    [1200, 800, '3:2'],
    [1000, 1250, '4:5'],
    [2560, 1080, '21:9'],
    [5000, 1000, '21:9'],
    [1100, 1000, '1:1'],
  ] as const)('%i × %i → %s', (width, height, ratio) => {
    expect(nearestAspectRatio({ width, height })).toBe(ratio)
  })

  it('siempre devuelve una de las relaciones admitidas', () => {
    for (const [width, height] of [[1, 9], [9, 1], [333, 777]] as const) {
      expect(IMAGE_ASPECT_RATIOS).toContain(nearestAspectRatio({ width, height }))
    }
  })
})
