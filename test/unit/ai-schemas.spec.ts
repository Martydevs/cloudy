// Esquemas Zod del flujo de IA (feature 002, research A3).
import { describe, expect, it } from 'vitest'
import { imageSourceSchema, imageTextOutputSchema, modelImageSchema } from '../../server/ai/image-text/schemas'
import { UUID } from './helpers/nitro'

describe('imageSourceSchema', () => {
  const valid = { fileId: UUID, extension: 'jpg', sizeBytes: 1024 }

  it('acepta una imagen apta', () => {
    for (const extension of ['jpg', 'jpeg', 'png', 'heic']) {
      expect(imageSourceSchema.safeParse({ ...valid, extension }).success).toBe(true)
    }
    expect(imageSourceSchema.safeParse({ ...valid, sizeBytes: 5_242_880 }).success).toBe(true)
  })

  it('rechaza id no válido, formato no apto, vacío y más de 5 MB', () => {
    expect(imageSourceSchema.safeParse({ ...valid, fileId: 'x' }).success).toBe(false)
    expect(imageSourceSchema.safeParse({ ...valid, extension: 'webp' }).success).toBe(false)
    expect(imageSourceSchema.safeParse({ ...valid, sizeBytes: 0 }).success).toBe(false)
    expect(imageSourceSchema.safeParse({ ...valid, sizeBytes: 5_242_881 }).success).toBe(false)
    expect(imageSourceSchema.safeParse({ ...valid, sizeBytes: 1.5 }).success).toBe(false)
  })
})

describe('modelImageSchema', () => {
  it('acepta bytes JPEG o PNG de hasta 5 MB', () => {
    expect(modelImageSchema.safeParse({ mediaType: 'image/jpeg', data: new Uint8Array([1]) }).success).toBe(true)
    expect(modelImageSchema.safeParse({ mediaType: 'image/png', data: new Uint8Array(5_242_880) }).success).toBe(true)
  })

  it('rechaza otro formato, datos vacíos, más de 5 MB y lo que no son bytes', () => {
    expect(modelImageSchema.safeParse({ mediaType: 'image/webp', data: new Uint8Array([1]) }).success).toBe(false)
    expect(modelImageSchema.safeParse({ mediaType: 'image/jpeg', data: new Uint8Array() }).success).toBe(false)
    expect(modelImageSchema.safeParse({ mediaType: 'image/jpeg', data: new Uint8Array(5_242_881) }).success).toBe(false)
    expect(modelImageSchema.safeParse({ mediaType: 'image/jpeg', data: 'base64' }).success).toBe(false)
  })
})

describe('imageTextOutputSchema', () => {
  it('con texto: lo recorta y exige contenido', () => {
    expect(imageTextOutputSchema.parse({ hasText: true, text: '  Hola\nmundo  ' })).toEqual({ hasText: true, text: 'Hola\nmundo' })
    expect(imageTextOutputSchema.safeParse({ hasText: true, text: '   ' }).success).toBe(false)
  })

  it('sin texto: exige la cadena vacía', () => {
    expect(imageTextOutputSchema.parse({ hasText: false, text: '' })).toEqual({ hasText: false, text: '' })
    expect(imageTextOutputSchema.safeParse({ hasText: false, text: 'algo' }).success).toBe(false)
  })

  it('rechaza más de 10 000 caracteres y la forma incorrecta', () => {
    expect(imageTextOutputSchema.safeParse({ hasText: true, text: 'a'.repeat(10_001) }).success).toBe(false)
    expect(imageTextOutputSchema.safeParse({ hasText: true, text: 'a'.repeat(10_000) }).success).toBe(true)
    expect(imageTextOutputSchema.safeParse({ text: 'hola' }).success).toBe(false)
  })
})
