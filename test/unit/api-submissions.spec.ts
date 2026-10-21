// US3 — envíos de invitados: endpoints públicos, cola, vista previa, aprobación y rechazo.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RATE_LIMITED_MESSAGE } from '../../shared/constants/messages'
import { authAs, backgroundTasks, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'

const s3 = vi.hoisted(() => ({
  presignPut: vi.fn(async (key: string) => `https://s3.test/put/${key}`),
  presignGet: vi.fn(async (key: string) => `https://s3.test/get/${key}`),
  head: vi.fn(),
  readRange: vi.fn(),
  deleteMany: vi.fn(async () => {}),
}))

vi.mock('../../server/utils/storage', () => ({
  key: (path: string) => `pre/${path}`,
  listPrefix: vi.fn(),
  ...s3,
}))

const JPEG = new Uint8Array(readFileSync(new URL('../fixtures/files/foto.jpg', import.meta.url))).subarray(0, 4096)
const FAKE = new Uint8Array(readFileSync(new URL('../fixtures/files/falso.jpg', import.meta.url)))

beforeEach(() => {
  for (const fn of Object.values(s3)) fn.mockClear()
  s3.head.mockReset()
  s3.readRange.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const SUB = UUID
const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'

const submission = (changes: Record<string, unknown> = {}) => ({
  id: SUB, senderName: 'Eva', note: 'Fotos', status: 'pending', senderKey: 'k', createdAt: created, completedAt: created,
  reviewedBy: null, reviewedAt: null, targetFolderId: null, rejectionReason: null, ...changes,
})
const guestFile = (changes: Record<string, unknown> = {}) => ({
  id: F1, submissionId: SUB, originalName: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image',
  sizeBytes: 8386, storageKey: `pre/guest/${SUB}/x`, uploadStatus: 'ready', ...changes,
})

describe('POST /api/public/submissions', () => {
  const body = { senderName: 'Eva', note: 'Fotos del domingo', files: [{ name: 'foto: 1.jpg', size: 8386, mimeType: 'image/jpeg' }, { name: 'audio.mp3', size: 10, mimeType: '' }] }

  it('aplica el límite por IP, registra el envío y firma cada archivo', async () => {
    const fake = installNitro([[{ count: 1 }], [], []])
    const handler = await loadHandler('api/public/submissions/index.post.ts')
    const event = makeEvent({ auth: undefined, body, headers: { 'x-forwarded-for': '203.0.113.7' } })
    const res = await handler(event) as { submissionId: string, uploads: { fileId: string, uploadUrl: string, headers: Record<string, string> }[] }
    expect(event.node.res.statusCode).toBe(201)
    expect(res.uploads).toHaveLength(2)
    expect(res.uploads[0]!.uploadUrl).toMatch(new RegExp(`^https://s3.test/put/pre/guest/${res.submissionId}/`))
    expect(res.uploads[1]!.headers).toEqual({ 'content-type': 'audio/mpeg' })

    const rate = fake.calls.find(c => c.method === 'values')?.args[0] as { key: string }
    expect(rate.key).toMatch(/^guest:[0-9a-f]{64}$/)
    expect(rate.key).not.toContain('203.0.113.7')
    const inserts = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(inserts[1]).toMatchObject({ senderName: 'Eva', note: 'Fotos del domingo' })
    expect(inserts[2]).toEqual([
      expect.objectContaining({ originalName: 'foto- 1.jpg', uploadStatus: 'uploading', category: 'image' }),
      expect.objectContaining({ originalName: 'audio.mp3', mimeType: 'audio/mpeg', category: 'audio' }),
    ])
    expect(s3.presignPut).toHaveBeenCalledTimes(2)
  })

  it('413/415 por archivo y 422 por datos inválidos, sin registrar nada', async () => {
    const fake = installNitro([[{ count: 1 }], [{ count: 1 }], [{ count: 1 }], [{ count: 1 }]])
    const handler = await loadHandler('api/public/submissions/index.post.ts')
    const call = (b: unknown) => Promise.resolve().then(() => handler(makeEvent({ auth: undefined, body: b })))
    await expectStatus(call({ ...body, files: [{ name: 'setup.exe', size: 1, mimeType: '' }] }), 415)
    await expectStatus(call({ ...body, files: [{ name: 'culto.mp4', size: 120 * 1024 * 1024, mimeType: 'video/mp4' }] }), 413)
    const error = await expectStatus(call({ ...body, senderName: '' }), 422)
    expect(error.data).toEqual({ errors: { senderName: 'Este campo es obligatorio' } })
    await expectStatus(call('no-json'), 422)
    expect(fake.calls.some(c => c.method === 'insert' && c.args[0] !== undefined && String(c.args[0]).includes('guest'))).toBe(false)
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it('entradas malformadas en `files` cuentan como archivos vacíos (415) y la nota es opcional', async () => {
    const fake = installNitro([[{ count: 1 }], [{ count: 1 }], [], []])
    const handler = await loadHandler('api/public/submissions/index.post.ts')
    const call = (b: unknown) => Promise.resolve().then(() => handler(makeEvent({ auth: undefined, body: b })))
    // Ni objetos, ni nombre de texto, ni tamaño numérico: no revienta la validación, se rechaza como formato no admitido.
    await expectStatus(call({ ...body, files: [null, 'foto.jpg', { name: 42, size: 'grande', mimeType: 7 }] }), 415)

    const res = await call({ senderName: 'Eva', files: [body.files[0]] }) as { uploads: unknown[] }
    expect(res.uploads).toHaveLength(1)
    const inserts = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(inserts.at(-2)).toMatchObject({ senderName: 'Eva', note: null })
  })

  it('responde 429 al superar 5 envíos por hora, con el mensaje en español', async () => {
    installNitro([[{ count: 6 }]])
    const handler = await loadHandler('api/public/submissions/index.post.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: undefined, body }))), 429)
    // Defensa en profundidad: el cliente traduce el 429, pero el servidor envía el mismo texto compartido.
    expect(error.message).toBe(RATE_LIMITED_MESSAGE)
  })
})

describe('POST /api/public/submissions/:id/complete', () => {
  const uploading = (changes: Record<string, unknown> = {}) => guestFile({ uploadStatus: 'uploading', ...changes })

  it('verifica cada archivo, descarta los inválidos y cierra el envío con completed_at', async () => {
    s3.head.mockResolvedValueOnce({ size: 8386 }).mockResolvedValueOnce({ size: 8386 })
    s3.readRange.mockResolvedValueOnce(JPEG).mockResolvedValueOnce(FAKE)
    // La primera consulta es el contador por IP (T158); la clave va con hash y en su propio cubo.
    const fake = installNitro([[{ count: 1 }], [submission({ completedAt: null })], [uploading(), uploading({ id: F2, storageKey: 'pre/guest/s/y' })], [], [], []])
    const handler = await loadHandler('api/public/submissions/[id]/complete.post.ts')
    const event = makeEvent({ auth: undefined, method: 'POST', params: { id: SUB }, headers: { 'x-forwarded-for': '203.0.113.7' } })
    expect(await handler(event)).toEqual({ status: 'pending', accepted: 1, rejected: 1 })
    const rate = fake.calls.find(c => c.method === 'values')?.args[0] as { key: string }
    expect(rate.key).toMatch(/^guest-complete:[0-9a-f]{64}$/)
    expect(rate.key).not.toContain('203.0.113.7')
    expect(s3.deleteMany).toHaveBeenCalledWith(['pre/guest/s/y', `pre/textsrc/${F2}.jpg`])
    const sets = fake.calls.filter(c => c.method === 'set').map(c => c.args[0])
    expect(sets[0]).toEqual({ uploadStatus: 'ready' })
    expect(sets[1]).toMatchObject({ completedAt: expect.any(Date) })
  })

  it('responde 429 al superar 10 cierres por hora y no toca el envío', async () => {
    const fake = installNitro([[{ count: 11 }]])
    const handler = await loadHandler('api/public/submissions/[id]/complete.post.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: undefined, method: 'POST', params: { id: SUB } }))), 429)
    expect(error.message).toBe(RATE_LIMITED_MESSAGE)
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(0)
    expect(s3.head).not.toHaveBeenCalled()
  })

  it('si ningún archivo es válido borra el envío y responde 422', async () => {
    s3.head.mockResolvedValueOnce(null)
    const fake = installNitro([[{ count: 1 }], [submission({ completedAt: null })], [uploading()], [], []])
    const handler = await loadHandler('api/public/submissions/[id]/complete.post.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: undefined, method: 'POST', params: { id: SUB } }))), 422)
    expect(error.message).toContain('Ningún archivo')
    expect(fake.calls.filter(c => c.method === 'delete')).toHaveLength(2)
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it('404 si no existe y 409 si ya fue cerrado o revisado', async () => {
    // Cada llamada consume primero su contador por IP, también la del id inválido.
    installNitro([[{ count: 1 }], [], [{ count: 1 }], [submission()], [{ count: 1 }], [submission({ status: 'rejected', completedAt: null })], [{ count: 1 }]])
    const handler = await loadHandler('api/public/submissions/[id]/complete.post.ts')
    const call = () => Promise.resolve().then(() => handler(makeEvent({ auth: undefined, method: 'POST', params: { id: SUB } })))
    await expectStatus(call(), 404)
    await expectStatus(call(), 409)
    await expectStatus(call(), 409)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: undefined, method: 'POST', params: { id: 'x' } }))), 404)
  })
})

describe('GET /api/submissions', () => {
  it('lista los pendientes con sus archivos listos, caducidad y vista previa', async () => {
    const fake = installNitro([[submission(), submission({ id: UUID2, senderName: 'Luis' })], [guestFile(), guestFile({ id: F2 })]])
    const handler = await loadHandler('api/submissions/index.get.ts')
    const list = await handler(makeEvent()) as { id: string, files: unknown[], expiresAt: string }[]
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: SUB, senderName: 'Eva', note: 'Fotos', status: 'pending', expiresAt: '2026-10-21T10:00:00.000Z',
      files: [
        { id: F1, name: 'foto.jpg', category: 'image', size: 8386, previewUrl: `/api/submissions/${SUB}/files/${F1}/content` },
        expect.objectContaining({ id: F2 }),
      ],
    })
    expect(sqlText(fake.calls.find(c => c.method === 'where')?.args[0])).toContain('pending')
  })

  it('filtra por estado, muestra aprobados aunque no tengan archivos y exige rol', async () => {
    const fake = installNitro([[submission({ status: 'approved' })], [], []])
    const handler = await loadHandler('api/submissions/index.get.ts')
    expect(await handler(makeEvent({ url: '/api/submissions?status=approved' }))).toHaveLength(1)
    expect(sqlText(fake.calls.find(c => c.method === 'where')?.args[0])).toContain('approved')
    expect(await handler(makeEvent({ url: '/api/submissions?status=rejected' }))).toEqual([])
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/submissions?status=x' }))), 422)
    await expectGuarded(handler)
  })
})

describe('GET /api/submissions/:id/files/:fileId/content', () => {
  it('redirige a la URL firmada del archivo listo, o 404', async () => {
    installNitro([[guestFile()], []])
    const handler = await loadHandler('api/submissions/[id]/files/[fileId]/content.get.ts')
    const event = makeEvent({ params: { id: SUB, fileId: F1 } })
    await handler(event)
    expect(event.node.res.statusCode).toBe(302)
    expect(event.node.res.getHeader('location')).toBe(`https://s3.test/get/pre/guest/${SUB}/x`)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: SUB, fileId: F1 } }))), 404)
    await expectGuarded(handler, { params: { id: SUB, fileId: F1 } })
  })
})

describe('POST /api/submissions/:id/approve', () => {
  const folder = { id: UUID2, parentId: null, name: 'Domingo', createdBy: 'u1', createdAt: created, updatedAt: created, deletedAt: null, deletedBy: null, trashRootId: null }
  const fileRow = (changes: Record<string, unknown> = {}) => ({
    id: F1, folderId: UUID2, name: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 8386,
    storageKey: `pre/guest/${SUB}/x`, thumbKey: null, uploadStatus: 'ready', origin: 'guest', uploadedBy: null, guestName: 'Eva',
    submissionId: SUB, createdAt: created, updatedAt: created, deletedAt: null, deletedBy: null, trashRootId: null, uploaderName: null, ...changes,
  })

  it('aprueba hacia una carpeta en un solo lote, con sufijos, y registra la actividad', async () => {
    // Cola: carpeta, envío, archivos del envío, nombres tomados (×2), INSERT (execute), UPDATE, actividad, archivos creados.
    const fake = installNitro([
      [folder], [submission()], [guestFile(), guestFile({ id: F2, originalName: 'foto.jpg', storageKey: 'pre/guest/s/y' })],
      [{ name: 'foto.jpg' }], [{ name: 'foto.jpg' }],
      { rows: [{ id: F1 }, { id: F2 }] }, [{ id: SUB }], [],
      [fileRow({ name: 'foto (2).jpg' }), fileRow({ id: F2, name: 'foto (3).jpg' })],
    ])
    const handler = await loadHandler('api/submissions/[id]/approve.post.ts')
    const res = await handler(makeEvent({ method: 'POST', params: { id: SUB }, body: { folderId: UUID2 } })) as { files: { name: string, origin: string }[] }
    expect(res.files.map(f => f.name)).toEqual(['foto (2).jpg', 'foto (3).jpg'])
    expect(res.files[0]).toMatchObject({ origin: 'guest', guestName: 'Eva', uploadedBy: null })

    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ status: 'approved', reviewedBy: 'u1', targetFolderId: UUID2 })
    const insert = sqlText(fake.db.execute.mock.calls[0]![0])
    expect(insert).toContain('INSERT INTO files')
    expect(insert).toContain(`gs.status = 'approved'`)
    expect(insert).toContain('foto (2).jpg')
    expect(insert).toContain('foto (3).jpg')
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({ action: 'submission.approve', targetLabel: 'Eva', meta: { files: 2, folderId: UUID2 } })
  })

  it('si otra persona ganó la carrera responde 409 y no registra nada', async () => {
    const fake = installNitro([[submission()], [guestFile()], [], { rows: [] }, []])
    const handler = await loadHandler('api/submissions/[id]/approve.post.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'POST', params: { id: SUB }, body: { folderId: null } }))), 409)
    expect(error.message).toBe('Este envío ya fue revisado por otra persona')
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('404 si no existe, 409 si ya fue revisado o no tiene archivos, 422 con carpeta inválida y exige rol', async () => {
    installNitro([[], [submission({ status: 'approved' })], [submission()], []])
    const handler = await loadHandler('api/submissions/[id]/approve.post.ts')
    const call = (body: unknown) => Promise.resolve().then(() => handler(makeEvent({ method: 'POST', params: { id: SUB }, body })))
    await expectStatus(call({ folderId: null }), 404)
    await expectStatus(call({ folderId: null }), 409)
    await expectStatus(call({ folderId: null }), 409)
    await expectStatus(call({ folderId: 'x' }), 422)
    await expectGuarded(handler, { method: 'POST', params: { id: SUB }, body: { folderId: null } })
  })
})

describe('POST /api/submissions/:id/reject', () => {
  it('marca como rechazado, borra objetos y archivos y registra el motivo', async () => {
    const fake = installNitro([[submission({ status: 'rejected' })], [{ id: F1, storageKey: 'a', textSourceKey: null }, { id: F2, storageKey: 'b', textSourceKey: `pre/textsrc/${F2}.jpg` }], [], []])
    const handler = await loadHandler('api/submissions/[id]/reject.post.ts')
    const event = makeEvent({ method: 'POST', params: { id: SUB }, body: { reason: 'Borrosa' } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ status: 'rejected', rejectionReason: 'Borrosa', reviewedBy: 'u1' })
    // También la copia JPEG de cada HEIC (feature 002), derivada del id aunque la columna esté vacía.
    expect(s3.deleteMany).toHaveBeenCalledWith(['a', '', `pre/textsrc/${F1}.jpg`, 'b', `pre/textsrc/${F2}.jpg`, `pre/textsrc/${F2}.jpg`])
    expect(fake.calls.some(c => c.method === 'delete')).toBe(true)
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({ action: 'submission.reject', meta: { reason: 'Borrosa' } })
  })

  it('409 si ya fue revisado, 404 si no existe y exige rol', async () => {
    installNitro([[], [{ id: SUB }], [], []])
    const handler = await loadHandler('api/submissions/[id]/reject.post.ts')
    const call = () => Promise.resolve().then(() => handler(makeEvent({ method: 'POST', params: { id: SUB }, body: {} })))
    await expectStatus(call(), 409)
    await expectStatus(call(), 404)
    await expectGuarded(handler, { method: 'POST', params: { id: SUB }, body: {} })
    expect(s3.deleteMany).not.toHaveBeenCalled()
  })

  it('un invitado sin sesión no puede revisar', async () => {
    installNitro()
    const handler = await loadHandler('api/submissions/[id]/reject.post.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: authAs({ status: 'pending', role: null }), method: 'POST', params: { id: SUB }, body: {} }))), 403)
  })
})

describe('texto de las imágenes de invitados (feature 002)', () => {
  const HEIC_HEADER = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])

  it('POST /api/public/submissions firma la copia JPEG solo para una HEIC apta que la pide', async () => {
    installNitro([[{ count: 1 }], [], []])
    const handler = await loadHandler('api/public/submissions/index.post.ts')
    const res = await handler(makeEvent({
      auth: undefined,
      body: {
        senderName: 'Eva',
        files: [
          { name: 'IMG_1.heic', size: 3_000_000, mimeType: 'image/heic', withTextSource: true },
          { name: 'IMG_2.heic', size: 3_000_000, mimeType: 'image/heic' },
          { name: 'IMG_3.heic', size: 6_000_000, mimeType: 'image/heic', withTextSource: true },
          { name: 'foto.jpg', size: 8386, mimeType: 'image/jpeg', withTextSource: true },
        ],
      },
    })) as { uploads: { fileId: string, textSourceUploadUrl?: string }[] }
    expect(res.uploads[0]!.textSourceUploadUrl).toBe(`https://s3.test/put/pre/textsrc/${res.uploads[0]!.fileId}.jpg`)
    expect(res.uploads.slice(1).map(u => u.textSourceUploadUrl)).toEqual([undefined, undefined, undefined])
    expect(s3.presignPut).toHaveBeenCalledWith(`pre/textsrc/${res.uploads[0]!.fileId}.jpg`, { contentType: 'image/jpeg' })
  })

  const complete = async (files: Record<string, unknown>[], overrides: Record<string, unknown> = {}) => {
    const readSubmissionImages = vi.fn(async () => {})
    const checkTextSourceCopy = vi.fn(async () => true)
    installNitro([[{ count: 1 }], [submission({ completedAt: null })], files.map(f => guestFile({ uploadStatus: 'uploading', ...f })), [], []], { readSubmissionImages, checkTextSourceCopy, ...overrides })
    const handler = await loadHandler('api/public/submissions/[id]/complete.post.ts')
    const body = await handler(makeEvent({ auth: undefined, method: 'POST', params: { id: SUB } }))
    return { body, readSubmissionImages, checkTextSourceCopy }
  }

  it('complete programa la lectura del envío en segundo plano y responde sin esperarla', async () => {
    s3.head.mockResolvedValue({ size: 8386 })
    s3.readRange.mockResolvedValue(JPEG)
    const { body, readSubmissionImages } = await complete([{}])
    expect(body).toEqual({ status: 'pending', accepted: 1, rejected: 0 })
    expect(backgroundTasks).toHaveLength(1)
    expect(readSubmissionImages).not.toHaveBeenCalled()
    await backgroundTasks[0]!()
    expect(readSubmissionImages).toHaveBeenCalledWith(SUB, { concurrency: 4 })
  })

  it('valida la copia de cada HEIC apta y sin imágenes aptas no programa nada', async () => {
    s3.head.mockResolvedValue({ size: 3_000_000 })
    s3.readRange.mockResolvedValue(HEIC_HEADER)
    const heic = { originalName: 'IMG.heic', extension: 'heic', mimeType: 'image/heic', sizeBytes: 3_000_000 }
    const valid = await complete([heic])
    expect(valid.checkTextSourceCopy).toHaveBeenCalledWith({ table: 'guest_submission_files', id: F1 })
    expect(backgroundTasks).toHaveLength(1)

    const missing = await complete([heic], { checkTextSourceCopy: vi.fn(async () => false) })
    expect(missing.body).toEqual({ status: 'pending', accepted: 1, rejected: 0 })
    expect(backgroundTasks).toHaveLength(0)

    s3.head.mockResolvedValue({ size: 10 })
    s3.readRange.mockResolvedValue(new TextEncoder().encode('hola'))
    const notImage = await complete([{ originalName: 'n.txt', extension: 'txt', mimeType: 'text/plain', category: 'document', sizeBytes: 10 }])
    expect(notImage.checkTextSourceCopy).not.toHaveBeenCalled()
    expect(backgroundTasks).toHaveLength(0)
  })

  it('GET /api/submissions incluye el texto de cada imagen en el mismo listado (null si no es imagen)', async () => {
    const fake = installNitro([[submission()], [
      guestFile({ textStatus: 'ready', textContent: 'Oremos', textReadAt: created }),
      guestFile({ id: F2, originalName: 'a.mp3', extension: 'mp3', category: 'audio' }),
    ]])
    const handler = await loadHandler('api/submissions/index.get.ts')
    const [first] = await handler(makeEvent()) as { files: { text: unknown }[] }[]
    expect(first!.files.map(f => f.text)).toEqual([
      { status: 'ready', text: 'Oremos', error: null, readAt: created.toISOString(), editedAt: null, editedBy: null },
      null,
    ])
    expect(fake.db.execute).not.toHaveBeenCalled()
  })

  const textRow = (changes: Record<string, unknown> = {}) => ({
    id: F1, extension: 'jpg', category: 'image', size_bytes: 8386, storage_key: `pre/guest/${SUB}/x`, text_status: 'ready',
    text_content: 'Oremos', text_error: null, text_source_key: null, text_attempts: 1, text_started_at: null,
    text_read_at: null, text_edited_at: null, edited_by_name: null, ...changes,
  })
  const textEvent = (method = 'GET', body?: unknown) => makeEvent({ method, params: { id: SUB, fileId: F1 }, body })

  it('GET …/files/:fileId/text devuelve el DTO también tras aprobar; 404 si no existe', async () => {
    installNitro([[{ status: 'approved' }], { rows: [textRow()] }])
    const handler = await loadHandler('api/submissions/[id]/files/[fileId]/text.get.ts')
    expect(await handler(textEvent())).toMatchObject({ status: 'ready', text: 'Oremos' })
    installNitro([[]])
    await expectStatus(Promise.resolve(handler(textEvent())), 404)
    installNitro()
    await expectGuarded(handler, { params: { id: SUB, fileId: F1 } })
  })

  it('POST …/files/:fileId/text: mismas reglas que /api/files/:id/text, 409 si el envío ya no está pendiente', async () => {
    installNitro([[{ status: 'pending' }], { rows: [textRow()] }])
    const handler = await loadHandler('api/submissions/[id]/files/[fileId]/text.post.ts')
    expect(await handler(textEvent('POST', {}))).toMatchObject({ status: 'ready' })

    const fake = installNitro([[{ status: 'pending' }], { rows: [textRow({ text_status: 'failed' })] }, { rows: [] }])
    await expectStatus(Promise.resolve(handler(textEvent('POST', { force: true }))), 409)
    expect(sqlText(fake.db.execute.mock.calls[1]![0])).toContain(`UPDATE "guest_submission_files" t`)

    installNitro([[{ status: 'approved' }]])
    await expectStatus(Promise.resolve(handler(textEvent('POST', {}))), 409)
    installNitro([[]])
    await expectStatus(Promise.resolve(handler(textEvent('POST', {}))), 404)
    installNitro()
    await expectGuarded(handler, { method: 'POST', params: { id: SUB, fileId: F1 }, body: {} })
  })

  it('approve copia las columnas text_* al archivo, sin volver a leer (FR-010)', async () => {
    const fake = installNitro([[submission()], [guestFile()], [], { rows: [{ id: F1 }] }, [{ id: SUB }], [], []])
    const handler = await loadHandler('api/submissions/[id]/approve.post.ts')
    await handler(makeEvent({ method: 'POST', params: { id: SUB }, body: { folderId: null } }))
    const insert = sqlText(fake.db.execute.mock.calls[0]![0])
    expect(insert).toContain('text_status, text_content, text_error, text_attempts, text_started_at, text_read_at, text_source_key')
    expect(insert).toContain('g.text_status, g.text_content, g.text_error, g.text_attempts, g.text_started_at, g.text_read_at, g.text_source_key')
    expect(insert).toContain('JOIN guest_submission_files g ON g.id = v.id')
  })
})
