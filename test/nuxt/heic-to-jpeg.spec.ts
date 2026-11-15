// Conversión HEIC → JPEG en el navegador antes de subir: `heic-to` se simula y se carga solo cuando hace falta; en un
// dispositivo que no es Apple antes se mira la firma del archivo; si no se puede convertir, se sube el original.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { convertHeicToJpeg, jpegName, shouldConvertHeic } from '~/utils/heic-to-jpeg'
import { isAppleDevice } from '~/utils/device'

const heic = vi.hoisted(() => ({ loaded: 0, heicTo: vi.fn() }))
vi.mock('heic-to', () => {
  heic.loaded++
  return { heicTo: heic.heicTo }
})

const MB = 1024 * 1024
/** Cabecera `ftyp` de una HEIC real (marca `heic`). */
const HEIC_HEADER = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])
const file = (name: string, size: number, bytes: BlobPart = 'x') => {
  const f = new File([bytes], name, { type: name.toLowerCase().endsWith('.heic') ? 'image/heic' : 'image/jpeg', lastModified: 1_700_000_000_000 })
  Object.defineProperty(f, 'size', { value: size })
  return f
}
const blob = (size: number) => {
  const b = new Blob(['jpeg'], { type: 'image/jpeg' })
  Object.defineProperty(b, 'size', { value: size })
  return b
}

beforeEach(() => {
  heic.heicTo.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isAppleDevice', () => {
  it('lee el user agent y la plataforma del navegador', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15')
    expect(isAppleDevice()).toBe(true)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36')
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    expect(isAppleDevice()).toBe(false)
  })
})

describe('jpegName', () => {
  it('cambia la extensión .heic (en cualquier caja) por .jpg', () => {
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg')
    expect(jpegName('culto.domingo.heic')).toBe('culto.domingo.jpg')
    expect(jpegName('foto.jpg')).toBe('foto.jpg')
  })
})

describe('shouldConvertHeic', () => {
  it('solo HEIC de hasta 5 MB, sin cargar heic-to', async () => {
    expect(await shouldConvertHeic(file('foto.jpg', MB), true)).toBe(false)
    expect(await shouldConvertHeic(file('grande.heic', 6 * MB), true)).toBe(false)
    expect(await shouldConvertHeic(file('IMG_0001.HEIC', 3 * MB), true)).toBe(true)
    expect(heic.loaded).toBe(0)
  })

  it('en un dispositivo Apple basta la extensión', async () => {
    expect(await shouldConvertHeic(file('nota.heic', 3 * MB, 'no es heic'), true)).toBe(true)
  })

  it('en otro dispositivo se convierte si la firma es de una HEIC (llegó por cable o WhatsApp), si no, no', async () => {
    expect(await shouldConvertHeic(file('nota.heic', 3 * MB, HEIC_HEADER), false)).toBe(true)
    expect(await shouldConvertHeic(file('nota.heic', 3 * MB, 'renombrado'), false)).toBe(false)
  })

  it('sin indicar el dispositivo usa el del navegador', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36')
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux armv81')
    expect(await shouldConvertHeic(file('nota.heic', 3 * MB, 'renombrado'))).toBe(false)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)')
    expect(await shouldConvertHeic(file('nota.heic', 3 * MB, 'renombrado'))).toBe(true)
  })

  it('si no se puede leer el archivo responde false, sin rechazar', async () => {
    const broken = file('nota.heic', 3 * MB)
    vi.spyOn(broken, 'slice').mockImplementation(() => { throw new Error('NotReadableError') })
    await expect(shouldConvertHeic(broken, false)).resolves.toBe(false)
  })
})

describe('convertHeicToJpeg', () => {
  it('extensión que no es heic o archivo de más de 5 MB → null sin cargar heic-to', async () => {
    expect(await convertHeicToJpeg(file('nota.jpg', MB))).toBeNull()
    expect(await convertHeicToJpeg(file('nota.heic', 6 * MB))).toBeNull()
    expect(heic.loaded).toBe(0)
    expect(heic.heicTo).not.toHaveBeenCalled()
  })

  it('convierte con calidad 0.85 a un File JPEG con el nombre en .jpg', async () => {
    heic.heicTo.mockResolvedValue(blob(2 * MB))
    const source = file('IMG_0001.HEIC', 3 * MB)
    const jpeg = await convertHeicToJpeg(source)
    expect(jpeg).toBeInstanceOf(File)
    expect(jpeg).toMatchObject({ name: 'IMG_0001.jpg', type: 'image/jpeg', lastModified: 1_700_000_000_000 })
    expect(heic.heicTo).toHaveBeenCalledWith({ blob: source, type: 'image/jpeg', quality: 0.85 })
    expect(heic.loaded).toBe(1)
  })

  it('si supera 5 MB reintenta una vez con 0.7', async () => {
    heic.heicTo.mockResolvedValueOnce(blob(6 * MB)).mockResolvedValueOnce(blob(4 * MB))
    expect(await convertHeicToJpeg(file('IMG_0001.HEIC', 4 * MB))).toMatchObject({ name: 'IMG_0001.jpg' })
    expect(heic.heicTo).toHaveBeenLastCalledWith(expect.objectContaining({ quality: 0.7 }))
  })

  it('sigue pesando más de 5 MB o falla → null', async () => {
    heic.heicTo.mockResolvedValue(blob(6 * MB))
    expect(await convertHeicToJpeg(file('nota.heic', 4 * MB))).toBeNull()
    expect(heic.heicTo).toHaveBeenCalledTimes(2)
    heic.heicTo.mockRejectedValue(new Error('libheif'))
    expect(await convertHeicToJpeg(file('nota.heic', 4 * MB))).toBeNull()
  })
})
