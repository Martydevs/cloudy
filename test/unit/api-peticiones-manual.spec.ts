// Alta manual de una petición («Agregar petición» en /peticiones): crea el envío con el remitente de la sesión, solo con
// imágenes, y al cerrar la subida lo deja aprobado en un solo lote, sin pasar por Solicitudes ni por el aviso en vivo.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RATE_LIMITED_MESSAGE } from '../../shared/constants/messages'
import { authAs, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID } from './helpers/nitro'

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
const CREATE = 'api/peticiones/manual/index.post.ts'
const COMPLETE = 'api/peticiones/manual/[id]/complete.post.ts'

const photo = { name: 'peticion.jpg', size: 8386, mimeType: 'image/jpeg' }

describe('POST /api/peticiones/manual', () => {
  it('crea el envío con el nombre del perfil (ignora el del cuerpo), la clave del autor y un PUT firmado por foto', async () => {
    const fake = installNitro([[{ count: 1 }], [], []])
    const handler = await loadHandler(CREATE)
    const event = makeEvent({ body: { senderName: 'Otra persona', note: ' Entregada en papel ', files: [photo, { name: 'otra.png', size: 10, mimeType: '' }] } })
    const res = await handler(event) as { submissionId: string, uploads: { fileId: string, uploadUrl: string }[] }
    expect(event.node.res.statusCode).toBe(201)
    expect(res.uploads).toHaveLength(2)
    expect(res.uploads[0]!.uploadUrl).toMatch(new RegExp(`^https://s3.test/put/pre/guest/${res.submissionId}/`))

    const inserts = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    // Límite por persona, no por IP.
    expect(inserts[0]).toMatchObject({ key: 'peticiones-manual:u1' })
    expect(inserts[1]).toEqual({ id: res.submissionId, senderName: 'Ana', note: 'Entregada en papel', senderKey: 'manual:u1' })
    expect(inserts[2]).toEqual([
      expect.objectContaining({ originalName: 'peticion.jpg', category: 'image', uploadStatus: 'uploading' }),
      expect.objectContaining({ originalName: 'otra.png', mimeType: 'image/png', category: 'image' }),
    ])
    // Envío y archivos en un mismo lote: o se escriben los dos o ninguno.
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
  })

  it('sin nombre en el perfil usa la parte local del correo; la nota es opcional', async () => {
    const fake = installNitro([[{ count: 1 }], [], []])
    const handler = await loadHandler(CREATE)
    await handler(makeEvent({ auth: authAs({ name: '   ', email: 'ana.ruiz@iglesia.org' }), body: { files: [photo] } }))
    const inserts = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(inserts[1]).toMatchObject({ senderName: 'ana.ruiz', note: null })
  })

  it('solo imágenes: un PDF, un audio o un formato no admitido → 415 sin registrar nada; un archivo enorme → 413', async () => {
    const fake = installNitro(Array.from({ length: 6 }, () => [{ count: 1 }]))
    const handler = await loadHandler(CREATE)
    const call = (files: unknown[]) => Promise.resolve().then(() => handler(makeEvent({ body: { files } })))
    const pdf = await expectStatus(call([photo, { name: 'peticion.pdf', size: 10, mimeType: 'application/pdf' }]), 415)
    expect(pdf.message).toBe('«peticion.pdf»: solo se aceptan imágenes')
    await expectStatus(call([{ name: 'audio.mp3', size: 10, mimeType: 'audio/mpeg' }]), 415)
    await expectStatus(call([{ name: 'setup.exe', size: 10, mimeType: '' }]), 415)
    await expectStatus(call([{ name: 'foto.jpg', size: 120 * 1024 * 1024, mimeType: 'image/jpeg' }]), 413)
    const empty = await expectStatus(call([]), 422)
    expect(empty.data).toEqual({ errors: { files: expect.any(String) } })
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ body: { note: 'x'.repeat(501), files: [photo] } }))), 422)
    expect(fake.db.batch).not.toHaveBeenCalled()
    expect(s3.presignPut).not.toHaveBeenCalled()
  })

  it('responde 429 al superar 60 altas por hora y exige rol de equipo antes de tocar nada', async () => {
    const fake = installNitro([[{ count: 61 }]])
    const handler = await loadHandler(CREATE)
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ body: { files: [photo] } }))), 429)
    expect(error.message).toBe(RATE_LIMITED_MESSAGE)
    expect(fake.db.batch).not.toHaveBeenCalled()

    const guarded = installNitro()
    await expectGuarded(await loadHandler(CREATE), { body: { files: [photo] } })
    expect(guarded.calls).toEqual([])
  })
})

describe('POST /api/peticiones/manual/:id/complete', () => {
  const submission = (changes: Record<string, unknown> = {}) => ({
    id: SUB, senderName: 'Ana', note: null, status: 'pending', senderKey: 'manual:u1', createdAt: created, completedAt: null,
    reviewedBy: null, reviewedAt: null, targetFolderId: null, rejectionReason: null, ...changes,
  })
  const uploading = (changes: Record<string, unknown> = {}) => ({
    id: F1, submissionId: SUB, originalName: 'peticion.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image',
    sizeBytes: 8386, storageKey: `pre/guest/${SUB}/x`, uploadStatus: 'uploading', previewKey: null, ...changes,
  })
  const fileRow = (changes: Record<string, unknown> = {}) => ({
    id: F1, folderId: null, name: 'peticion.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 8386,
    storageKey: `pre/guest/${SUB}/x`, thumbKey: null, uploadStatus: 'ready', origin: 'guest', uploadedBy: null, guestName: 'Ana',
    submissionId: SUB, createdAt: created, updatedAt: created, deletedAt: null, deletedBy: null, trashRootId: null, uploaderName: null, ...changes,
  })
  const run = (handler: Awaited<ReturnType<typeof loadHandler>>, id = SUB) =>
    Promise.resolve().then(() => handler(makeEvent({ method: 'POST', params: { id } })))

  it('verifica las fotos y, en un solo lote, deja el envío aprobado por su autor con los archivos listos en la raíz', async () => {
    s3.head.mockResolvedValueOnce({ size: 8386 })
    s3.readRange.mockResolvedValueOnce(JPEG)
    // Cola: envío, archivos subidos, nombres tomados, INSERT (execute), UPDATE del envío, UPDATE de los archivos, actividad, archivos creados.
    const fake = installNitro([[submission()], [uploading()], [], { rows: [{ id: F1 }] }, [{ id: SUB }], [], [], [fileRow()]])
    expect(await run(await loadHandler(COMPLETE))).toEqual({ status: 'approved', accepted: 1, rejected: 0 })

    // Un único lote con las tres sentencias: nunca existe como «pendiente con archivos listos».
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect(fake.db.batch.mock.calls[0]![0]).toHaveLength(3)
    const sets = fake.calls.filter(c => c.method === 'set').map(c => c.args[0]) as Record<string, unknown>[]
    expect(sets).toHaveLength(2)
    expect(sets[0]).toMatchObject({ status: 'approved', reviewedBy: 'u1', targetFolderId: null, reviewedAt: expect.any(Date), completedAt: expect.any(Date) })
    // Aprobación y cierre llevan el mismo instante del reloj del servidor.
    expect(sets[0]!.completedAt).toBe(sets[0]!.reviewedAt)
    expect(sets[1]).toEqual({ uploadStatus: 'ready' })
    // El UPDATE del envío sigue siendo condicional (solo si continúa pendiente).
    const approveWhere = fake.calls.filter(c => c.method === 'where').map(c => sqlText(c.args[0])).find(text => text.includes('"status"'))
    expect(approveWhere).toContain('pending')

    const insert = sqlText(fake.db.execute.mock.calls[0]![0])
    expect(insert).toContain('INSERT INTO files')
    expect(insert).toContain(`gs.status = 'approved'`)
    expect(insert).toContain('peticion.jpg')

    const activity = fake.calls.filter(c => c.method === 'values').map(c => c.args[0]).at(-1)
    expect(activity).toMatchObject({
      action: 'submission.approve', actorId: 'u1', targetId: SUB, targetLabel: 'Ana', meta: { files: 1, folderId: null, manual: true },
    })
  })

  it('descarta la foto que no pasa la verificación (objeto y fila) y aprueba con las demás', async () => {
    s3.head.mockResolvedValueOnce({ size: 8386 }).mockResolvedValueOnce({ size: 8386 })
    s3.readRange.mockResolvedValueOnce(JPEG).mockResolvedValueOnce(FAKE)
    const fake = installNitro([
      [submission()], [uploading(), uploading({ id: F2, storageKey: 'pre/guest/s/y' })], [],
      [], { rows: [{ id: F1 }] }, [{ id: SUB }], [], [], [fileRow()],
    ])
    expect(await run(await loadHandler(COMPLETE))).toEqual({ status: 'approved', accepted: 1, rejected: 1 })
    expect(s3.deleteMany).toHaveBeenCalledWith(['pre/guest/s/y'])
    expect(fake.calls.filter(c => c.method === 'delete')).toHaveLength(1)
    const insert = sqlText(fake.db.execute.mock.calls[0]![0])
    expect(insert).toContain(F1)
    expect(insert).not.toContain(F2)
  })

  it('si ninguna foto es válida borra el envío y responde 422, sin aprobar nada', async () => {
    s3.head.mockResolvedValueOnce(null)
    const fake = installNitro([[submission()], [uploading()], [], []])
    const error = await expectStatus(run(await loadHandler(COMPLETE)), 422)
    expect(error.message).toContain('Ningún archivo')
    expect(fake.calls.filter(c => c.method === 'delete')).toHaveLength(2)
    expect(fake.db.batch).not.toHaveBeenCalled()
    expect(fake.db.execute).not.toHaveBeenCalled()
  })

  it('solo quien creó el alta la cierra: el envío de un invitado o el alta de otra persona responden 404 sin tocar nada', async () => {
    const fake = installNitro([[submission({ senderKey: 'a'.repeat(64) })], [submission({ senderKey: 'manual:u2' })], []])
    const handler = await loadHandler(COMPLETE)
    await expectStatus(run(handler), 404)
    await expectStatus(run(handler), 404)
    await expectStatus(run(handler), 404)
    await expectStatus(run(handler, 'no-es-uuid'), 404)
    expect(s3.head).not.toHaveBeenCalled()
    expect(fake.db.batch).not.toHaveBeenCalled()
    expect(fake.calls.some(c => c.method === 'update' || c.method === 'delete')).toBe(false)
  })

  it('409 si ya se cerró o si otra petición ganó la carrera, y exige rol de equipo', async () => {
    installNitro([[submission({ status: 'approved', completedAt: created })]])
    await expectStatus(run(await loadHandler(COMPLETE)), 409)

    // Dos clics a la vez: los dos pasan la verificación, pero el UPDATE condicional del segundo no afecta filas.
    s3.head.mockResolvedValueOnce({ size: 8386 })
    s3.readRange.mockResolvedValueOnce(JPEG)
    installNitro([[submission()], [uploading()], [], { rows: [] }, [], []])
    const lost = await expectStatus(run(await loadHandler(COMPLETE)), 409)
    expect(lost.message).toContain('ya fue revisado')

    const guarded = installNitro()
    await expectGuarded(await loadHandler(COMPLETE), { method: 'POST', params: { id: SUB } })
    expect(guarded.calls).toEqual([])
  })
})

describe('el alta manual no llega a Solicitudes ni al aviso en vivo', () => {
  it('la cola y el pulso solo miran envíos pendientes: el alta nace aprobada en el mismo lote que marca sus archivos listos', async () => {
    const { readyPendingSubmissionsSql } = await import('../../server/utils/files')
    expect(sqlText(readyPendingSubmissionsSql())).toContain(`s.status = 'pending'`)
    const source = readFileSync(new URL('../../server/utils/submissions.ts', import.meta.url), 'utf8')
    // El cierre (`completed_at`) y los archivos `ready` solo se escriben dentro del lote de aprobación.
    expect(source).toMatch(/manual \? \{ completedAt: reviewedAt \} : \{\}/)
    expect(source).toMatch(/manual\s+\? await db\.batch\(\[\s+approve,\s+insert,\s+db\.update\(guestSubmissionFiles\)\.set\(\{ uploadStatus: 'ready' \}\)/)
  })
})
