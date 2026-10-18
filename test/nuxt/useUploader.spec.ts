import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setResponseStatus } from 'h3'
import { calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

type Behavior = 'ok' | 'network' | 'hang' | 403

/** XHR falso: reporta progreso y termina según `behaviors[url]` (por defecto bien). */
const behaviors = new Map<string, Behavior>()
const sent: string[] = []

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

const file = (name: string, type = 'image/jpeg', size = 1000) => {
  const f = new File(['x'], name, { type })
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
