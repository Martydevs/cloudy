import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setResponseStatus } from 'h3'
import { calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

type Behavior = 'ok' | 'network' | 'hang' | 403

/** XHR falso: reporta progreso y termina según `behaviors[url]` (por defecto bien). */
const behaviors = new Map<string, Behavior>()
const sent: string[] = []
const headersByUrl = new Map<string, Record<string, string>>()

// `heic-to` solo corre en el navegador real: se simula para controlar cuándo termina la conversión.
const heic = vi.hoisted(() => ({ heicTo: vi.fn() }))
vi.mock('heic-to', () => ({ heicTo: heic.heicTo }))

class FakeXHR {
  upload: { onprogress: ((e: { lengthComputable: boolean, loaded: number, total: number }) => void) | null } = { onprogress: null }
  status = 0
  url = ''
  headers: Record<string, string> = {}
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  open(_method: string, url: string) {
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send() {
    sent.push(this.url)
    headersByUrl.set(this.url, this.headers)
    const behavior = behaviors.get(this.url) ?? 'ok'
    if (behavior === 'hang') return
    setTimeout(() => {
      if (behavior === 'network') return this.onerror?.()
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
      this.status = behavior === 'ok' ? 200 : behavior
      this.onload?.()
    }, 0)
  }

  abort() {
    this.onabort?.()
  }
}

const file = (name: string, type = 'image/jpeg', size = 1000, bytes: BlobPart = 'x') => {
  const f = new File([bytes], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

let ticket = 0
function mockTicket() {
  mockApi('POST', '/api/uploads', () => {
    ticket++
    return { fileId: `up${ticket}`, uploadUrl: `https://s3.test/up${ticket}`, headers: { 'content-type': 'image/jpeg' } }
  })
}

function mockComplete(id: string, impl: unknown = { id, name: `${id}.jpg` }) {
  mockApi('POST', `/api/uploads/${id}/complete`, impl)
  mockApi('DELETE', `/api/uploads/${id}`, null)
}

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  behaviors.clear()
  sent.length = 0
  headersByUrl.clear()
  heic.heicTo.mockReset()
  ticket = 0
  resetCalls()
  useToast().toasts.value = []
  mockTicket()
  for (let i = 1; i <= 6; i++) mockComplete(`up${i}`)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useUploader', () => {
  it('sube, verifica y avisa al terminar', async () => {
    const onSettled = vi.fn()
    const uploader = useUploader({ folderId: 'd1', onSettled })
    uploader.add([file('foto.jpg')])
    expect(uploader.busy.value).toBe(true)
    await flush(20)

    expect(uploader.items.value[0]).toMatchObject({ status: 'done', progress: 100, error: null })
    expect(uploader.busy.value).toBe(false)
    expect(onSettled).toHaveBeenCalledWith([{ id: 'up1', name: 'up1.jpg' }])
    expect(calls.find(c => c.url === '/api/uploads')?.body).toMatchObject({ folderId: 'd1', name: 'foto.jpg', size: 1000, withThumbnail: false })
    expect(useToast().toasts.value.map(t => t.message)).toEqual(['Se subió «up1.jpg»'])
  })

  it('un error de red se puede reintentar y libera la reserva del servidor', async () => {
    behaviors.set('https://s3.test/up1', 'network')
    const uploader = useUploader({ folderId: null })
    uploader.add([file('foto.jpg')])
    await flush(20)
    expect(uploader.items.value[0]).toMatchObject({ status: 'error', retryable: true, error: 'Se perdió la conexión al subir «foto.jpg». Reintenta.' })
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/uploads/up1')).toBe(true)
    expect(useToast().toasts.value.map(t => t.message)).toContain('Un archivo no se pudo subir')

    uploader.retry(uploader.items.value[0]!.id)
    await flush(20)
    expect(uploader.items.value[0]!.status).toBe('done')
  })

  it('un rechazo del servidor (firma falsa) no se reintenta', async () => {
    mockComplete('up1', failWith(422, undefined, 'El contenido no corresponde al tipo de archivo'))
    const uploader = useUploader({ folderId: null })
    uploader.add([file('falso.jpg')])
    await flush(20)
    expect(uploader.items.value[0]).toMatchObject({ status: 'error', retryable: false, error: 'El contenido no corresponde al tipo de archivo' })
    uploader.retry(uploader.items.value[0]!.id)
    expect(uploader.items.value[0]!.status).toBe('error')
  })

  it('un 5xx con texto en inglés se explica en español y se puede reintentar', async () => {
    mockApi('POST', '/api/uploads', (event) => {
      setResponseStatus(event, 500)
      return { statusCode: 500, statusMessage: 'Server Error', message: 'Server Error' }
    })
    const uploader = useUploader({ folderId: null })
    uploader.add([file('foto.jpg')])
    await flush(20)
    expect(uploader.items.value[0]).toMatchObject({ status: 'error', retryable: true, error: 'Se perdió la conexión al subir «foto.jpg». Reintenta.' })
  })

  it('413/415 del servidor y PUT rechazado por el bucket', async () => {
    mockApi('POST', '/api/uploads', failWith(415, undefined, '«x.jpg»: formato no admitido'))
    const rejected = useUploader({ folderId: null })
    rejected.add([file('x.jpg')])
    await flush(20)
    expect(rejected.items.value[0]).toMatchObject({ status: 'error', retryable: false, error: '«x.jpg»: formato no admitido' })

    mockTicket()
    behaviors.set('https://s3.test/up1', 403)
    const forbidden = useUploader({ folderId: null })
    forbidden.add([file('y.jpg')])
    await flush(20)
    expect(forbidden.items.value[0]).toMatchObject({ status: 'error', retryable: true })
  })

  it('sube la miniatura aparte y, si esa subida falla, el archivo igual queda listo', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1280, height: 640, close: vi.fn() })))
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(new Blob(['thumb'], { type: 'image/webp' }))
    })
    mockApi('POST', '/api/uploads', { fileId: 'up1', uploadUrl: 'https://s3.test/up1', thumbUploadUrl: 'https://s3.test/up1-thumb', headers: { 'content-type': 'image/jpeg' } })
    behaviors.set('https://s3.test/up1-thumb', 'network')
    const uploader = useUploader({ folderId: null })
    uploader.add([file('foto.jpg')])
    await flush(30)
    expect(calls.find(c => c.url === '/api/uploads')?.body).toMatchObject({ withThumbnail: true })
    expect(sent).toEqual(['https://s3.test/up1', 'https://s3.test/up1-thumb'])
    expect(uploader.items.value[0]).toMatchObject({ status: 'done', progress: 100, error: null })
    toBlob.mockRestore()
  })

  it('cancelar mientras se pide la firma libera la reserva y no sube nada', async () => {
    let release!: (ticket: unknown) => void
    const ticket = new Promise((resolve) => {
      release = resolve
    })
    mockApi('POST', '/api/uploads', () => ticket)
    const uploader = useUploader({ folderId: null })
    uploader.add([file('lento.jpg')])
    await flush(5)
    expect(uploader.items.value[0]!.status).toBe('uploading')
    uploader.cancel(uploader.items.value[0]!.id)
    release({ fileId: 'up1', uploadUrl: 'https://s3.test/up1', headers: {} })
    await flush(10)
    expect(sent).toHaveLength(0)
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/uploads/up1')).toBe(true)
    expect(uploader.items.value).toHaveLength(0)
  })

  it('cancelar aborta el PUT, borra la reserva y quita el archivo de la cola', async () => {
    behaviors.set('https://s3.test/up1', 'hang')
    const uploader = useUploader({ folderId: null })
    uploader.add([file('lento.jpg')])
    await flush(10)
    expect(uploader.items.value[0]!.status).toBe('uploading')
    uploader.cancel(uploader.items.value[0]!.id)
    await flush(10)
    expect(uploader.items.value).toHaveLength(0)
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/uploads/up1')).toBe(true)
  })

  it('sube como máximo 3 a la vez y cancelAll detiene el resto', async () => {
    for (let i = 1; i <= 5; i++) behaviors.set(`https://s3.test/up${i}`, 'hang')
    const uploader = useUploader({ folderId: null })
    uploader.add([1, 2, 3, 4, 5].map(i => file(`f${i}.jpg`)))
    await flush(10)
    expect(sent).toHaveLength(3)
    expect(uploader.items.value.filter(i => i.status === 'queued')).toHaveLength(2)
    uploader.cancelAll()
    await flush(10)
    expect(uploader.items.value).toHaveLength(0)
    expect(uploader.busy.value).toBe(false)
  })

  it('valida en el navegador antes de pedir firma', async () => {
    const uploader = useUploader({ folderId: null })
    uploader.add([file('setup.exe', 'application/x-msdownload'), file('culto.mp4', 'video/mp4', 120 * 1024 * 1024)])
    await flush(5)
    expect(uploader.items.value.map(i => i.error)).toEqual(['«setup.exe»: formato no admitido', '«culto.mp4» supera 100 MB'])
    expect(calls).toHaveLength(0)
    expect(useToast().toasts.value.map(t => t.message)).toEqual(['2 archivos no se pudieron subir'])
  })

  it('varios archivos terminan con un solo aviso', async () => {
    const uploader = useUploader({ folderId: null })
    uploader.add([file('a.jpg'), file('b.jpg')])
    await flush(30)
    expect(useToast().toasts.value.map(t => t.message)).toEqual(['Se subieron 2 archivos'])
  })
})

// Una HEIC se convierte a JPEG en el navegador y se sube el JPEG en su lugar (la HEIC no se guarda).
// happy-dom no es un dispositivo Apple: la HEIC lleva su firma real para que se convierta igual (D2a).
const HEIC_HEADER = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])

describe('useUploader · HEIC convertida a JPEG', () => {
  const heicFile = (name = 'IMG_0001.heic') => file(name, 'image/heic', 3_000_000, HEIC_HEADER)
  const jpeg = () => new Blob(['jpeg-convertido'], { type: 'image/jpeg' })

  it('convierte antes de pedir la firma ("Preparando…") y sube el JPEG con su nombre .jpg', async () => {
    let convert!: (blob: Blob) => void
    heic.heicTo.mockImplementation(() => new Promise<Blob>(resolve => (convert = resolve)))
    const uploader = useUploader({ folderId: null })
    uploader.add([heicFile('IMG_0001.HEIC')])
    await flush(20)

    // Mientras convierte no se pide firma ni se sube nada.
    expect(uploader.items.value[0]).toMatchObject({ status: 'uploading', preparing: true, name: 'IMG_0001.HEIC' })
    expect(calls.some(c => c.url === '/api/uploads')).toBe(false)
    expect(sent).toEqual([])

    convert(jpeg())
    await flush(20)
    expect(calls.find(c => c.url === '/api/uploads')?.body).toMatchObject({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', size: 15 })
    expect(calls.find(c => c.url === '/api/uploads')?.body).not.toHaveProperty('withPreview')
    expect(sent).toEqual(['https://s3.test/up1'])
    expect(uploader.items.value[0]).toMatchObject({ status: 'done', preparing: false, name: 'IMG_0001.jpg', size: 15 })
  })

  it('la miniatura sale del JPEG convertido, nunca de la HEIC', async () => {
    const bitmap = vi.fn(async () => ({ width: 4032, height: 3024, close: vi.fn() }))
    vi.stubGlobal('createImageBitmap', bitmap)
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(new Blob(['thumb'], { type: 'image/webp' }))
    })
    mockApi('POST', '/api/uploads', { fileId: 'up1', uploadUrl: 'https://s3.test/up1', thumbUploadUrl: 'https://s3.test/up1-thumb', headers: { 'content-type': 'image/jpeg' } })
    heic.heicTo.mockResolvedValue(jpeg())
    const uploader = useUploader({ folderId: null })
    uploader.add([heicFile()])
    await flush(30)

    expect(bitmap).toHaveBeenCalledTimes(1)
    expect((bitmap.mock.calls[0] as unknown as [File])[0]).toMatchObject({ name: 'IMG_0001.jpg', type: 'image/jpeg' })
    expect(calls.find(c => c.url === '/api/uploads')?.body).toMatchObject({ withThumbnail: true })
    expect(sent).toEqual(['https://s3.test/up1', 'https://s3.test/up1-thumb'])
    toBlob.mockRestore()
  })

  it('si la conversión falla se sube la HEIC original', async () => {
    heic.heicTo.mockRejectedValue(new Error('libheif'))
    const uploader = useUploader({ folderId: null })
    uploader.add([heicFile()])
    await flush(20)
    expect(calls.find(c => c.url === '/api/uploads')?.body).toMatchObject({ name: 'IMG_0001.heic', mimeType: 'image/heic', size: 3_000_000 })
    expect(uploader.items.value[0]).toMatchObject({ status: 'done', preparing: false, name: 'IMG_0001.heic' })
  })

  it('un reintento sube el JPEG ya convertido, sin volver a convertir', async () => {
    heic.heicTo.mockResolvedValue(jpeg())
    behaviors.set('https://s3.test/up1', 'network')
    const uploader = useUploader({ folderId: null })
    uploader.add([heicFile()])
    await flush(20)
    expect(uploader.items.value[0]).toMatchObject({ status: 'error', retryable: true, name: 'IMG_0001.jpg' })

    uploader.retry(uploader.items.value[0]!.id)
    await flush(20)
    expect(heic.heicTo).toHaveBeenCalledTimes(1)
    expect(calls.filter(c => c.url === '/api/uploads').map(c => (c.body as { name: string }).name)).toEqual(['IMG_0001.jpg', 'IMG_0001.jpg'])
    expect(uploader.items.value[0]).toMatchObject({ status: 'done' })
  })

  it('cancelar mientras convierte no pide firma ni sube nada', async () => {
    let convert!: (blob: Blob) => void
    heic.heicTo.mockImplementation(() => new Promise<Blob>(resolve => (convert = resolve)))
    const uploader = useUploader({ folderId: null })
    uploader.add([heicFile()])
    await flush(10)
    uploader.cancel(uploader.items.value[0]!.id)
    convert(jpeg())
    await flush(20)
    expect(uploader.items.value).toEqual([])
    expect(calls.some(c => c.url === '/api/uploads')).toBe(false)
    expect(sent).toEqual([])
  })

  it('un JPEG, una HEIC de más de 5 MB o un archivo .heic que no lo es (fuera de Apple) no se convierten', async () => {
    const uploader = useUploader({ folderId: null })
    uploader.add([file('foto.jpg'), file('grande.heic', 'image/heic', 6_000_000, HEIC_HEADER), file('falsa.heic', 'image/heic', 3_000_000)])
    await flush(20)
    expect(calls.filter(c => c.url === '/api/uploads').map(c => (c.body as { name: string }).name).sort()).toEqual(['falsa.heic', 'foto.jpg', 'grande.heic'])
    expect(heic.heicTo).not.toHaveBeenCalled()
  })
})
