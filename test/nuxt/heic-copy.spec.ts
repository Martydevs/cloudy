// Copia JPEG de una HEIC en el navegador (feature 002, research A4): `heic-to` se simula y se carga
// solo cuando hace falta; la subida de la copia nunca rechaza.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { makeTextSourceCopy, uploadTextSourceCopy } from '~/utils/heic-copy'

const heic = vi.hoisted(() => ({ loaded: 0, heicTo: vi.fn() }))
vi.mock('heic-to', () => {
  heic.loaded++
  return { heicTo: heic.heicTo }
})

const put = vi.hoisted(() => vi.fn(async () => {}))
mockNuxtImport('putWithProgress', () => put)

const MB = 1024 * 1024
const file = (name: string, size: number) => {
  const f = new File(['x'], name, { type: name.endsWith('.heic') ? 'image/heic' : 'image/jpeg' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}
const blob = (size: number) => {
  const b = new Blob(['x'], { type: 'image/jpeg' })
  Object.defineProperty(b, 'size', { value: size })
  return b
}

beforeEach(() => {
  heic.heicTo.mockReset()
  put.mockReset()
  put.mockResolvedValue(undefined)
})

describe('makeTextSourceCopy', () => {
  it('extensión que no es heic o archivo de más de 5 MB → null sin cargar heic-to', async () => {
    expect(await makeTextSourceCopy(file('nota.jpg', MB))).toBeNull()
    expect(await makeTextSourceCopy(file('nota.heic', 6 * MB))).toBeNull()
    expect(heic.loaded).toBe(0)
    expect(heic.heicTo).not.toHaveBeenCalled()
  })

  it('convierte con calidad 0.85', async () => {
    const copy = blob(2 * MB)
    heic.heicTo.mockResolvedValue(copy)
    const source = file('nota.heic', 3 * MB)
    expect(await makeTextSourceCopy(source)).toBe(copy)
    expect(heic.heicTo).toHaveBeenCalledWith({ blob: source, type: 'image/jpeg', quality: 0.85 })
    expect(heic.loaded).toBe(1)
  })

  it('si supera 5 MB reintenta una vez con 0.7', async () => {
    const small = blob(4 * MB)
    heic.heicTo.mockResolvedValueOnce(blob(6 * MB)).mockResolvedValueOnce(small)
    expect(await makeTextSourceCopy(file('IMG_0001.HEIC', 4 * MB))).toBe(small)
    expect(heic.heicTo).toHaveBeenLastCalledWith(expect.objectContaining({ quality: 0.7 }))
  })

  it('sigue pesando más de 5 MB o falla → null', async () => {
    heic.heicTo.mockResolvedValue(blob(6 * MB))
    expect(await makeTextSourceCopy(file('nota.heic', 4 * MB))).toBeNull()
    expect(heic.heicTo).toHaveBeenCalledTimes(2)
    heic.heicTo.mockRejectedValue(new Error('libheif'))
    expect(await makeTextSourceCopy(file('nota.heic', 4 * MB))).toBeNull()
  })
})

describe('uploadTextSourceCopy', () => {
  it('sube la copia con content-type image/jpeg', async () => {
    const copy = blob(MB)
    heic.heicTo.mockResolvedValue(copy)
    await uploadTextSourceCopy(file('nota.heic', 2 * MB), 'https://s3.test/put/textsrc/x.jpg')
    expect(put).toHaveBeenCalledWith('https://s3.test/put/textsrc/x.jpg', copy, { 'content-type': 'image/jpeg' }, expect.any(Function))
  })

  it('sin URL o sin copia no hay PUT', async () => {
    await uploadTextSourceCopy(file('nota.heic', 2 * MB), undefined)
    heic.heicTo.mockRejectedValue(new Error('x'))
    await uploadTextSourceCopy(file('nota.heic', 2 * MB), 'https://s3.test/put')
    expect(put).not.toHaveBeenCalled()
  })

  it('un PUT fallido resuelve igual', async () => {
    heic.heicTo.mockResolvedValue(blob(MB))
    put.mockRejectedValue(new Error('PUT 403'))
    await expect(uploadTextSourceCopy(file('nota.heic', 2 * MB), 'https://s3.test/put')).resolves.toBeUndefined()
  })
})
