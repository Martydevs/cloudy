import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext, ProfileRow } from '../../server/utils/session'
import { ensureProfile, getAuthUser, requireActive, requireRole, requireSession, toProfile } from '../../server/utils/session'
import { paramId, queryValid, readValid, unwrap } from '../../server/utils/validation'
import { activityInsert } from '../../server/utils/activity'
import { hitRateLimit } from '../../server/utils/rate-limit'
import { proxyConfig, useAuthServer } from '../../server/utils/auth'
import { object, str } from '../../shared/validation/core'
import { fakeDb } from './helpers/fake-db'

const created = new Date('2026-10-14T10:00:00.000Z')
const profile = (changes: Partial<ProfileRow> = {}): ProfileRow => ({
  userId: 'u1',
  email: 'ana@iglesia.org',
  name: 'Ana',
  role: 'editor',
  status: 'active',
  createdAt: created,
  updatedAt: created,
  approvedBy: null,
  ...changes,
})

function event({ auth, url = '/api/x', body, params }: { auth?: AuthContext | null, url?: string, body?: string, params?: Record<string, string> } = {}): H3Event {
  const req = new IncomingMessage(new Socket())
  req.method = body ? 'POST' : 'GET'
  req.url = url
  req.headers = { host: 'cloudy.test', ...(body ? { 'content-type': 'application/json' } : {}) }
  // h3 lee `req.body` cuando ya viene resuelto (como en algunos runtimes).
  if (body) Object.assign(req, { body })
  const e = createEvent(req, new ServerResponse(req))
  e.context.auth = auth
  if (params) e.context.params = params
  return e
}

const auth = (changes: Partial<ProfileRow> = {}): AuthContext => ({
  user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
  profile: profile(changes),
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guards de sesión', () => {
  it('requireSession responde 401 sin sesión', () => {
    expect(() => requireSession(event())).toThrow(expect.objectContaining({ statusCode: 401 }))
    expect(requireSession(event({ auth: auth() })).user.id).toBe('u1')
  })

  it.each(['pending', 'disabled', 'removed'] as const)('requireActive responde 403 con reason=%s', (status) => {
    try {
      requireActive(event({ auth: auth({ status, role: status === 'pending' ? null : 'editor' }) }))
      expect.unreachable()
    }
    catch (error) {
      expect(error).toMatchObject({ statusCode: 403, data: { reason: status } })
    }
  })

  it('una cuenta activa sin rol cuenta como pendiente', () => {
    expect(() => requireActive(event({ auth: auth({ role: null }) }))).toThrow(expect.objectContaining({ data: { reason: 'pending' } }))
  })

  it('requireRole', () => {
    expect(requireRole(event({ auth: auth() }), 'editor').profile.role).toBe('editor')
    expect(requireRole(event({ auth: auth({ role: 'admin' }) }), 'editor').profile.role).toBe('admin')
    expect(() => requireRole(event({ auth: auth() }), 'admin')).toThrow(expect.objectContaining({ statusCode: 403 }))
    expect(requireRole(event({ auth: auth({ role: 'admin' }) }), 'admin').profile.role).toBe('admin')
  })

  it('toProfile serializa las fechas', () => {
    expect(toProfile(profile())).toEqual({
      userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: created.toISOString(),
    })
  })
})

describe('getAuthUser y ensureProfile', () => {
  it('getAuthUser normaliza el usuario o devuelve null', async () => {
    const getSession = vi.fn()
      .mockResolvedValueOnce({ data: { user: { id: 'u1', email: 'ANA@Iglesia.org', name: '' } }, error: null })
      .mockResolvedValueOnce({ data: null, error: { status: 401 } })
    vi.stubGlobal('useAuthServer', () => ({ getSession }))
    expect(await getAuthUser(event())).toEqual({ id: 'u1', email: 'ana@iglesia.org', name: 'ANA@Iglesia.org' })
    expect(await getAuthUser(event())).toBeNull()
  })

  it('ensureProfile devuelve el perfil existente sin escribir', async () => {
    const fake = fakeDb([[profile()]])
    vi.stubGlobal('useDb', () => fake.db)
    expect((await ensureProfile({ id: 'u1', email: 'ana@iglesia.org', name: 'Ana' })).userId).toBe('u1')
    expect(fake.db.execute).not.toHaveBeenCalled()
  })

  it('ensureProfile crea el perfil con una sola sentencia y lo relee', async () => {
    const fake = fakeDb([[], { rows: [{ user_id: 'u2' }] }, [profile({ userId: 'u2', status: 'pending', role: null })]])
    vi.stubGlobal('useDb', () => fake.db)
    const created = await ensureProfile({ id: 'u2', email: 'b@x.org', name: ' '.repeat(3) })
    expect(created.status).toBe('pending')
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
  })

  it('ensureProfile falla con 500 si no puede releer', async () => {
    const fake = fakeDb([[], { rows: [] }, []])
    vi.stubGlobal('useDb', () => fake.db)
    await expect(ensureProfile({ id: 'u3', email: 'c@x.org', name: 'C' })).rejects.toMatchObject({ statusCode: 500 })
  })
})

describe('validación de peticiones', () => {
  const validator = object({ name: str({ max: 5 }) })

  it('unwrap responde 422 con los errores', () => {
    expect(unwrap({ ok: true, data: 1 })).toBe(1)
    expect(() => unwrap({ ok: false, errors: { name: 'x' } })).toThrow(expect.objectContaining({ statusCode: 422, data: { errors: { name: 'x' } } }))
  })

  it('readValid y queryValid', async () => {
    expect(await readValid(event({ body: '{"name":"Ana"}' }), validator)).toEqual({ name: 'Ana' })
    await expect(readValid(event({ body: '{"name":"Anabella"}' }), validator)).rejects.toMatchObject({ statusCode: 422 })
    await expect(readValid(event({ body: '{no json' }), validator)).rejects.toMatchObject({ statusCode: 400 })
    expect(queryValid(event({ url: '/api/x?name=Luis' }), validator)).toEqual({ name: 'Luis' })
  })

  it('paramId exige un uuid', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    expect(paramId(event({ params: { id } }))).toBe(id)
    expect(() => paramId(event({ params: { id: 'root' } }))).toThrow(expect.objectContaining({ statusCode: 404 }))
  })
})

describe('actividad y límite de intentos', () => {
  it('activityInsert prepara la inserción con el actor o "Sistema"', () => {
    const fake = fakeDb()
    vi.stubGlobal('useDb', () => fake.db)
    activityInsert({ userId: 'u1', name: 'Ana' }, 'file.upload', { type: 'file', id: 'f1', label: 'foto.jpg' })
    activityInsert(null, 'trash.empty', { type: 'trash', id: null, label: 'Papelera' }, { purged: 2 })
    const values = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(values).toEqual([
      expect.objectContaining({ actorId: 'u1', actorLabel: 'Ana', action: 'file.upload', meta: null }),
      expect.objectContaining({ actorId: null, actorLabel: 'Sistema', meta: { purged: 2 } }),
    ])
  })

  it('hitRateLimit deja pasar hasta el límite y luego responde 429 con Retry-After', async () => {
    const fake = fakeDb([[{ count: 5 }], [{ count: 6 }]])
    vi.stubGlobal('useDb', () => fake.db)
    await expect(hitRateLimit(null, 'k', { limit: 5, windowSec: 900 })).resolves.toBeUndefined()
    const e = event()
    await expect(hitRateLimit(e, 'k', { limit: 5, windowSec: 900 })).rejects.toMatchObject({ statusCode: 429 })
    expect(Number(e.node.res.getHeader('retry-after'))).toBeGreaterThan(0)
  })
})

describe('configuración de Neon Auth', () => {
  it('proxyConfig y useAuthServer leen runtimeConfig y validan el secreto', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ neonAuthBaseUrl: 'https://auth.test/neondb/auth', neonAuthCookieSecret: 'x'.repeat(32) }))
    expect(proxyConfig()).toMatchObject({ baseUrl: 'https://auth.test/neondb/auth', sameSite: 'lax' })
    const server = useAuthServer()
    expect(typeof server.getSession).toBe('function')
    expect(useAuthServer()).toBe(server)
  })
})
