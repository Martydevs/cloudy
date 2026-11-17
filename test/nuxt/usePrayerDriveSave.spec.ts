// «Guardar en el drive» de las imágenes de peticiones (enmienda «Página de generación»): el navegador lee la imagen
// guardada y la sube con el flujo de subidas de siempre. Cubre el nombre del archivo, el camino feliz (ticket, avance,
// publicación y el aviso único «Ver en Archivos»), la cola de una en una, los fallos de lectura y de subida (sin
// registros a medias), el tope de tamaño, cancelar en cada etapa, reintentar y descartar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { PrayerDriveSave } from '~/composables/usePrayerDriveSave'
import { calls, failFromServer, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { generated } from './prayer-fixtures'

// Tope chico para no mover 100 MB en la prueba.
vi.mock('#shared/constants/files', async importOriginal => ({ ...await importOriginal<object>(), MAX_FILE_SIZE: 10 }))

const { put } = vi.hoisted(() => ({ put: vi.fn() }))
mockNuxtImport('putWithProgress', () => put)

type Drive = ReturnType<typeof usePrayerDriveSave>
type PutArgs = [url: string, body: Blob, headers: Record<string, string>, onProgress: (ratio: number) => void, register: (xhr: { abort: () => void }) => void]

const m = messages.prayers.generation.drive
const NAME = 'peticiones-2026-11-12-100000.png'
const TICKET = { fileId: 'f1', uploadUrl: 'https://s3.test/put', headers: { 'content-type': 'image/png' } }
const never = () => new Promise<never>(() => {})

const entry = (n: number) => ({ image: generated(n), label: m.item(n) })
const idOf = (n: number) => generated(n).id
const png = (bytes = 3) => new Blob([new Uint8Array(bytes)], { type: 'image/png' })
const imageResponse = (blob: Blob = png(), ok = true) => ({ ok, blob: async () => blob })

const realFetch = globalThis.fetch
let download: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => unknown>>
/** Solo la lectura de la imagen se simula; los endpoints de prueba siguen por el `fetch` real. */
function stubDownload(impl: (url: string, init: RequestInit) => unknown = () => imageResponse()) {
  download = vi.fn(async (url: string, init: RequestInit) => impl(url, init))
  vi.stubGlobal('fetch', (input: unknown, init?: unknown) => (String(input).startsWith('/api/peticiones/imagenes/')
    ? download(String(input), init as RequestInit)
    : realFetch(input as RequestInfo, init as RequestInit)))
}

const posts = (url: string) => calls.filter(c => c.method === 'POST' && c.url === url)
const discards = (fileId = 'f1') => calls.filter(c => c.method === 'DELETE' && c.url === `/api/uploads/${fileId}`)
const toasts = () => useToast().toasts.value
const toastsOf = (type: 'success' | 'error' | 'info') => toasts().filter(toast => toast.type === type)
const stages = (drive: Drive) => drive.list.value.map(save => save.stage)

/** Espera a que no quede nada en cola ni en curso. */
async function settled(drive: Drive) {
  await vi.waitFor(() => expect(drive.busy.value).toBe(false), { timeout: 5000 })
  await flush()
}

async function saveAll(...numbers: number[]) {
  const drive = usePrayerDriveSave()
  drive.save(numbers.map(entry))
  await settled(drive)
  return drive
}

beforeEach(() => {
  resetCalls()
  useState('prayer-drive-saves').value = {}
  useState('prayer-drive-saves-finished').value = []
  useToast().toasts.value = []
  put.mockReset()
  put.mockImplementation(async (...args: PutArgs) => args[3](0.5))
  mockApi('POST', '/api/uploads', TICKET)
  mockApi('DELETE', '/api/uploads/f1', null)
  mockApi('POST', '/api/uploads/f1/complete', { id: 'f1', name: NAME })
  stubDownload()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('prayerImageFileName', () => {
  const image = { id: 'abcdef12-0000-4000-8000-000000000001', createdAt: '2026-11-12T10:00:00.000Z' }

  it.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['IMAGE/JPEG', 'jpg'],
  ])('%s → .%s', (mediaType, extension) => {
    expect(prayerImageFileName(image, mediaType)).toBe(`peticiones-2026-11-12-abcdef.${extension}`)
  })

  it('un tipo desconocido o vacío cae en .png', () => {
    expect(prayerImageFileName(image, 'image/gif')).toBe('peticiones-2026-11-12-abcdef.png')
    expect(prayerImageFileName(image, '')).toBe('peticiones-2026-11-12-abcdef.png')
  })

  it('usa la fecha en UTC, no la del huso de quien la creó', () => {
    expect(prayerImageFileName({ ...image, createdAt: '2026-11-12T23:30:00-06:00' }, 'image/png')).toBe('peticiones-2026-11-13-abcdef.png')
  })
})

describe('usePrayerDriveSave · guardar', () => {
  it('lee la imagen, pide el ticket para la raíz, la sube, la publica y avisa una vez con «Ver en Archivos»', async () => {
    const drive = usePrayerDriveSave()
    const seen: number[] = []
    put.mockImplementation(async (...args: PutArgs) => {
      for (const ratio of [0.004, 0.5, 1]) {
        args[3](ratio)
        seen.push(drive.saves.value[idOf(1)]!.progress)
      }
    })
    expect(drive.save([entry(1)])).toBe(1)
    expect(drive.busy.value).toBe(true)
    await settled(drive)

    const [url, init] = download.mock.calls[0]!
    expect(url).toBe(generated(1).previewUrl)
    expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(posts('/api/uploads').map(c => c.body)).toEqual([{ folderId: null, name: NAME, size: 3, mimeType: 'image/png' }])
    const [putUrl, body, headers] = put.mock.calls[0] as PutArgs
    expect([putUrl, headers]).toEqual([TICKET.uploadUrl, TICKET.headers])
    expect(body).toBeInstanceOf(File)
    expect([(body as File).name, body.size, body.type]).toEqual([NAME, 3, 'image/png'])
    // El avance de la subida nunca llega a 100 antes de publicarla.
    expect(seen).toEqual([0, 50, 99])
    expect(posts('/api/uploads/f1/complete')).toHaveLength(1)
    expect(discards()).toHaveLength(0)

    expect(drive.list.value).toEqual([{
      imageId: idOf(1),
      label: 'Imagen 1',
      image: { id: idOf(1), previewUrl: generated(1).previewUrl, createdAt: generated(1).createdAt },
      stage: 'done',
      progress: 100,
      message: NAME,
    }])
    expect(drive.hasSaves.value).toBe(true)
    expect(drive.busy.value).toBe(false)
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toMatchObject({
      type: 'success',
      message: `«${NAME}» quedó en la raíz de Archivos`,
      action: { label: 'Ver en Archivos', to: '/archivos' },
    })
  })

  it('nombra el archivo según el tipo de la imagen; sin tipo, la trata como PNG', async () => {
    mockApi('POST', '/api/uploads/f1/complete', { id: 'f1', name: 'peticiones-2026-11-12-100000.jpg' })
    stubDownload(() => imageResponse(new Blob([new Uint8Array(4)], { type: 'image/jpeg' })))
    const drive = await saveAll(1)
    expect(posts('/api/uploads')[0]!.body).toEqual({ folderId: null, name: 'peticiones-2026-11-12-100000.jpg', size: 4, mimeType: 'image/jpeg' })
    expect(drive.list.value[0]!.message).toBe('peticiones-2026-11-12-100000.jpg')

    stubDownload(() => imageResponse(new Blob([new Uint8Array(2)])))
    await saveAll(2)
    expect(posts('/api/uploads')[1]!.body).toEqual({ folderId: null, name: NAME, size: 2, mimeType: 'image/png' })
  })

  it('sin nada guardado no hay lista ni trabajo pendiente', () => {
    const drive = usePrayerDriveSave()
    expect(drive.list.value).toEqual([])
    expect(drive.hasSaves.value).toBe(false)
    expect(drive.busy.value).toBe(false)
    expect(drive.save([])).toBe(0)
    expect(toasts()).toHaveLength(0)
  })

  it('varias imágenes se guardan de una en una, en orden, y el aviso final las cuenta', async () => {
    let reading = 0
    let maxReading = 0
    stubDownload(async () => {
      reading++
      maxReading = Math.max(maxReading, reading)
      await new Promise(resolve => setTimeout(resolve, 5))
      reading--
      return imageResponse()
    })
    let tickets = 0
    mockApi('POST', '/api/uploads', () => ({ ...TICKET, fileId: `f${++tickets}` }))
    for (const n of [1, 2, 3]) mockApi('POST', `/api/uploads/f${n}/complete`, { id: `f${n}`, name: `guardada-${n}.png` })

    const drive = usePrayerDriveSave()
    expect(drive.save([entry(1), entry(2), entry(3)])).toBe(3)
    // La primera arranca; las demás esperan su turno.
    expect(stages(drive)).toEqual(['downloading', 'queued', 'queued'])
    await settled(drive)

    expect(maxReading).toBe(1)
    expect(download.mock.calls.map(([url]) => url)).toEqual([1, 2, 3].map(n => generated(n).previewUrl))
    expect(drive.list.value.map(save => [save.label, save.stage, save.message])).toEqual([
      ['Imagen 1', 'done', 'guardada-1.png'],
      ['Imagen 2', 'done', 'guardada-2.png'],
      ['Imagen 3', 'done', 'guardada-3.png'],
    ])
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toMatchObject({ type: 'success', message: '3 imágenes en la raíz de Archivos', action: { label: 'Ver en Archivos', to: '/archivos' } })
  })

  it('se salta las que ya están en cola o en curso; una ya guardada se puede guardar otra vez', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    stubDownload(async () => {
      await gate
      return imageResponse()
    })
    const drive = usePrayerDriveSave()
    expect(drive.save([entry(1), entry(2)])).toBe(2)
    expect(drive.save([entry(1), entry(2), entry(3)])).toBe(1)
    expect(drive.list.value.map(save => save.imageId)).toEqual([idOf(1), idOf(2), idOf(3)])
    expect(stages(drive)).toEqual(['downloading', 'queued', 'queued'])
    release()
    await settled(drive)
    expect(download).toHaveBeenCalledTimes(3)

    expect(drive.save([entry(1)])).toBe(1)
    expect(drive.saves.value[idOf(1)]).toMatchObject({ stage: 'downloading', progress: 0, message: null })
    await settled(drive)
    expect(download).toHaveBeenCalledTimes(4)
    expect(stages(drive)).toEqual(['done', 'done', 'done'])
  })
})

describe('usePrayerDriveSave · fallos', () => {
  it.each([
    ['la respuesta llega con error', () => imageResponse(png(), false)],
    ['la red falla', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['el cuerpo no se puede leer', () => ({ ok: true, blob: () => Promise.reject(new Error('reset')) })],
  ])('si %s al leer la imagen, avisa y no sube nada', async (_name, response) => {
    stubDownload(response)
    const drive = await saveAll(1)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: m.downloadFailed })
    expect(m.downloadFailed).toContain('No pudimos leer la imagen guardada.')
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toMatchObject({ type: 'error', message: m.downloadFailed })
    expect(posts('/api/uploads')).toHaveLength(0)
    expect(put).not.toHaveBeenCalled()
  })

  it('una imagen de más del tope del drive se rechaza sin pedir el ticket; en el tope justo se guarda', async () => {
    stubDownload(() => imageResponse(png(11)))
    const drive = await saveAll(1)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: 'La imagen supera el tamaño máximo del drive (100 MB).' })
    expect(toastsOf('error')).toHaveLength(1)
    expect(posts('/api/uploads')).toHaveLength(0)

    stubDownload(() => imageResponse(png(10)))
    await saveAll(2)
    expect(drive.saves.value[idOf(2)]!.stage).toBe('done')
    expect(posts('/api/uploads')[0]!.body).toMatchObject({ size: 10 })
  })

  it('si el ticket falla avisa con el mensaje general y no hay subida que descartar', async () => {
    mockApi('POST', '/api/uploads', failWith(500))
    const drive = await saveAll(1)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: m.failed })
    expect(m.failed).toContain('No pudimos guardar la imagen en el drive.')
    expect(toasts().at(-1)).toMatchObject({ type: 'error', message: m.failed })
    expect(put).not.toHaveBeenCalled()
    expect(discards()).toHaveLength(0)
  })

  it('si el servidor explica por qué rechaza el ticket, se muestra su explicación', async () => {
    mockApi('POST', '/api/uploads', failFromServer(422, 'Unprocessable Entity', 'Ya hay un archivo con ese nombre'))
    const drive = await saveAll(1)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: 'Ya hay un archivo con ese nombre' })
  })

  it.each([401, 403])('si la sesión cambió (%i) lo dice', async (status) => {
    mockApi('POST', '/api/uploads', failWith(status))
    const drive = await saveAll(1)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: messages.common.sessionChanged })
    expect(toasts().at(-1)).toMatchObject({ type: 'error', message: messages.common.sessionChanged })
    expect(put).not.toHaveBeenCalled()
  })

  it('si el PUT falla descarta la subida (sin registros a medias), no la publica y avisa', async () => {
    put.mockRejectedValue(new Error('PUT 500'))
    const drive = await saveAll(1)
    expect(discards()).toHaveLength(1)
    expect(posts('/api/uploads/f1/complete')).toHaveLength(0)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', progress: 0, message: m.failed })
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toMatchObject({ type: 'error', message: m.failed })
  })

  it('si el servidor rechaza la publicación también descarta la subida; que el descarte falle no cambia el aviso', async () => {
    mockApi('POST', '/api/uploads/f1/complete', failWith(422))
    mockApi('DELETE', '/api/uploads/f1', failWith(500))
    const drive = await saveAll(1)
    expect(discards()).toHaveLength(1)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: m.failed })
    expect(toasts()).toHaveLength(1)
  })

  it('un fallo no detiene la cola y el aviso final solo cuenta las guardadas', async () => {
    let reads = 0
    stubDownload(() => imageResponse(png(), ++reads !== 2))
    const drive = await saveAll(1, 2, 3)
    expect(stages(drive)).toEqual(['done', 'error', 'done'])
    expect(toastsOf('error').map(toast => toast.message)).toEqual([m.downloadFailed])
    expect(toastsOf('success').map(toast => toast.message)).toEqual(['2 imágenes en la raíz de Archivos'])
  })

  it('si ninguna se guardó, la cola se vacía sin aviso de éxito', async () => {
    stubDownload(() => imageResponse(png(), false))
    await saveAll(1, 2)
    expect(toastsOf('error')).toHaveLength(2)
    expect(toastsOf('success')).toHaveLength(0)
  })
})

describe('usePrayerDriveSave · cancelar', () => {
  /** Una subida que no avanza ni termina; devuelve el `abort` del XHR que registra. */
  function stallingUploadOnce() {
    const abort = vi.fn()
    put.mockImplementationOnce((...args: PutArgs) => {
      args[4]({ abort })
      return never()
    })
    return abort
  }

  it('en cola: sale de la lista con su aviso, sin tocar la que corre', async () => {
    stubDownload(never)
    const drive = usePrayerDriveSave()
    drive.save([entry(1), entry(2)])
    await flush()
    drive.cancel(idOf(2))
    expect(drive.list.value.map(save => [save.imageId, save.stage])).toEqual([[idOf(1), 'downloading']])
    expect(toasts().map(toast => [toast.type, toast.message])).toEqual([['info', 'Cancelamos el guardado en el drive']])
    expect(download).toHaveBeenCalledTimes(1)

    drive.cancel(idOf(1))
    await settled(drive)
    expect(drive.hasSaves.value).toBe(false)
    expect(toastsOf('info')).toHaveLength(2)
    expect(toastsOf('success')).toHaveLength(0)
  })

  it('mientras lee la imagen: aborta la lectura, no sube nada y la cola sigue con la siguiente', async () => {
    stubDownload(() => (download.mock.calls.length === 1 ? never() : imageResponse()))
    const drive = usePrayerDriveSave()
    drive.save([entry(1), entry(2)])
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    drive.cancel(idOf(1))
    await settled(drive)

    expect(download.mock.calls[0]![1].signal!.aborted).toBe(true)
    expect(drive.list.value.map(save => [save.imageId, save.stage])).toEqual([[idOf(2), 'done']])
    expect(posts('/api/uploads')).toHaveLength(1)
    expect(toastsOf('info').map(toast => toast.message)).toEqual([m.cancelled])
    expect(toastsOf('error')).toHaveLength(0)
    expect(toastsOf('success').map(toast => toast.message)).toEqual([m.saved(NAME)])
  })

  it('mientras llega el cuerpo de la imagen: se cancela sin aviso de error', async () => {
    const blob = vi.fn(never)
    stubDownload(() => ({ ok: true, blob }))
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await vi.waitFor(() => expect(blob).toHaveBeenCalled())
    drive.cancel(idOf(1))
    await settled(drive)
    expect(drive.hasSaves.value).toBe(false)
    expect(toasts().map(toast => toast.type)).toEqual(['info'])
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('justo al llegar la respuesta: lo que venga después ya no se espera', async () => {
    const drive = usePrayerDriveSave()
    stubDownload(() => ({
      ok: true,
      blob: () => {
        drive.cancel(idOf(1))
        return Promise.resolve(png())
      },
    }))
    drive.save([entry(1)])
    await settled(drive)
    expect(drive.hasSaves.value).toBe(false)
    expect(toasts().map(toast => toast.type)).toEqual(['info'])
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('mientras pide el ticket: no hay subida que descartar ni PUT', async () => {
    mockApi('POST', '/api/uploads', never)
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await vi.waitFor(() => expect(posts('/api/uploads')).toHaveLength(1))
    expect(drive.saves.value[idOf(1)]!.stage).toBe('uploading')
    drive.cancel(idOf(1))
    await settled(drive)
    expect(drive.hasSaves.value).toBe(false)
    expect(put).not.toHaveBeenCalled()
    expect(discards()).toHaveLength(0)
    expect(toasts().map(toast => toast.type)).toEqual(['info'])
  })

  it('mientras sube: aborta el envío, descarta la subida, no la publica y la cola sigue', async () => {
    const abort = stallingUploadOnce()
    const drive = usePrayerDriveSave()
    drive.save([entry(1), entry(2)])
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(drive.saves.value[idOf(1)]!.stage).toBe('uploading')
    drive.cancel(idOf(1))
    await settled(drive)
    await vi.waitFor(() => expect(discards()).toHaveLength(1))

    expect(abort).toHaveBeenCalledTimes(1)
    expect(drive.list.value.map(save => [save.imageId, save.stage])).toEqual([[idOf(2), 'done']])
    // Solo se publicó la segunda.
    expect(posts('/api/uploads/f1/complete')).toHaveLength(1)
    expect(toastsOf('info').map(toast => toast.message)).toEqual([m.cancelled])
    expect(toastsOf('error')).toHaveLength(0)
    expect(toastsOf('success')).toHaveLength(1)
  })

  it('un avance que llega tarde, ya cancelada, no devuelve la imagen a la lista', async () => {
    let lateProgress: (ratio: number) => void = () => {}
    put.mockImplementationOnce((...args: PutArgs) => {
      lateProgress = args[3]
      args[4]({ abort: vi.fn() })
      return never()
    })
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    drive.cancel(idOf(1))
    await settled(drive)
    lateProgress(0.7)
    expect(drive.list.value).toEqual([])
    expect(drive.hasSaves.value).toBe(false)
  })

  it('con el archivo ya subido no hace nada: la publicación termina', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockApi('POST', '/api/uploads/f1/complete', async () => {
      await gate
      return { id: 'f1', name: NAME }
    })
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await vi.waitFor(() => expect(posts('/api/uploads/f1/complete')).toHaveLength(1))
    drive.cancel(idOf(1))
    await flush()
    expect(drive.saves.value[idOf(1)]!.stage).toBe('uploading')
    expect(toasts()).toHaveLength(0)
    release()
    await settled(drive)
    expect(drive.saves.value[idOf(1)]).toMatchObject({ stage: 'done', message: NAME })
    expect(discards()).toHaveLength(0)
    expect(toasts().map(toast => toast.type)).toEqual(['success'])
  })

  it('cancelar algo que no existe, ya terminó o falló no hace nada', async () => {
    let reads = 0
    stubDownload(() => imageResponse(png(), ++reads === 1))
    const drive = await saveAll(1, 2)
    const before = toasts().length
    drive.cancel('no-existe')
    drive.cancel(idOf(1))
    drive.cancel(idOf(2))
    await flush()
    expect(stages(drive)).toEqual(['done', 'error'])
    expect(toasts()).toHaveLength(before)
    expect(toastsOf('info')).toHaveLength(0)
  })
})

describe('usePrayerDriveSave · reintentar y descartar', () => {
  it('retry solo repite una fallida', async () => {
    stubDownload(() => imageResponse(png(), false))
    const drive = await saveAll(1)
    expect(drive.saves.value[idOf(1)]!.stage).toBe('error')

    stubDownload()
    drive.retry('no-existe')
    expect(download).not.toHaveBeenCalled()
    drive.retry(idOf(1))
    // Vuelve a la cola limpia y arranca enseguida.
    expect(drive.saves.value[idOf(1)]).toMatchObject({ stage: 'downloading', progress: 0, message: null })
    expect(drive.busy.value).toBe(true)
    await settled(drive)
    expect(drive.saves.value[idOf(1)]).toMatchObject({ stage: 'done', message: NAME })
    expect(download).toHaveBeenCalledTimes(1)

    // Reintentar algo que no falló no hace nada.
    drive.retry(idOf(1))
    await flush()
    expect(download).toHaveBeenCalledTimes(1)
    expect(drive.saves.value[idOf(1)]!.stage).toBe('done')
  })

  it('dismiss quita una guardada o una fallida, pero no una en cola ni en curso', async () => {
    let reads = 0
    stubDownload(() => imageResponse(png(), ++reads === 1))
    const drive = await saveAll(1, 2)
    expect(stages(drive)).toEqual(['done', 'error'])

    stubDownload(never)
    drive.save([entry(3), entry(4)])
    await flush()
    drive.dismiss(idOf(3))
    drive.dismiss(idOf(4))
    drive.dismiss('no-existe')
    expect(stages(drive)).toEqual(['done', 'error', 'downloading', 'queued'])

    drive.dismiss(idOf(1))
    drive.dismiss(idOf(2))
    expect(drive.list.value.map(save => save.imageId)).toEqual([idOf(3), idOf(4)])

    // Limpieza: nada queda corriendo para la siguiente prueba.
    drive.cancel(idOf(4))
    drive.cancel(idOf(3))
    await settled(drive)
    expect(drive.hasSaves.value).toBe(false)
  })

  it('sin estado previo arranca con la cola vacía y guarda igual', async () => {
    clearNuxtState(['prayer-drive-saves', 'prayer-drive-saves-finished'])
    const drive = usePrayerDriveSave()
    expect(drive.saves.value).toEqual({})
    expect(drive.list.value).toEqual([])
    drive.save([entry(1)])
    await settled(drive)
    expect(stages(drive)).toEqual(['done'])
    expect(toastsOf('success')).toHaveLength(1)
  })

  it('el estado es compartido: otra instancia ve la misma cola', async () => {
    const drive = await saveAll(1)
    const other = usePrayerDriveSave()
    expect(other.list.value).toEqual(drive.list.value)
    const state = useState<Record<string, PrayerDriveSave>>('prayer-drive-saves')
    expect(Object.keys(state.value)).toEqual([idOf(1)])
  })
})
