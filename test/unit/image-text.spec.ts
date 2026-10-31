// Capa de aplicación del texto de imágenes (feature 002): DTO, lectura de una fila reclamada, lectura en
// segundo plano del equipo, reglas comunes de `POST …/text` y validación de la copia HEIC.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageTextRow } from '../../server/utils/image-text-store'
import { expectStatus, installNitro, sqlText, UUID } from './helpers/nitro'

const s3 = vi.hoisted(() => ({
  head: vi.fn(),
  readRange: vi.fn(),
  deleteMany: vi.fn(async () => {}),
}))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

const ai = vi.hoisted(() => ({ extractImageText: vi.fn(), resolveImageTextModel: vi.fn() }))
vi.mock('#server/ai', async () => {
  const schemas = await import('../../server/ai/image-text/schemas')
  const breaker = await import('../../server/ai/breaker')
  return {
    extractImageText: ai.extractImageText,
    imageSourceSchema: schemas.imageSourceSchema,
    createProviderBreaker: breaker.createProviderBreaker,
    resolveImageTextModel: ai.resolveImageTextModel,
  }
})

const {
  canReadImageText,
  checkTextSourceCopy,
  getImageText,
  readFileImage,
  readImageText,
  requestImageTextRead,
  toImageText,
} = await import('../../server/utils/image-text')

const JPEG = new Uint8Array(readFileSync(new URL('../fixtures/files/foto.jpg', import.meta.url)))
const PNG = new Uint8Array(readFileSync(new URL('../fixtures/files/imagen.png', import.meta.url)))
const FAKE = new Uint8Array(readFileSync(new URL('../fixtures/files/falso.jpg', import.meta.url)))
const CLAIMED_AT = '2026-10-21 10:00:00.123456+00'
const FILE = { table: 'files' as const, id: UUID }
const GUEST = { table: 'guest_submission_files' as const, id: UUID }

const rawRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID, extension: 'jpg', category: 'image', size_bytes: JPEG.byteLength, storage_key: `pre/files/${UUID}`,
  text_status: null, text_content: null, text_error: null, text_source_key: null, text_attempts: 0,
  text_started_at: null, text_read_at: null, text_edited_at: null, edited_by_name: null, ...changes,
})
const claimedRaw = (changes: Record<string, unknown> = {}) =>
  ({ ...rawRow({ text_status: 'reading', text_started_at: new Date().toISOString(), text_attempts: 1, ...changes }), claimed_at: CLAIMED_AT })

const row = (changes: Partial<ImageTextRow> = {}): ImageTextRow => ({
  id: UUID, extension: 'jpg', category: 'image', sizeBytes: JPEG.byteLength, storageKey: `pre/files/${UUID}`,
  textStatus: null, textContent: null, textError: null, textSourceKey: null, textAttempts: 0,
  textStartedAt: null, textReadAt: null, textEditedAt: null, editedByName: null, ...changes,
})
const claimed = (changes: Partial<ImageTextRow> = {}) => ({ ...row({ textStatus: 'reading', textStartedAt: new Date(), ...changes }), claimedAt: CLAIMED_AT })

const queries = (fake: ReturnType<typeof installNitro>) => fake.db.execute.mock.calls.map(c => sqlText(c[0]))

beforeEach(() => {
  s3.head.mockReset()
  s3.readRange.mockReset()
  s3.deleteMany.mockClear()
  ai.extractImageText.mockReset()
  ai.resolveImageTextModel.mockReset()
  ai.resolveImageTextModel.mockReturnValue({ modelId: 'modelo' })
  ai.extractImageText.mockResolvedValue({ status: 'ready', text: 'Oremos por Ana' })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('toImageText', () => {
  const now = new Date('2026-10-21T10:00:00Z').getTime()

  it('NULL → pending, sin texto', () => {
    expect(toImageText(row(), now)).toEqual({ status: 'pending', text: null, error: null, readAt: null, editedAt: null, editedBy: null })
  })

  it('el texto solo viaja en ready, con quien lo corrigió', () => {
    const readAt = new Date(now - 1000)
    expect(toImageText(row({ textStatus: 'ready', textContent: 'Hola', textReadAt: readAt, textEditedAt: readAt, editedByName: 'Ana' }), now))
      .toEqual({ status: 'ready', text: 'Hola', error: null, readAt: readAt.toISOString(), editedAt: readAt.toISOString(), editedBy: 'Ana' })
    expect(toImageText(row({ textStatus: 'empty', textContent: 'resto' }), now).text).toBeNull()
  })

  it('failed lleva su código (provider si falta)', () => {
    expect(toImageText(row({ textStatus: 'failed', textError: 'quota_exceeded' }), now).error).toBe('quota_exceeded')
    expect(toImageText(row({ textStatus: 'failed' }), now).error).toBe('provider')
  })

  it('reading de más de 90 s se muestra como failed/timeout; de menos, reading', () => {
    expect(toImageText(row({ textStatus: 'reading', textStartedAt: new Date(now - 91_000) }), now))
      .toMatchObject({ status: 'failed', error: 'timeout' })
    expect(toImageText(row({ textStatus: 'reading', textStartedAt: new Date(now - 30_000) }), now))
      .toMatchObject({ status: 'reading', error: null })
  })
})

describe('canReadImageText', () => {
  it('JPEG/PNG apta, o HEIC solo con copia', () => {
    expect(canReadImageText({ category: 'image', extension: 'png', sizeBytes: 10 }, false)).toBe(true)
    expect(canReadImageText({ category: 'image', extension: 'heic', sizeBytes: 10 }, false)).toBe(false)
    expect(canReadImageText({ category: 'image', extension: 'heic', sizeBytes: 10 }, true)).toBe(true)
    expect(canReadImageText({ category: 'image', extension: 'webp', sizeBytes: 10 }, false)).toBe(false)
  })
})

describe('readImageText', () => {
  it('lee los bytes tal cual con su mediaType y guarda el resultado en la misma reclamación', async () => {
    const fake = installNitro([{ rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(JPEG)
    const dto = await readImageText(FILE, claimed())
    expect(s3.readRange).toHaveBeenCalledWith(`pre/files/${UUID}`, 0, JPEG.byteLength - 1)
    expect(ai.extractImageText).toHaveBeenCalledWith({ image: { mediaType: 'image/jpeg', data: JPEG }, abortSignal: undefined, breaker: undefined, model: undefined })
    expect(dto).toMatchObject({ status: 'ready', text: 'Oremos por Ana', error: null })
    expect(queries(fake)[0]).toContain(CLAIMED_AT)
    expect(queries(fake)[0]).toContain('"ready","Oremos por Ana"')
  })

  it('PNG viaja como image/png', async () => {
    installNitro([{ rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(PNG)
    await readImageText(FILE, claimed({ extension: 'png', sizeBytes: PNG.byteLength }))
    expect(ai.extractImageText.mock.calls[0]![0].image.mediaType).toBe('image/png')
  })

  it('una HEIC con copia lee textsrc/<id>.jpg como JPEG', async () => {
    installNitro([{ rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(JPEG)
    await readImageText(FILE, claimed({ extension: 'heic', sizeBytes: 3_000_000, textSourceKey: `pre/textsrc/${UUID}.jpg` }))
    expect(s3.readRange).toHaveBeenCalledWith(`pre/textsrc/${UUID}.jpg`, 0, 5_242_879)
    expect(ai.extractImageText.mock.calls[0]![0].image.mediaType).toBe('image/jpeg')
  })

  it.each([
    ['no es imagen', { category: 'document', extension: 'pdf' }],
    ['formato no apto', { extension: 'webp' }],
    ['más de 5 MB', { sizeBytes: 5_242_881 }],
    ['HEIC sin copia', { extension: 'heic', textSourceKey: null }],
  ])('%s → unavailable sin llamar a la IA', async (_, changes) => {
    const fake = installNitro([{ rows: [] }])
    expect(await readImageText(FILE, claimed(changes))).toMatchObject({ status: 'unavailable' })
    expect(ai.extractImageText).not.toHaveBeenCalled()
    expect(queries(fake)[0]).toContain(`'unavailable'`)
  })

  it('una firma real distinta de la extensión → unavailable sin llamar al modelo (FR-021)', async () => {
    installNitro([{ rows: [] }])
    s3.readRange.mockResolvedValue(FAKE)
    expect(await readImageText(FILE, claimed({ sizeBytes: FAKE.byteLength }))).toMatchObject({ status: 'unavailable' })
    expect(ai.extractImageText).not.toHaveBeenCalled()
  })

  it('un id no válido → failed/invalid_input', async () => {
    const fake = installNitro([{ rows: [{ saved: 1 }] }])
    expect(await readImageText(FILE, claimed({ id: 'no-uuid' }))).toMatchObject({ status: 'failed', error: 'invalid_input' })
    expect(queries(fake)[0]).toContain('"failed",null,"invalid_input"')
  })

  it('guarda empty y failed con su código', async () => {
    installNitro([{ rows: [{ saved: 1 }] }, { rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(JPEG)
    ai.extractImageText.mockResolvedValueOnce({ status: 'empty' }).mockResolvedValueOnce({ status: 'failed', error: 'rate_limited' })
    expect(await readImageText(FILE, claimed())).toMatchObject({ status: 'empty', text: null })
    expect(await readImageText(FILE, claimed())).toMatchObject({ status: 'failed', error: 'rate_limited' })
  })

  it('pasa el presupuesto, el cortacircuito y el modelo a la IA', async () => {
    installNitro([{ rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(JPEG)
    const abortSignal = new AbortController().signal
    const breaker = { isOpen: vi.fn() } as never
    const model = { modelId: 'preset' } as never
    await readImageText(GUEST, claimed(), { abortSignal, breaker, model })
    expect(ai.extractImageText.mock.calls[0]![0]).toMatchObject({ abortSignal, breaker, model })
  })

  it('un fallo del storage queda como failed/provider y nunca lanza', async () => {
    installNitro([{ rows: [{ saved: 1 }] }])
    s3.readRange.mockRejectedValue(new Error('S3 caído'))
    expect(await readImageText(FILE, claimed())).toMatchObject({ status: 'failed', error: 'provider' })
  })

  it('si tampoco se puede guardar, devuelve el fallo sin lanzar', async () => {
    installNitro([new Error('BD caída')])
    s3.readRange.mockRejectedValue(new Error('S3 caído'))
    expect(await readImageText(FILE, claimed())).toMatchObject({ status: 'failed', error: 'provider' })
  })
})

describe('readFileImage', () => {
  it('reclama la fila de files y la lee', async () => {
    const fake = installNitro([{ rows: [claimedRaw()] }, { rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(JPEG)
    await readFileImage(UUID)
    expect(queries(fake)[0]).toContain('UPDATE "files" t')
    expect(queries(fake)[0]).not.toContain(`IN ('failed'`)
    expect(ai.extractImageText).toHaveBeenCalledTimes(1)
  })

  it('sin clave de OpenRouter no reclama, no descarga y no marca la imagen como failed', async () => {
    ai.resolveImageTextModel.mockReturnValue(null)
    const fake = installNitro([{ rows: [claimedRaw()] }])
    await readFileImage(UUID)
    expect(fake.calls).toHaveLength(0)
    expect(s3.readRange).not.toHaveBeenCalled()
    expect(ai.extractImageText).not.toHaveBeenCalled()
  })

  it('con una lectura vigente o un estado terminal no hace nada', async () => {
    installNitro([{ rows: [] }])
    await readFileImage(UUID)
    expect(ai.extractImageText).not.toHaveBeenCalled()
  })

  it('nunca lanza', async () => {
    installNitro([new Error('BD caída')])
    await expect(readFileImage(UUID)).resolves.toBeUndefined()
  })
})

describe('requestImageTextRead', () => {
  const stale = () => new Date(Date.now() - 120_000).toISOString()
  const fresh = () => new Date(Date.now() - 5_000).toISOString()

  it('sin fila → 404', async () => {
    installNitro([{ rows: [] }])
    await expectStatus(requestImageTextRead(FILE), 404)
  })

  it.each(['ready', 'empty', 'failed', 'unavailable'])('sin force devuelve %s tal cual, sin leer', async (status) => {
    const fake = installNitro([{ rows: [rawRow({ text_status: status, text_content: 'Hola', text_error: 'timeout' })] }])
    expect((await requestImageTextRead(FILE)).status).toBe(status)
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
    expect(ai.extractImageText).not.toHaveBeenCalled()
  })

  it('NULL → reclama y lee en la petición', async () => {
    installNitro([{ rows: [rawRow()] }, { rows: [claimedRaw()] }, { rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(JPEG)
    expect(await requestImageTextRead(FILE)).toMatchObject({ status: 'ready', text: 'Oremos por Ana' })
  })

  it('una lectura vencida se vuelve a leer; una vigente responde reading', async () => {
    installNitro([{ rows: [rawRow({ text_status: 'reading', text_started_at: stale() })] }, { rows: [claimedRaw()] }, { rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(JPEG)
    expect((await requestImageTextRead(FILE)).status).toBe('ready')

    const fake = installNitro([{ rows: [rawRow({ text_status: 'reading', text_started_at: fresh() })] }])
    expect((await requestImageTextRead(FILE)).status).toBe('reading')
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
  })

  it('si otro lector se adelanta, devuelve su lectura en curso', async () => {
    installNitro([{ rows: [rawRow()] }, { rows: [] }, { rows: [rawRow({ text_status: 'reading', text_started_at: fresh() })] }])
    expect((await requestImageTextRead(FILE)).status).toBe('reading')
    expect(ai.extractImageText).not.toHaveBeenCalled()
  })

  it('una imagen no apta se marca unavailable una sola vez', async () => {
    const fake = installNitro([{ rows: [rawRow({ extension: 'gif' })] }, { rows: [] }])
    expect((await requestImageTextRead(FILE)).status).toBe('unavailable')
    expect(queries(fake)[1]).toContain(`'unavailable'`)
  })

  it.each(['failed', 'ready', 'empty'])('con force reclama desde %s', async (status) => {
    const fake = installNitro([{ rows: [rawRow({ text_status: status })] }, { rows: [claimedRaw()] }, { rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(JPEG)
    expect((await requestImageTextRead(FILE, { force: true })).status).toBe('ready')
    expect(queries(fake)[1]).toContain(`IN ('failed', 'ready', 'empty')`)
  })

  it('con force sobre unavailable, una lectura vigente o una reclamación perdida → 409', async () => {
    installNitro([{ rows: [rawRow({ text_status: 'unavailable', extension: 'gif' })] }])
    await expectStatus(requestImageTextRead(FILE, { force: true }), 409)
    installNitro([{ rows: [rawRow({ text_status: 'unavailable' })] }])
    await expectStatus(requestImageTextRead(FILE, { force: true }), 409)
    installNitro([{ rows: [rawRow({ text_status: 'reading', text_started_at: fresh() })] }])
    await expectStatus(requestImageTextRead(FILE, { force: true }), 409)
    installNitro([{ rows: [rawRow({ text_status: 'failed' })] }, { rows: [] }])
    await expectStatus(requestImageTextRead(FILE, { force: true }), 409)
  })

  it('un fallo de lectura no es un error HTTP', async () => {
    installNitro([{ rows: [rawRow()] }, { rows: [claimedRaw()] }, { rows: [{ saved: 1 }] }])
    s3.readRange.mockResolvedValue(JPEG)
    ai.extractImageText.mockResolvedValue({ status: 'failed', error: 'provider' })
    expect(await requestImageTextRead(FILE)).toMatchObject({ status: 'failed', error: 'provider' })
  })
})

describe('getImageText', () => {
  it('devuelve el DTO o 404', async () => {
    installNitro([{ rows: [rawRow({ text_status: 'empty' })] }])
    expect((await getImageText(FILE)).status).toBe('empty')
    installNitro([{ rows: [] }])
    await expectStatus(getImageText(FILE), 404)
  })
})

describe('checkTextSourceCopy', () => {
  it('una copia válida guarda text_source_key', async () => {
    const fake = installNitro([{ rows: [] }])
    s3.head.mockResolvedValue({ size: 400_000 })
    s3.readRange.mockResolvedValue(JPEG.subarray(0, 4096))
    expect(await checkTextSourceCopy(FILE)).toBe(true)
    expect(s3.readRange).toHaveBeenCalledWith(`pre/textsrc/${UUID}.jpg`, 0, 4095)
    expect(queries(fake)[0]).toContain(`pre/textsrc/${UUID}.jpg`)
    expect(s3.deleteMany).not.toHaveBeenCalled()
  })

  it('ausente → unavailable sin borrar nada', async () => {
    const fake = installNitro([{ rows: [] }])
    s3.head.mockResolvedValue(null)
    expect(await checkTextSourceCopy(GUEST)).toBe(false)
    expect(s3.deleteMany).not.toHaveBeenCalled()
    expect(queries(fake)[0]).toMatch(/UPDATE "guest_submission_files"\s+SET text_status = 'unavailable'/)
  })

  it.each([
    ['vacía', { size: 0 }, JPEG],
    ['de más de 5 MB', { size: 5_242_881 }, JPEG],
    ['con firma inválida', { size: 512 }, FAKE],
  ])('%s → se borra y queda unavailable', async (_, object, bytes) => {
    installNitro([{ rows: [] }])
    s3.head.mockResolvedValue(object)
    s3.readRange.mockResolvedValue(bytes)
    expect(await checkTextSourceCopy(FILE)).toBe(false)
    expect(s3.deleteMany).toHaveBeenCalledWith([`pre/textsrc/${UUID}.jpg`])
  })

  it('nunca lanza', async () => {
    installNitro([new Error('BD caída')])
    s3.head.mockRejectedValue(new Error('S3 caído'))
    await expect(checkTextSourceCopy(FILE)).resolves.toBe(false)
  })
})
