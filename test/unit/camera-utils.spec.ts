// Feature 003 (US2) — utilidades puras de la cámara: nombre de la foto, errores de getUserMedia y JPEG ≤ 5 MB.
import { describe, expect, it, vi } from 'vitest'
import { cameraErrorKey, encodeJpeg, photoFileName } from '../../app/utils/camera'

/** Canvas simulado: devuelve un blob del tamaño indicado por cada calidad pedida. */
function fakeCanvas(sizes: Record<string, number | null>) {
  const toBlob = vi.fn((callback: (blob: Blob | null) => void, _type?: string, quality?: number) => {
    const size = sizes[String(quality)]
    callback(size === null || size === undefined ? null : { size, type: 'image/jpeg' } as Blob)
  })
  return { canvas: { toBlob } as unknown as HTMLCanvasElement, toBlob }
}

const domError = (name: string) => Object.assign(new Error(name), { name })

describe('photoFileName', () => {
  it('usa la fecha y hora locales: foto-AAAAMMDD-HHMMSS.jpg', () => {
    expect(photoFileName(new Date('2026-10-29T14:05:09'))).toBe('foto-20261029-140509.jpg')
    expect(photoFileName(new Date('2026-01-02T03:04:05'))).toBe('foto-20260102-030405.jpg')
  })
})

describe('cameraErrorKey', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'notFound'],
    ['OverconstrainedError', 'notFound'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['TypeError', 'failed'],
  ])('%s → %s', (name, key) => {
    expect(cameraErrorKey(domError(name))).toBe(key)
  })

  it('cualquier otra cosa es un fallo genérico', () => {
    expect(cameraErrorKey('texto')).toBe('failed')
    expect(cameraErrorKey(null)).toBe('failed')
    expect(cameraErrorKey({ name: 42 })).toBe('failed')
  })
})

describe('encodeJpeg', () => {
  it('codifica a JPEG con calidad 0.85', async () => {
    const { canvas, toBlob } = fakeCanvas({ 0.85: 1_000_000 })
    const blob = await encodeJpeg(canvas)
    expect(blob.size).toBe(1_000_000)
    expect(toBlob).toHaveBeenCalledTimes(1)
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85)
  })

  it('si pasa de 5 MB reintenta una vez con 0.7', async () => {
    const { canvas, toBlob } = fakeCanvas({ 0.85: 5_242_881, 0.7: 3_000_000 })
    expect((await encodeJpeg(canvas)).size).toBe(3_000_000)
    expect(toBlob.mock.calls.map(c => c[2])).toEqual([0.85, 0.7])
  })

  it('exactamente 5 MB no reintenta', async () => {
    const { canvas, toBlob } = fakeCanvas({ 0.85: 5_242_880 })
    expect((await encodeJpeg(canvas)).size).toBe(5_242_880)
    expect(toBlob).toHaveBeenCalledTimes(1)
  })

  it('si el navegador no produce la imagen, rechaza', async () => {
    const { canvas } = fakeCanvas({ 0.85: null })
    await expect(encodeJpeg(canvas)).rejects.toThrow()
  })
})
