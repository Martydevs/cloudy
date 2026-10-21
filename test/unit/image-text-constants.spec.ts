// Elegibilidad de una imagen para leer su texto (feature 002, data-model "Reglas de validación").
import { describe, expect, it } from 'vitest'
import { isImageTextEligible, MAX_IMAGE_TEXT_BYTES } from '#shared/constants/image-text'

describe('isImageTextEligible', () => {
  it.each(['jpg', 'jpeg', 'png', 'heic', 'JPG'])('acepta imágenes .%s de hasta 5 MB', (extension) => {
    expect(isImageTextEligible({ category: 'image', extension, size: 1024 })).toBe(true)
  })

  it('el límite de 5 MB es inclusivo', () => {
    expect(MAX_IMAGE_TEXT_BYTES).toBe(5_242_880)
    expect(isImageTextEligible({ category: 'image', extension: 'jpg', size: 5_242_880 })).toBe(true)
    expect(isImageTextEligible({ category: 'image', extension: 'jpg', size: 5_242_881 })).toBe(false)
  })

  it.each(['webp', 'gif', ''])('rechaza .%s', (extension) => {
    expect(isImageTextEligible({ category: 'image', extension, size: 1024 })).toBe(false)
  })

  it('rechaza lo que no es imagen y los archivos vacíos', () => {
    expect(isImageTextEligible({ category: 'document', extension: 'jpg', size: 1024 })).toBe(false)
    expect(isImageTextEligible({ category: 'image', extension: 'png', size: 0 })).toBe(false)
  })

  it('sin categoría evalúa solo la parte del archivo (el cliente decide si genera la copia HEIC)', () => {
    expect(isImageTextEligible({ extension: 'heic', size: 4_000_000 })).toBe(true)
    expect(isImageTextEligible({ extension: 'heic', size: 6_000_000 })).toBe(false)
  })
})
