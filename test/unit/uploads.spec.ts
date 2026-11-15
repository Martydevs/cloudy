// Claves derivadas de las subidas (`server/utils/uploads.ts`). Las HEIC se convierten a JPEG en el navegador, así que
// ya no hay copia de vista previa que firmar ni validar: solo queda la miniatura.
import { describe, expect, it, vi } from 'vitest'
import { UUID } from './helpers/nitro'

vi.mock('../../server/utils/storage', () => ({
  key: (path: string) => `pre/${path}`,
  deleteMany: vi.fn(async () => {}),
}))

const uploads = await import('../../server/utils/uploads')

describe('claves derivadas', () => {
  it('la miniatura sale del id del archivo', () => {
    expect(uploads.thumbKeyFor(UUID)).toBe(`pre/thumbs/${UUID}.webp`)
    expect(uploads.MAX_THUMB_BYTES).toBe(1_048_576)
  })

  it('ya no exporta nada de la copia de vista previa', () => {
    expect(Object.keys(uploads).sort()).toEqual(['MAX_THUMB_BYTES', 'discardUpload', 'getOwnUpload', 'thumbKeyFor'])
  })
})
