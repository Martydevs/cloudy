import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authAs, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, profileRow } from './helpers/nitro'

const proxy = vi.hoisted(() => ({ handleAuthProxyRequest: vi.fn() }))

vi.mock('@neondatabase/auth/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('@neondatabase/auth/server')>()
  return { ...original, handleAuthProxyRequest: proxy.handleAuthProxyRequest }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/me', () => {
  it('devuelve usuario y perfil, o 401 sin sesión', async () => {
    installNitro()
    const handler = await loadHandler('api/me.get.ts')
    const me = await handler(makeEvent())
    expect(me).toEqual({
      user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
      profile: expect.objectContaining({ userId: 'u1', role: 'editor', status: 'active', createdAt: created.toISOString() }),
    })
    // Una cuenta pendiente también puede leer su perfil (para mostrar /pendiente).
    expect(await handler(makeEvent({ auth: authAs({ status: 'pending', role: null }) }))).toBeTruthy()
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: null }))), 401)
  })
})

describe('PATCH /api/me', () => {
  it('actualiza el nombre de una cuenta activa', async () => {
    const fake = installNitro([[profileRow({ name: 'Ana María' })]])
    const handler = await loadHandler('api/me.patch.ts')
    const profile = await handler(makeEvent({ method: 'PATCH', body: { name: '  Ana María ' } }))
    expect(profile).toMatchObject({ name: 'Ana María' })
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ name: 'Ana María' })
  })

  it('valida el nombre y exige cuenta activa', async () => {
    installNitro()
    const handler = await loadHandler('api/me.patch.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', body: { name: 'x'.repeat(81) } }))), 422)
    expect(error.data).toEqual({ errors: { name: 'Debe tener como máximo 80 caracteres' } })
    await expectGuarded(handler, { method: 'PATCH', body: { name: 'Ana' } })
  })
})

describe('GET /api/dashboard', () => {
  it('resume recientes, pendientes, totales por tipo y espacio', async () => {
    const recent = [{
      id: 'f1', folderId: null, name: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 10,
      storageKey: 'files/f1', thumbKey: null, uploadStatus: 'ready', origin: 'team', uploadedBy: 'u1', guestName: null,
      submissionId: null, createdAt: created, updatedAt: created, deletedAt: null, deletedBy: null, trashRootId: null, uploaderName: 'Ana',
    }]
    // `execute` corre al armar el lote; luego se resuelven los select en orden.
    installNitro([
      { rows: [{ count: 2 }] },
      recent,
      [{ category: 'image', count: 3, bytes: '30' }, { category: 'audio', count: 1, bytes: '5' }],
      [{ activeBytes: '35', trashBytes: '7' }],
    ])
    const handler = await loadHandler('api/dashboard.get.ts')
    const summary = await handler(makeEvent())
    expect(summary).toEqual({
      recentFiles: [expect.objectContaining({ id: 'f1', uploadedBy: { id: 'u1', name: 'Ana' } })],
      pendingCount: 2,
      totalsByCategory: {
        image: { count: 3, bytes: 30 },
        audio: { count: 1, bytes: 5 },
        video: { count: 0, bytes: 0 },
        presentation: { count: 0, bytes: 0 },
        document: { count: 0, bytes: 0 },
      },
      storage: { activeBytes: 35, trashBytes: 7 },
    })
  })

  it('sin datos devuelve ceros y exige rol', async () => {
    installNitro([{ rows: [] }, [], [], []])
    const handler = await loadHandler('api/dashboard.get.ts')
    expect(await handler(makeEvent())).toMatchObject({ pendingCount: 0, storage: { activeBytes: 0, trashBytes: 0 } })
    await expectGuarded(handler)
  })
})

describe('GET /api/realtime/pulse', () => {
  const rows = [
    { id: 's2', sender_name: 'Luis', created_at: '2026-10-14T10:05:00.000Z', file_count: 2 },
    { id: 's1', sender_name: 'Eva', created_at: '2026-10-14T09:00:00.000Z', file_count: 1 },
  ]

  it('cuenta los pendientes y lista los nuevos desde el cursor', async () => {
    installNitro([{ rows }, { rows }])
    const handler = await loadHandler('api/realtime/pulse.get.ts')
    const first = await handler(makeEvent())
    expect(first).toMatchObject({ pendingCount: 2, newSubmissions: [] })
    expect(typeof (first as { cursor: string }).cursor).toBe('string')

    const next = await handler(makeEvent({ url: '/api/realtime/pulse?since=2026-10-14T10:00:00.000Z' }))
    expect(next).toMatchObject({
      pendingCount: 2,
      newSubmissions: [{ id: 's2', senderName: 'Luis', fileCount: 2, createdAt: '2026-10-14T10:05:00.000Z' }],
    })
  })

  it('rechaza un cursor mal formado y exige rol', async () => {
    installNitro()
    const handler = await loadHandler('api/realtime/pulse.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/realtime/pulse?since=ayer' }))), 422)
    await expectGuarded(handler)
  })
})

describe('middleware de sesión', () => {
  it('resuelve sesión y perfil solo para /api/** privadas', async () => {
    const getAuthUser = vi.fn().mockResolvedValueOnce({ id: 'u1', email: 'a@x.org', name: 'A' }).mockResolvedValueOnce(null)
    const ensureProfile = vi.fn().mockResolvedValue(profileRow())
    installNitro([], { getAuthUser, ensureProfile })
    const middleware = await loadHandler('middleware/session.ts')

    const withSession = makeEvent({ auth: undefined, url: '/api/me' })
    await middleware(withSession)
    expect(withSession.context.auth?.profile.userId).toBe('u1')

    const anonymous = makeEvent({ auth: undefined, url: '/api/dashboard' })
    await middleware(anonymous)
    expect(anonymous.context.auth).toBeNull()

    for (const url of ['/api/auth/get-session', '/api/public/submissions', '/api/cron/cleanup', '/archivos']) {
      const skipped = makeEvent({ auth: undefined, url })
      await middleware(skipped)
      expect(skipped.context.auth).toBeUndefined()
    }
    expect(getAuthUser).toHaveBeenCalledTimes(2)
  })
})

describe('proxy /api/auth/**', () => {
  beforeEach(() => {
    proxy.handleAuthProxyRequest.mockReset()
  })

  function upstream() {
    const headers = new Headers({ 'content-type': 'application/json', 'content-encoding': 'gzip', 'x-upstream': '1' })
    headers.append('set-cookie', 'a=1; Path=/; Expires=Wed, 01 Jan 1970 00:00:00 GMT')
    headers.append('set-cookie', 'b=2; Path=/')
    return new Response('{"ok":true}', { status: 200, headers })
  }

  it('reenvía la petición y copia cada Set-Cookie por separado', async () => {
    const hitRateLimit = vi.fn()
    installNitro([], { hitRateLimit })
    proxy.handleAuthProxyRequest.mockResolvedValue(upstream())
    const handler = await loadHandler('routes/api/auth/[...path].ts')
    const event = makeEvent({ auth: undefined, url: '/api/auth/get-session', params: { path: 'get-session' } })
    const body = await handler(event)

    expect(proxy.handleAuthProxyRequest).toHaveBeenCalledWith(expect.objectContaining({ path: 'get-session', baseUrl: 'https://auth.test/neondb/auth' }))
    expect(new TextDecoder().decode(body as Uint8Array)).toBe('{"ok":true}')
    expect(event.node.res.getHeader('set-cookie')).toEqual(['a=1; Path=/; Expires=Wed, 01 Jan 1970 00:00:00 GMT', 'b=2; Path=/'])
    expect(event.node.res.getHeader('x-upstream')).toBe('1')
    // El cuerpo ya viene descomprimido: no se reenvía content-encoding.
    expect(event.node.res.getHeader('content-encoding')).toBeUndefined()
    expect(hitRateLimit).not.toHaveBeenCalled()
  })

  it('aplica el límite de intentos por IP + correo en sign-in y recuperación', async () => {
    const hitRateLimit = vi.fn()
    installNitro([], { hitRateLimit })
    proxy.handleAuthProxyRequest.mockImplementation(async () => new Response(null, { status: 204 }))
    const handler = await loadHandler('routes/api/auth/[...path].ts')

    for (const path of ['sign-in/email', 'request-password-reset']) {
      await handler(makeEvent({ auth: undefined, url: `/api/auth/${path}`, params: { path }, body: { email: ' Ana@Iglesia.org ' } }))
    }
    expect(hitRateLimit).toHaveBeenCalledTimes(2)
    expect(hitRateLimit.mock.calls[0]![1]).toMatch(/^auth:[0-9a-f]{64}:ana@iglesia\.org$/)
    expect(hitRateLimit.mock.calls[0]![2]).toEqual({ limit: 5, windowSec: 900 })

    // Un cuerpo que no es JSON cuenta con correo vacío; el registro no tiene límite propio.
    await handler(makeEvent({ auth: undefined, params: { path: 'sign-in/email' }, body: 'no-json' }))
    expect(hitRateLimit.mock.calls[2]![1]).toMatch(/:$/)
    await handler(makeEvent({ auth: undefined, params: { path: 'sign-up/email' }, body: { email: 'a@x.org' } }))
    expect(hitRateLimit).toHaveBeenCalledTimes(3)
  })

  it('responde 429 sin llamar a Neon Auth cuando se supera el límite', async () => {
    const hitRateLimit = vi.fn().mockRejectedValue(Object.assign(new Error('Too Many Requests'), { statusCode: 429 }))
    installNitro([], { hitRateLimit })
    const handler = await loadHandler('routes/api/auth/[...path].ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: undefined, params: { path: 'sign-in/email' }, body: { email: 'a@x.org' } }))), 429)
    expect(proxy.handleAuthProxyRequest).not.toHaveBeenCalled()
  })
})
