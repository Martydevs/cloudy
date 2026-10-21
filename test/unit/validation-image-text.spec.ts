// Feature 002 — cuerpos de `POST` y `PATCH /api/files/:id/text`, compartidos por el panel y los endpoints.
import { describe, expect, it } from 'vitest'
import { imageTextEditInput, imageTextReadInput } from '../../shared/validation/image-text'

describe('imageTextEditInput', () => {
  it('acepta de 1 a 10 000 caracteres tras recortar', () => {
    expect(imageTextEditInput({ text: '  Oremos\npor Ana  ' })).toEqual({ ok: true, data: { text: 'Oremos\npor Ana' } })
    expect(imageTextEditInput({ text: 'a'.repeat(10_000) })).toEqual({ ok: true, data: { text: 'a'.repeat(10_000) } })
    expect(imageTextEditInput({ text: ` ${'a'.repeat(10_000)} ` }).ok).toBe(true)
  })

  it('rechaza vacío, solo espacios, 10 001 caracteres y lo que no es texto', () => {
    expect(imageTextEditInput({ text: '' })).toEqual({ ok: false, errors: { text: 'Este campo es obligatorio' } })
    expect(imageTextEditInput({ text: '  \n ' }).ok).toBe(false)
    expect(imageTextEditInput({ text: 'a'.repeat(10_001) })).toEqual({ ok: false, errors: { text: 'Debe tener como máximo 10000 caracteres' } })
    expect(imageTextEditInput({ text: 42 }).ok).toBe(false)
    expect(imageTextEditInput({}).ok).toBe(false)
  })
})

describe('imageTextReadInput', () => {
  it('force es un booleano opcional', () => {
    expect(imageTextReadInput({})).toEqual({ ok: true, data: { force: undefined } })
    expect(imageTextReadInput({ force: true })).toEqual({ ok: true, data: { force: true } })
    expect(imageTextReadInput({ force: 'sí' }).ok).toBe(false)
  })
})
