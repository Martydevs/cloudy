// Copia JPEG de los HEIC (`server/utils/uploads.ts`): lo único que sobrevive de la feature 002. Se valida al completar
// la subida y su clave se guarda para que la limpieza diaria borre el objeto junto al original.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installNitro, UUID } from './helpers/nitro'

const s3 = vi.hoisted(() => ({
  presignPut: vi.fn(),
  presignGet: vi.fn(),
  head: vi.fn(),
  readRange: vi.fn(),
  deleteMany: vi.fn(async () => {}),
}))

vi.mock('../../server/utils/storage', () => ({
  key: (path: string) => `pre/${path}`,
  listPrefix: vi.fn(),
  ...s3,
}))

const { checkTextSourceCopy, textSourceKeyFor, thumbKeyFor, MAX_THUMB_BYTES } = await import('../../server/utils/uploads')

const JPEG = new Uint8Array(readFileSync(new URL('../fixtures/files/foto.jpg', import.meta.url))).subarray(0, 4096)
const NOT_JPEG = new TextEncoder().encode('esto no es una imagen')
const KEY = `pre/textsrc/${UUID}.jpg`

beforeEach(() => {
  for (const fn of Object.values(s3)) fn.mockReset()
  s3.deleteMany.mockResolvedValue(undefined)
})

describe('claves derivadas', () => {
  it('la miniatura y la copia JPEG salen del id del archivo', () => {
    expect(thumbKeyFor(UUID)).toBe(`pre/thumbs/${UUID}.webp`)
    expect(textSourceKeyFor(UUID)).toBe(KEY)
    expect(MAX_THUMB_BYTES).toBe(1_048_576)
  })
})

describe('checkTextSourceCopy', () => {
  it('copia válida: guarda text_source_key en files y responde true', async () => {
    s3.head.mockResolvedValue({ size: 120_000 })
    s3.readRange.mockResolvedValue(JPEG)
    const fake = installNitro([[]])
    expect(await checkTextSourceCopy({ table: 'files', id: UUID })).toBe(true)
    expect(s3.readRange).toHaveBeenCalledWith(KEY, 0, 4095)
    expect(fake.calls.find(c => c.method === 'set')!.args[0]).toEqual({ textSourceKey: KEY })
    expect(fake.calls.find(c => c.method === 'update')).toBeTruthy()
    expect(s3.deleteMany).not.toHaveBeenCalled()
  })

  it('copia válida de un envío de invitado: escribe en guest_submission_files', async () => {
    s3.head.mockResolvedValue({ size: 120_000 })
    s3.readRange.mockResolvedValue(JPEG)
    const fake = installNitro([[]])
    expect(await checkTextSourceCopy({ table: 'guest_submission_files', id: UUID })).toBe(true)
    expect(fake.calls.find(c => c.method === 'update')).toBeTruthy()
  })

  it('sin copia en el bucket: false, sin borrar ni escribir', async () => {
    s3.head.mockResolvedValue(null)
    const fake = installNitro([[]])
    expect(await checkTextSourceCopy({ table: 'files', id: UUID })).toBe(false)
    expect(s3.deleteMany).not.toHaveBeenCalled()
    expect(fake.calls.find(c => c.method === 'update')).toBeUndefined()
  })

  it.each([
    ['vacía', { size: 0 }, JPEG],
    ['más de 5 MB', { size: 5_242_881 }, JPEG],
    ['sin firma JPEG', { size: 120_000 }, NOT_JPEG],
  ])('copia %s: la borra, no escribe nada y responde false', async (_, object, bytes) => {
    s3.head.mockResolvedValue(object)
    s3.readRange.mockResolvedValue(bytes)
    const fake = installNitro([[]])
    expect(await checkTextSourceCopy({ table: 'files', id: UUID })).toBe(false)
    expect(s3.deleteMany).toHaveBeenCalledWith([KEY])
    expect(fake.calls.find(c => c.method === 'update')).toBeUndefined()
  })

  it('un fallo del bucket se registra sin el texto del error y responde false (nunca lanza)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    s3.head.mockRejectedValue(Object.assign(new Error('credenciales secretas'), { name: 'AccessDenied' }))
    installNitro([[]])
    expect(await checkTextSourceCopy({ table: 'files', id: UUID })).toBe(false)
    expect(error).toHaveBeenCalledWith(`[uploads] files:${UUID} copy check error (AccessDenied)`)
    expect(error.mock.calls.flat().join(' ')).not.toContain('credenciales secretas')
    error.mockRestore()
  })
})
