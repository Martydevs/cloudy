import { describe, expect, it } from 'vitest'
import { withSuffix } from '../../server/utils/naming'

describe('withSuffix', () => {
  it('devuelve el nombre si está libre', () => {
    expect(withSuffix('foto.jpg', ['otra.jpg'])).toBe('foto.jpg')
  })
  it('inserta el sufijo antes de la extensión', () => {
    expect(withSuffix('foto.jpg', ['foto.jpg'])).toBe('foto (2).jpg')
  })
  it('sin distinguir mayúsculas', () => {
    expect(withSuffix('Foto.JPG', ['foto.jpg'])).toBe('Foto (2).JPG')
  })
  it('salta los sufijos ya tomados', () => {
    expect(withSuffix('foto.jpg', ['foto.jpg', 'FOTO (2).jpg'])).toBe('foto (3).jpg')
  })
  it('sin extensión (carpetas)', () => {
    expect(withSuffix('Domingo', ['domingo'])).toBe('Domingo (2)')
  })
  it('con varios puntos usa solo la última extensión', () => {
    expect(withSuffix('culto.2026.10.mp3', ['culto.2026.10.mp3'])).toBe('culto.2026.10 (2).mp3')
  })
  it('un nombre que empieza con punto no tiene extensión', () => {
    expect(withSuffix('.notas', ['.notas'])).toBe('.notas (2)')
  })
})
