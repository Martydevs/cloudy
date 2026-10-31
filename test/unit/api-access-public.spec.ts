// Feature 003 (US1) — endpoints públicos del invitado: pedir acceso, estado en vivo, envío con permiso y su cierre.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashAccessToken } from '../../server/utils/access-requests'
import { created, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID } from './helpers/nitro'

const s3 = vi.hoisted(() => ({
  presignPut: vi.fn(async (key: string) => `https://s3.test/put/${key}`),
  head: vi.fn(),
  readRange: vi.fn(),
  deleteMany: vi.fn(async () => {}),
}))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

const JPEG = new Uint8Array(readFileSync(new URL('../fixtures/files/foto.jpg', import.meta.url))).subarray(0, 4096)

beforeEach(() => {
  for (const fn of Object.values(s3)) fn.mockClear()
  s3.head.mockReset()
  s3.readRange.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const TOKEN = 'b'.repeat(43)
const DEVICE = 'd'.repeat(43)
const HASH = hashAccessToken(TOKEN)
const OTHER = '22222222-2222-4222-8222-222222222222'
const soon = () => new Date(Date.now() + 5 * 60_000)
const past = () => new Date(Date.now() - 1000)

const request = (changes: Record<string, unknown> = {}) => ({
  id: UUID, senderName: 'Eva', senderKey: 'k', tokenHash: HASH, status: 'open', createdAt: created, expiresAt: soon(),
  decidedBy: null, decidedAt: null, accessExpiresAt: null, submissionId: null, usedAt: null, ...changes,
})
const approved = (changes: Record<string, unknown> = {}) =>
  request({ status: 'approved', decidedBy: 'u1', decidedAt: created, accessExpiresAt: soon(), ...changes })

const withCookie = (cookie: string) => ({ cookie })
const setCookie = (event: ReturnType<typeof makeEvent>) => {
  const header = event.node.res.getHeader('set-cookie')
  return (Array.isArray(header) ? header : header ? [String(header)] : []).join('\n')
}
const rateKeys = (fake: ReturnType<typeof installNitro>) =>
  fake.calls.filter(c => c.method === 'values').map(c => (c.args[0] as { key?: string }).key).filter(Boolean)

describe('POST /api/public/access', () => {
  const call = (handler: (e: ReturnType<typeof makeEvent>) => unknown, event: ReturnType<typeof makeEvent>) =>
    Promise.resolve().then(() => handler(event))

  it('crea la solicitud: 201 waiting, cookie de acceso y de dispositivo, límites por navegador y red', async () => {
    const fake = installNitro([[{ count: 1 }], [{ count: 1 }], [request()]])
    const handler = await loadHandler('api/public/access/index.post.ts')
    const event = makeEvent({ auth: undefined, body: { senderName: ' Eva ' }, headers: { 'x-forwarded-for': '203.0.113.7' } })
    const res = await handler(event) as { state: string, senderName: string, expiresAt: string }
    expect(event.node.res.statusCode).toBe(201)
    expect(res).toMatchObject({ state: 'waiting', senderName: 'Eva' })
    expect(typeof res.expiresAt).toBe('string')
    const cookies = setCookie(event)
    expect(cookies).toMatch(/cloudy-guest-access=[\w-]{43}/)
    expect(cookies).toMatch(/cloudy-guest-device=[\w-]{43}/)
    const [device, net] = rateKeys(fake)
    expect(device).toMatch(/^access:device:[0-9a-f]{64}$/)
    expect(net).toMatch(/^access:net:[0-9a-f]{64}$/)
    expect(`${device}${net}`).not.toContain('203.0.113.7')
  })

  it('422 con nombre vacío o de 81 caracteres, sin tocar la base', async () => {
    const fake = installNitro()
    const handler = await loadHandler('api/public/access/index.post.ts')
    await expectStatus(call(handler, makeEvent({ auth: undefined, body: { senderName: '  ' } })), 422)
    await expectStatus(call(handler, makeEvent({ auth: undefined, body: { senderName: 'a'.repeat(81) } })), 422)
    expect(fake.calls).toHaveLength(0)
  })

  it.each([
    ['waiting', request()],
    ['approved', approved()],
  ])('con una solicitud %s en la cookie devuelve la misma (200) sin contar en el limitador', async (state, row) => {
    const fake = installNitro([[row]])
    const handler = await loadHandler('api/public/access/index.post.ts')
    const event = makeEvent({ auth: undefined, body: { senderName: 'Otro' }, headers: withCookie(`cloudy-guest-access=${TOKEN}`) })
    expect(await handler(event)).toMatchObject({ state, senderName: 'Eva' })
    expect(event.node.res.statusCode).toBe(200)
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
    expect(setCookie(event)).toBe('')
  })

  it('con una solicitud terminada en la cookie crea otra nueva', async () => {
    const fake = installNitro([[request({ status: 'rejected', decidedBy: 'u1', decidedAt: created })], [{ count: 1 }], [{ count: 1 }], [request()]])
    const handler = await loadHandler('api/public/access/index.post.ts')
    const event = makeEvent({ auth: undefined, body: { senderName: 'Eva' }, headers: withCookie(`cloudy-guest-access=${TOKEN}; cloudy-guest-device=${DEVICE}`) })
    expect(await handler(event)).toMatchObject({ state: 'waiting' })
    expect(event.node.res.statusCode).toBe(201)
    expect(rateKeys(fake)[0]).toBe(`access:device:${hashAccessToken(DEVICE)}`)
    // Ya tenía cookie de dispositivo: solo se emite la del acceso nuevo.
    expect(setCookie(event)).not.toContain('cloudy-guest-device')
  })

  it('la 4.ª solicitud del mismo navegador en 30 min → 429 con Retry-After y scope device', async () => {
    installNitro([[{ count: 4 }]])
    const handler = await loadHandler('api/public/access/index.post.ts')
    const event = makeEvent({ auth: undefined, body: { senderName: 'Eva' }, headers: withCookie(`cloudy-guest-device=${DEVICE}`) })
    const error = await expectStatus(call(handler, event), 429)
    expect(error.data).toMatchObject({ scope: 'device', retryAfter: expect.any(Number) })
    expect(Number(event.node.res.getHeader('retry-after'))).toBeGreaterThan(0)
  })

  it('con otros navegadores de la misma red, la 31.ª → 429 con scope network', async () => {
    installNitro([[{ count: 1 }], [{ count: 31 }]])
    const handler = await loadHandler('api/public/access/index.post.ts')
    const error = await expectStatus(call(handler, makeEvent({ auth: undefined, body: { senderName: 'Eva' } })), 429)
    expect(error.data).toMatchObject({ scope: 'network' })
  })

  it('otros errores del limitador pasan sin tocar', async () => {
    installNitro([new Error('neon caído')])
    const handler = await loadHandler('api/public/access/index.post.ts')
    await expect(call(handler, makeEvent({ auth: undefined, body: { senderName: 'Eva' } }))).rejects.toThrow('neon caído')
  })
})

describe('GET /api/public/access/current', () => {
  it('sin cookie → none sin consultar la base, y nunca se guarda en caché', async () => {
    const fake = installNitro()
    const handler = await loadHandler('api/public/access/current.get.ts')
    const event = makeEvent({ auth: undefined })
    expect(await handler(event)).toEqual({ state: 'none', senderName: null, expiresAt: null })
    expect(event.node.res.getHeader('cache-control')).toBe('no-store')
    expect(fake.calls).toHaveLength(0)
  })

  it.each([
    ['waiting', request()],
    ['expired', request({ expiresAt: past() })],
    ['approved', approved()],
    ['accessExpired', approved({ accessExpiresAt: past() })],
    ['rejected', request({ status: 'rejected', decidedBy: 'u1', decidedAt: created })],
    ['used', approved({ status: 'used', usedAt: created })],
  ])('con cookie devuelve el estado derivado: %s', async (state, row) => {
    const fake = installNitro([[row]])
    const handler = await loadHandler('api/public/access/current.get.ts')
    const res = await handler(makeEvent({ auth: undefined, headers: withCookie(`cloudy-guest-access=${TOKEN}`) }))
    expect(res).toMatchObject({ state, senderName: 'Eva' })
    expect(JSON.stringify(res)).not.toContain('u1')
    expect(JSON.stringify(res)).not.toContain('decidedBy')
    expect(sqlText(fake.calls.find(c => c.method === 'where')?.args[0])).toContain(HASH)
  })

  it('una cookie que ya no tiene fila es none', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/public/access/current.get.ts')
    expect(await handler(makeEvent({ auth: undefined, headers: withCookie(`cloudy-guest-access=${TOKEN}`) }))).toEqual({ state: 'none', senderName: null, expiresAt: null })
  })
})

describe('POST /api/public/access/submissions', () => {
  const body = { note: 'Fotos', files: [{ name: 'nota: 1.jpg', size: 8386, mimeType: 'image/jpeg' }] }
  const event = (b: unknown = body, cookie: string | null = `cloudy-guest-access=${TOKEN}`) =>
    makeEvent({ auth: undefined, body: b, headers: cookie ? withCookie(cookie) : {} })

  it('con solicitud aprobada y vigente → 201, envío por permiso y cookie reemitida 3 h', async () => {
    // Cola: limitador por solicitud, INSERT del envío, INSERT de archivos, UPDATE de submission_id.
    const fake = installNitro([[{ count: 1 }], { rows: [{ id: 'x' }] }, { rows: [] }, { rows: [] }])
    const handler = await loadHandler('api/public/access/submissions.post.ts')
    const e = event()
    const res = await handler(e) as { submissionId: string, uploads: { uploadUrl: string }[] }
    expect(e.node.res.statusCode).toBe(201)
    expect(res.uploads).toHaveLength(1)
    expect(rateKeys(fake)).toEqual([`access:submit:${HASH}`])
    const [insert, files, reserve] = fake.db.execute.mock.calls.map(c => sqlText(c[0]))
    expect(insert).toContain(`'permission'::submission_origin, decided_by`)
    expect(files).toContain('nota- 1.jpg')
    expect(reserve).toContain('SET submission_id')
    const cookie = setCookie(e)
    expect(cookie).toContain(`cloudy-guest-access=${TOKEN}`)
    expect(cookie).toContain('Max-Age=10800')
  })

  it('sin cookie → 403 none sin escrituras', async () => {
    const fake = installNitro()
    const handler = await loadHandler('api/public/access/submissions.post.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(event(body, null))), 403)
    expect(error.data).toEqual({ state: 'none' })
    expect(error.message).toBe('Necesitas pedir acceso para enviar archivos')
    expect(fake.calls).toHaveLength(0)
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it.each([
    ['waiting', request(), 'Tu solicitud todavía no está aprobada'],
    ['rejected', request({ status: 'rejected', decidedBy: 'u1', decidedAt: created }), 'Necesitas pedir acceso para enviar archivos'],
    ['used', approved({ status: 'used', usedAt: created }), 'Tu acceso ya se usó. Pide uno nuevo para enviar más archivos'],
    ['expired', request({ expiresAt: past() }), 'Necesitas pedir acceso para enviar archivos'],
    ['accessExpired', approved({ accessExpiresAt: past() }), 'Tu acceso caducó. Pide acceso de nuevo'],
  ])('%s → 403 con el estado y su mensaje, sin firmar nada', async (state, row, message) => {
    installNitro([[{ count: 1 }], { rows: [] }, { rows: [] }, { rows: [] }, [row]])
    const handler = await loadHandler('api/public/access/submissions.post.ts')
    const e = event()
    const error = await expectStatus(Promise.resolve().then(() => handler(e)), 403)
    expect(error.data).toEqual({ state })
    expect(error.message).toBe(message)
    expect(s3.presignPut).not.toHaveBeenCalled()
    expect(setCookie(e)).toBe('')
  })

  it('un cuerpo con senderName → 422 sin escrituras; un archivo no admitido → 415 sin escrituras', async () => {
    const fake = installNitro()
    const handler = await loadHandler('api/public/access/submissions.post.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(event({ ...body, senderName: 'Eva' }))), 422)
    expect(error.data).toEqual({ errors: { senderName: 'Campo no permitido' } })
    await expectStatus(Promise.resolve().then(() => handler(event({ files: [{ name: 'setup.exe', size: 1, mimeType: '' }] }))), 415)
    await expectStatus(Promise.resolve().then(() => handler(event({ files: [] }))), 422)
    expect(fake.calls).toHaveLength(0)
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it('no usa el límite por IP del envío abierto: 6 solicitudes distintas desde la misma IP pasan', async () => {
    const queue: unknown[] = []
    for (let i = 0; i < 6; i++) queue.push([{ count: 1 }], { rows: [{ id: 'x' }] }, { rows: [] }, { rows: [] })
    const fake = installNitro(queue)
    const handler = await loadHandler('api/public/access/submissions.post.ts')
    for (let i = 0; i < 6; i++) {
      const token = String(i).repeat(43)
      const e = makeEvent({ auth: undefined, body, headers: { 'x-forwarded-for': '203.0.113.7', cookie: `cloudy-guest-access=${token}` } })
      await handler(e)
      expect(e.node.res.statusCode).toBe(201)
    }
    expect(rateKeys(fake).every(k => k!.startsWith('access:submit:'))).toBe(true)
  })

  it('la 6.ª creación con la misma solicitud en 30 min → 429 con Retry-After', async () => {
    installNitro([[{ count: 6 }]])
    const handler = await loadHandler('api/public/access/submissions.post.ts')
    const e = event()
    await expectStatus(Promise.resolve().then(() => handler(e)), 429)
    expect(Number(e.node.res.getHeader('retry-after'))).toBeGreaterThan(0)
  })

  it('dos creaciones seguidas con la misma solicitud: la segunda vuelve a reservar submission_id', async () => {
    const fake = installNitro([[{ count: 1 }], { rows: [{ id: 'a' }] }, { rows: [] }, { rows: [] }, [{ count: 2 }], { rows: [{ id: 'b' }] }, { rows: [] }, { rows: [] }])
    const handler = await loadHandler('api/public/access/submissions.post.ts')
    const first = await handler(event()) as { submissionId: string }
    const second = await handler(event()) as { submissionId: string }
    expect(first.submissionId).not.toBe(second.submissionId)
    const reserves = fake.db.execute.mock.calls.map(c => sqlText(c[0])).filter(s => s.includes('SET submission_id'))
    expect(reserves).toHaveLength(2)
    expect(reserves[1]).toContain(second.submissionId)
  })
})

describe('POST /api/public/submissions/:id/complete con permiso', () => {
  const SUB = UUID
  const submission = (changes: Record<string, unknown> = {}) => ({
    id: SUB, senderName: 'Eva', note: null, status: 'pending', senderKey: 'k', createdAt: created, completedAt: null,
    reviewedBy: null, reviewedAt: null, targetFolderId: null, rejectionReason: null, origin: 'permission', accessGrantedBy: 'u1', ...changes,
  })
  const file = { id: 'f1', submissionId: SUB, originalName: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 8386, storageKey: 'pre/guest/s/a', uploadStatus: 'uploading' }
  const complete = async (queue: unknown[], cookie: string | null = `cloudy-guest-access=${TOKEN}`) => {
    const fake = installNitro(queue, { readSubmissionImages: vi.fn(async () => {}) })
    const handler = await loadHandler('api/public/submissions/[id]/complete.post.ts')
    const run = () => Promise.resolve().then(() => handler(makeEvent({ auth: undefined, method: 'POST', params: { id: SUB }, headers: cookie ? withCookie(cookie) : {} })))
    return { fake, run }
  }

  beforeEach(() => {
    s3.head.mockResolvedValue({ size: 8386 })
    s3.readRange.mockResolvedValue(JPEG)
  })

  it('con la cookie correcta consume el acceso (used) y cierra el envío', async () => {
    const { fake, run } = await complete([[{ count: 1 }], [submission()], [file], [{ id: UUID }], [], []])
    expect(await run()).toEqual({ status: 'pending', accepted: 1, rejected: 0 })
    const sets = fake.calls.filter(c => c.method === 'set').map(c => c.args[0])
    expect(sets[0]).toMatchObject({ status: 'used' })
    expect(sets.at(-1)).toMatchObject({ completedAt: expect.any(Date) })
    expect(sqlText(fake.calls.filter(c => c.method === 'where')[2]?.args[0])).toContain(HASH)
    expect(s3.deleteMany).not.toHaveBeenCalled()
  })

  it('si otro envío ya gastó el acceso → 409 y descarta objetos y filas del envío', async () => {
    const { fake, run } = await complete([[{ count: 1 }], [submission()], [file], [], [{ status: 'used', submissionId: OTHER }], [], []])
    const error = await expectStatus(run(), 409)
    expect(error.message).toBe('Tu acceso ya se usó. Pide uno nuevo para enviar más archivos')
    expect(s3.deleteMany).toHaveBeenCalledWith(['pre/guest/s/a', 'pre/textsrc/f1.jpg'])
    expect(fake.calls.filter(c => c.method === 'delete')).toHaveLength(2)
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it('si la reserva pasó a otro envío del mismo acceso → 409 con su propio mensaje y descarta este envío', async () => {
    const { run } = await complete([[{ count: 1 }], [submission()], [file], [], [{ status: 'approved', submissionId: OTHER }], [], []])
    const error = await expectStatus(run(), 409)
    expect(error.message).toBe('Empezaste otro envío con este acceso y este quedó reemplazado. Vuelve a enviar tus archivos')
    expect(s3.deleteMany).toHaveBeenCalled()
  })

  it('un reintento de un envío que ya consumió el acceso (falló el cierre) lo cierra sin borrar nada', async () => {
    const { fake, run } = await complete([[{ count: 1 }], [submission()], [file], [], [{ status: 'used', submissionId: SUB }], [], []])
    expect(await run()).toEqual({ status: 'pending', accepted: 1, rejected: 0 })
    expect(s3.deleteMany).not.toHaveBeenCalled()
    expect(fake.calls.filter(c => c.method === 'delete')).toHaveLength(0)
    expect(fake.db.batch).toHaveBeenCalled()
  })

  it('el tope por red admite a un grupo grande en la misma IP: 30 cierres pasan y el 61 recibe 429', async () => {
    const { run } = await complete([[{ count: 30 }], [submission()], [file], [{ id: UUID }], [], []])
    expect(await run()).toEqual({ status: 'pending', accepted: 1, rejected: 0 })
    const { run: limited } = await complete([[{ count: 61 }]])
    await expectStatus(limited(), 429)
  })

  it('sin la cookie → 409 y descarte, sin consultar la solicitud', async () => {
    const { fake, run } = await complete([[{ count: 1 }], [submission()], [file], [], []], null)
    await expectStatus(run(), 409)
    expect(fake.calls.some(c => c.method === 'update')).toBe(false)
    expect(s3.deleteMany).toHaveBeenCalled()
  })

  it('un complete posterior a access_expires_at también consume: la vigencia solo cuenta al crear', async () => {
    const { fake, run } = await complete([[{ count: 1 }], [submission()], [file], [{ id: UUID }], [], []])
    await run()
    const consume = sqlText(fake.calls.filter(c => c.method === 'where')[2]?.args[0])
    expect(consume).not.toContain('access_expires_at')
    expect(consume).not.toContain('now()')
  })

  it('si ningún archivo llegó bien responde 422 sin gastar el acceso', async () => {
    s3.head.mockResolvedValue(null)
    const { fake, run } = await complete([[{ count: 1 }], [submission()], [file], [], []])
    await expectStatus(run(), 422)
    expect(fake.calls.some(c => c.method === 'update')).toBe(false)
  })

  it('un envío por enlace completa igual que antes, sin tocar solicitudes', async () => {
    const { fake, run } = await complete([[{ count: 1 }], [submission({ origin: 'link', accessGrantedBy: null })], [file], [], []], null)
    expect(await run()).toEqual({ status: 'pending', accepted: 1, rejected: 0 })
    expect(fake.calls.filter(c => c.method === 'set').map(c => c.args[0])).not.toContainEqual(expect.objectContaining({ status: 'used' }))
  })
})
