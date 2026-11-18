// Guardar imágenes de peticiones en el drive (enmienda «Página de generación», 2026-11-15; forma de `useYoutubeDriveImport`):
// el navegador lee la imagen guardada y la sube con el flujo normal de subidas a la raíz de Archivos, de una en una. Cubre
// el nombre del archivo, el éxito (uno y varios, con un solo aviso al vaciarse la cola), una imagen ya en cola, los fallos
// de lectura, tamaño y subida (sin reservas a medias), Reintentar, la cancelación en cada etapa y Descartar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { PrayerGeneratedImage } from '#shared/types/api'
import { prayerImageFileName } from '~/composables/usePrayerDriveSave'
import { calls, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { generated } from './prayer-fixtures'

// Tope chico para probar «demasiado pesada» sin crear 100 MB.
vi.mock('#shared/constants/files', async importOriginal => ({ ...await importOriginal<object>(), MAX_FILE_SIZE: 10 }))

const { put } = vi.hoisted(() => ({ put: vi.fn() }))
mockNuxtImport('putWithProgress', () => put)

const image = (n: number): Pick<PrayerGeneratedImage, 'id' | 'previewUrl' | 'createdAt'> => generated(n)
const entry = (n: number) => ({ image: image(n), label: `Imagen ${n}` })

/** Respuesta de `fetch` de la imagen guardada (302 ya seguida por el navegador). */
function imageResponse({ ok = true, bytes = [1, 2, 3], type = 'image/png', breaks = false } = {}) {
  return {
    ok,
    blob: async () => {
      if (breaks) throw new Error('reset')
      return new Blob([new Uint8Array(bytes)], { type })
    },
  }
}

const realFetch = globalThis.fetch
let read: ReturnType<typeof vi.fn>
function stubRead(response: unknown | ((url: string) => unknown)) {
  read = vi.fn(async (url: string) => (typeof response === 'function' ? response(url) : response))
  // Solo la lectura de la imagen se simula; el resto (los endpoints de prueba) sigue por el `fetch` real.
  vi.stubGlobal('fetch', (input: unknown, init?: unknown) => (String(input).includes('/api/peticiones/imagenes/')
    ? (read as (url: unknown, init?: unknown) => unknown)(input, init)
    : realFetch(input as RequestInfo, init as RequestInit)))
}

const posts = (url: string) => calls.filter(c => c.method === 'POST' && c.url === url)
const deletes = (url: string) => calls.filter(c => c.method === 'DELETE' && c.url === url)
const toasts = () => useToast().toasts.value

function happyPath() {
  mockApi('POST', '/api/uploads', { fileId: 'f1', uploadUrl: 'https://s3.test/put', headers: { 'content-type': 'image/png' } })
  mockApi('DELETE', '/api/uploads/f1', null)
  mockApi('POST', '/api/uploads/f1/complete', { id: 'f1', name: 'peticiones-2026-11-12-100000.png' })
  stubRead(imageResponse())
}

beforeEach(() => {
  resetCalls()
  useState('prayer-drive-saves').value = {}
  useState('prayer-drive-saves-finished').value = []
  useToast().toasts.value = []
  put.mockReset()
  put.mockImplementation(async (_url: string, _body: Blob, _headers: unknown, onProgress: (ratio: number) => void) => onProgress(0.5))
  happyPath()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prayerImageFileName', () => {
  it('fecha UTC y 6 caracteres del id; la extensión sigue al tipo y un tipo raro cae en .png', () => {
    const late = { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', createdAt: '2026-11-12T23:30:00.000-06:00' }
    expect(prayerImageFileName(late, 'image/jpeg')).toBe('peticiones-2026-11-13-3f2504.jpg')
    expect(prayerImageFileName(late, 'IMAGE/WEBP')).toBe('peticiones-2026-11-13-3f2504.webp')
    expect(prayerImageFileName(late, 'image/x')).toBe('peticiones-2026-11-13-3f2504.png')
  })
})

describe('usePrayerDriveSave', () => {
  it('lee la imagen sin caché, pide el ticket a la raíz con su nombre, sube y publica; termina con el nombre y un aviso hacia Archivos', async () => {
    const drive = usePrayerDriveSave()
    expect(drive.save([entry(1)])).toBe(1)
    expect(drive.busy.value).toBe(true)
    await flush(10)
    expect(read).toHaveBeenCalledWith(image(1).previewUrl, expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }))
    expect(posts('/api/uploads')[0]!.body).toEqual({ folderId: null, name: 'peticiones-2026-11-12-100000.png', size: 3, mimeType: 'image/png' })
    const [url, body, headers] = put.mock.calls[0]!
    expect(url).toBe('https://s3.test/put')
    expect((body as File).name).toBe('peticiones-2026-11-12-100000.png')
    expect(headers).toEqual({ 'content-type': 'image/png' })
    expect(posts('/api/uploads/f1/complete')).toHaveLength(1)
    expect(drive.list.value).toEqual([expect.objectContaining({ imageId: image(1).id, label: 'Imagen 1', stage: 'done', progress: 100, message: 'peticiones-2026-11-12-100000.png' })])
    expect(drive.busy.value).toBe(false)
    expect(toasts().map(t => t.message)).toContain('«peticiones-2026-11-12-100000.png» quedó en la raíz de Archivos')
    expect(toasts().at(-1)?.action).toEqual({ label: 'Ver en Archivos', to: '/archivos' })
    expect(deletes('/api/uploads/f1')).toHaveLength(0)
  })

  it('varias van de una en una (la segunda espera en cola) y al vaciarse la cola hay un solo aviso con la cuenta', async () => {
    let release: (() => void) | undefined
    stubRead(() => new Promise(resolve => (release = () => resolve(imageResponse()))))
    const drive = usePrayerDriveSave()
    expect(drive.save([entry(1), entry(2)])).toBe(2)
    await flush()
    expect(drive.list.value.map(save => save.stage)).toEqual(['downloading', 'queued'])
    release?.()
    await flush(10)
    expect(drive.list.value.map(save => save.stage)).toEqual(['done', 'downloading'])
    release?.()
    await flush(10)
    expect(drive.list.value.map(save => save.stage)).toEqual(['done', 'done'])
    const saved = toasts().filter(t => t.message.includes('Archivos'))
    expect(saved.map(t => t.message)).toEqual(['2 imágenes en la raíz de Archivos'])
  })

  it('una imagen ya en cola o en curso no se encola dos veces; una terminada sí se puede volver a guardar', async () => {
    stubRead(() => new Promise(() => {}))
    const drive = usePrayerDriveSave()
    expect(drive.save([entry(1)])).toBe(1)
    await flush()
    expect(drive.save([entry(1), entry(2)])).toBe(1)
    expect(drive.list.value.map(save => save.stage)).toEqual(['downloading', 'queued'])
  })

  it('si la imagen no se puede leer, queda en error con su motivo y Reintentar la vuelve a encolar', async () => {
    stubRead(imageResponse({ ok: false }))
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await flush(10)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: expect.stringContaining('No pudimos leer la imagen guardada') })
    expect(toasts().map(t => t.message)).toEqual([expect.stringContaining('No pudimos leer la imagen guardada')])
    expect(posts('/api/uploads')).toHaveLength(0)
    stubRead(imageResponse())
    drive.retry(image(1).id)
    await flush(10)
    expect(drive.list.value[0]!.stage).toBe('done')
  })

  it('una lectura que se corta o sin respuesta también es un fallo de lectura', async () => {
    stubRead(imageResponse({ breaks: true }))
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await flush(10)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: expect.stringContaining('No pudimos leer la imagen guardada') })
    stubRead(() => { throw new TypeError('Failed to fetch') })
    drive.retry(image(1).id)
    await flush(10)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: expect.stringContaining('No pudimos leer la imagen guardada') })
  })

  it('por encima del tope del drive no se pide el ticket', async () => {
    stubRead(imageResponse({ bytes: Array.from({ length: 11 }, () => 1) }))
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await flush(10)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: 'La imagen supera el tamaño máximo del drive (100 MB).' })
    expect(posts('/api/uploads')).toHaveLength(0)
  })

  it('si la subida al bucket falla, se descarta la reserva y queda en error reintentable', async () => {
    put.mockRejectedValue(new Error('network'))
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await flush(10)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: expect.stringContaining('No pudimos guardar la imagen en el drive') })
    expect(deletes('/api/uploads/f1')).toHaveLength(1)
    expect(posts('/api/uploads/f1/complete')).toHaveLength(0)
  })

  it('si no hay ticket (500), queda en error sin subir nada; una sesión cerrada (401) lo dice', async () => {
    mockApi('POST', '/api/uploads', failWith(500))
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await flush(10)
    expect(drive.list.value[0]).toMatchObject({ stage: 'error', message: expect.stringContaining('No pudimos guardar la imagen en el drive') })
    expect(put).not.toHaveBeenCalled()
    mockApi('POST', '/api/uploads', failWith(401))
    drive.retry(image(1).id)
    // El cliente de la API lleva a /login antes de soltar el error.
    await vi.waitFor(() => expect(drive.list.value[0]!.message).toBe(messages.common.sessionChanged), { timeout: 5000 })
  })

  it('cancelar en cola la retira; cancelar mientras se lee la aborta; cancelar mientras sube aborta el PUT y descarta la reserva', async () => {
    stubRead(() => new Promise(() => {}))
    const drive = usePrayerDriveSave()
    drive.save([entry(1), entry(2)])
    await flush()
    drive.cancel(image(2).id)
    expect(drive.list.value.map(save => save.imageId)).toEqual([image(1).id])
    drive.cancel(image(1).id)
    await flush(10)
    expect(drive.list.value).toEqual([])
    expect(toasts().filter(t => t.message === 'Cancelamos el guardado en el drive')).toHaveLength(2)

    let xhr: { abort: () => void } | undefined
    put.mockImplementation((_url: string, _body: Blob, _headers: unknown, _progress: unknown, register: (xhr: { abort: () => void }) => void) => new Promise<void>((_, reject) => {
      xhr = { abort: () => reject(new Error('abortado')) }
      register(xhr)
    }))
    stubRead(imageResponse())
    drive.save([entry(1)])
    await flush(10)
    expect(drive.list.value[0]!.stage).toBe('uploading')
    drive.cancel(image(1).id)
    await flush(10)
    expect(drive.list.value).toEqual([])
    expect(deletes('/api/uploads/f1')).toHaveLength(1)
    expect(posts('/api/uploads/f1/complete')).toHaveLength(0)
  })

  it('el avance de la subida se refleja y Descartar solo quita terminadas o fallidas', async () => {
    let progress: ((ratio: number) => void) | undefined
    put.mockImplementation((_url: string, _body: Blob, _headers: unknown, onProgress: (ratio: number) => void) => new Promise<void>((resolve) => {
      progress = (ratio) => {
        onProgress(ratio)
        if (ratio === 1) resolve()
      }
    }))
    const drive = usePrayerDriveSave()
    drive.save([entry(1)])
    await flush(10)
    progress?.(0.4)
    expect(drive.list.value[0]).toMatchObject({ stage: 'uploading', progress: 40 })
    drive.dismiss(image(1).id)
    expect(drive.list.value).toHaveLength(1)
    progress?.(1)
    await flush(10)
    expect(drive.list.value[0]).toMatchObject({ stage: 'done', progress: 100 })
    drive.dismiss(image(1).id)
    expect(drive.list.value).toEqual([])
    expect(drive.hasSaves.value).toBe(false)
  })
})
