// Feature 003 — capa de aplicación de las solicitudes de acceso (`server/utils/access-requests.ts`) y la creación
// de envíos reutilizable (`server/utils/guest-submissions.ts`): token y cookies, decisiones, orden del lote y consumo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeForSubmission,
  createAccessRequest,
  decideAccessRequest,
  ensureDeviceKey,
  hashAccessToken,
  issueAccessToken,
  listOpenAccessRequests,
  openAccessRequestsSql,
  purgeStaleAccessRequests,
  readAccessTokenHash,
  setAccessCookie,
  toGuestAccess,
} from '../../server/utils/access-requests'
import type { AccessRequestRow } from '../../server/utils/access-requests'
import { createGuestSubmission } from '../../server/utils/guest-submissions'
import { installNitro, makeEvent, sqlText, UUID } from './helpers/nitro'

const s3 = vi.hoisted(() => ({
  presignPut: vi.fn(async (key: string) => `https://s3.test/put/${key}`),
}))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

beforeEach(() => {
  s3.presignPut.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const TOKEN = 'a'.repeat(43)
const now = new Date('2026-10-29T12:00:00.000Z')
const minutesFrom = (n: number) => new Date(now.getTime() + n * 60_000)

const request = (changes: Partial<AccessRequestRow> = {}): AccessRequestRow => ({
  id: UUID,
  senderName: 'Eva',
  senderKey: 'k',
  tokenHash: hashAccessToken(TOKEN),
  status: 'open',
  createdAt: now,
  expiresAt: minutesFrom(8),
  decidedBy: null,
  decidedAt: null,
  accessExpiresAt: null,
  submissionId: null,
  usedAt: null,
  ...changes,
})

const setCookies = (event: ReturnType<typeof makeEvent>) => {
  const header = event.node.res.getHeader('set-cookie')
  return (Array.isArray(header) ? header : header ? [String(header)] : []).join('\n')
}

describe('token y cookies', () => {
  it('el token es base64url de 43 caracteres, distinto cada vez, y su hash es SHA-256 hex', () => {
    const a = issueAccessToken()
    const b = issueAccessToken()
    expect(a).toMatch(/^[\w-]{43}$/)
    expect(a).not.toBe(b)
    expect(hashAccessToken(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashAccessToken(a)).toBe(hashAccessToken(a))
  })

  it('setAccessCookie fija cloudy-guest-access httpOnly, lax, path / y 3 h', () => {
    installNitro()
    const event = makeEvent({ auth: undefined })
    setAccessCookie(event, TOKEN)
    const cookie = setCookies(event)
    expect(cookie).toContain(`cloudy-guest-access=${TOKEN}`)
    expect(cookie).toContain('Max-Age=10800')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    // Fuera de `nuxt dev` (aquí `import.meta.dev` no está definido) va con Secure.
    expect(cookie).toContain('Secure')
  })

  it('readAccessTokenHash: null sin cookie o con un valor raro; el hash con la cookie', () => {
    expect(readAccessTokenHash(makeEvent({ auth: undefined }))).toBeNull()
    expect(readAccessTokenHash(makeEvent({ auth: undefined, headers: { cookie: 'cloudy-guest-access=corto' } }))).toBeNull()
    expect(readAccessTokenHash(makeEvent({ auth: undefined, headers: { cookie: `cloudy-guest-access=${TOKEN}` } }))).toBe(hashAccessToken(TOKEN))
  })

  it('ensureDeviceKey crea la cookie de dispositivo (24 h) si falta y reutiliza la existente', () => {
    const fresh = makeEvent({ auth: undefined })
    const key = ensureDeviceKey(fresh)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    const cookie = setCookies(fresh)
    expect(cookie).toMatch(/cloudy-guest-device=[\w-]{43}/)
    expect(cookie).toContain('Max-Age=86400')
    expect(cookie).toContain('HttpOnly')
    const value = /cloudy-guest-device=([\w-]{43})/.exec(cookie)![1]!
    expect(key).toBe(hashAccessToken(value))

    const known = makeEvent({ auth: undefined, headers: { cookie: `cloudy-guest-device=${TOKEN}` } })
    expect(ensureDeviceKey(known)).toBe(hashAccessToken(TOKEN))
    expect(setCookies(known)).toBe('')
  })
})

describe('toGuestAccess', () => {
  it('waiting lleva expires_at; approved, access_expires_at; los demás, null', () => {
    expect(toGuestAccess(null, now)).toEqual({ state: 'none', senderName: null, expiresAt: null })
    expect(toGuestAccess(request(), now)).toEqual({ state: 'waiting', senderName: 'Eva', expiresAt: minutesFrom(8).toISOString() })
    const approved = request({ status: 'approved', decidedBy: 'u1', decidedAt: now, accessExpiresAt: minutesFrom(30) })
    expect(toGuestAccess(approved, now)).toEqual({ state: 'approved', senderName: 'Eva', expiresAt: minutesFrom(30).toISOString() })
    expect(toGuestAccess(approved, minutesFrom(31))).toEqual({ state: 'accessExpired', senderName: 'Eva', expiresAt: null })
    expect(toGuestAccess(request(), minutesFrom(9))).toMatchObject({ state: 'expired', expiresAt: null })
    expect(toGuestAccess(request({ status: 'rejected', decidedBy: 'u1', decidedAt: now }), now)).toMatchObject({ state: 'rejected', expiresAt: null })
  })

  it('nunca incluye quién decidió ni otros datos del equipo', () => {
    const access = toGuestAccess(request({ status: 'approved', decidedBy: 'u1', decidedAt: now, accessExpiresAt: minutesFrom(30) }), now)
    expect(Object.keys(access).sort()).toEqual(['expiresAt', 'senderName', 'state'])
    expect(JSON.stringify(access)).not.toContain('u1')
  })
})

describe('createAccessRequest y listOpenAccessRequests', () => {
  it('inserta con el hash del token y de la IP, vence a los 8 min en SQL y emite la cookie', async () => {
    const fake = installNitro([[request()]])
    const event = makeEvent({ auth: undefined, headers: { 'x-forwarded-for': '203.0.113.7' } })
    expect(await createAccessRequest(event, 'Eva')).toEqual({ state: 'waiting', senderName: 'Eva', expiresAt: minutesFrom(8).toISOString() })
    const values = fake.calls.find(c => c.method === 'values')?.args[0] as Record<string, unknown>
    expect(values.senderName).toBe('Eva')
    expect(values.senderKey).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(values)).not.toContain('203.0.113.7')
    expect(sqlText(values.expiresAt)).toContain(`now() + interval '8 minutes'`)
    // Regresión: `created_at` con el reloj del servidor, el mismo del cursor del pulso (si no, el aviso se pierde
    // cuando el servidor va unos segundos adelantado respecto de Postgres).
    expect(values.createdAt).toBeInstanceOf(Date)
    expect(Math.abs((values.createdAt as Date).getTime() - Date.now())).toBeLessThan(5000)
    const token = /cloudy-guest-access=([\w-]{43})/.exec(setCookies(event))![1]!
    expect(values.tokenHash).toBe(hashAccessToken(token))
  })

  it('lista solo abiertas vigentes, la más antigua primero, máximo 50', async () => {
    const fake = installNitro([[{ id: UUID, senderName: 'Eva', createdAt: now, expiresAt: minutesFrom(8) }]])
    expect(await listOpenAccessRequests()).toEqual([{ id: UUID, senderName: 'Eva', createdAt: now.toISOString(), expiresAt: minutesFrom(8).toISOString() }])
    const where = sqlText(fake.calls.find(c => c.method === 'where')?.args[0])
    expect(where).toContain('"status" = $1')
    expect(where).toContain('"open"')
    expect(where).toContain('> now()')
    expect(sqlText(fake.calls.find(c => c.method === 'orderBy')?.args[0])).toContain('asc')
    expect(fake.calls.find(c => c.method === 'limit')?.args[0]).toBe(50)
  })
})

describe('decideAccessRequest', () => {
  const actor = { userId: 'u1', name: 'Ana' }

  it('aprueba en una sola sentencia: UPDATE condicionado + actividad en un CTE, ventana de 30 min', async () => {
    const fake = installNitro([{ rows: [{ id: 1 }] }])
    expect(await decideAccessRequest(UUID, 'approved', actor)).toEqual({ decided: true })
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
    const text = sqlText(fake.db.execute.mock.calls[0]![0])
    expect(text).toContain('WITH decided AS')
    expect(text).toContain(`WHERE id = $`)
    expect(text).toContain(`AND status = 'open' AND expires_at > now()`)
    expect(text).toContain('decided_at = now()')
    expect(text).toContain(`access_expires_at = now() + interval '30 minutes'`)
    expect(text).toContain('INSERT INTO activity_log')
    expect(text).toContain(`'access_request'`)
    expect(text).toContain('NULL::jsonb')
    expect(text).toContain('"approved"')
    expect(text).toContain('"access.approve"')
    expect(text).toContain('"Ana"')
  })

  it('rechaza sin ventana de acceso', async () => {
    const fake = installNitro([{ rows: [{ id: 1 }] }])
    expect(await decideAccessRequest(UUID, 'rejected', actor)).toEqual({ decided: true })
    const text = sqlText(fake.db.execute.mock.calls[0]![0])
    expect(text).toContain('access_expires_at = NULL')
    expect(text).toContain('"access.reject"')
    expect(text).not.toContain('30 minutes')
  })

  it('si ya estaba decidida devuelve el estado y quién decidió, sin escribir actividad aparte', async () => {
    const fake = installNitro([{ rows: [] }, [{ status: 'approved', decidedByName: 'Luis' }], { rows: [] }, [{ status: 'rejected', decidedByName: null }]])
    expect(await decideAccessRequest(UUID, 'rejected', actor)).toEqual({ conflict: { state: 'approved', decidedBy: { name: 'Luis' } } })
    expect(await decideAccessRequest(UUID, 'approved', actor)).toEqual({ conflict: { state: 'rejected', decidedBy: null } })
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('caducada → expired; inexistente → notFound', async () => {
    installNitro([{ rows: [] }, [{ status: 'open', decidedByName: null }], { rows: [] }, []])
    expect(await decideAccessRequest(UUID, 'approved', actor)).toEqual({ expired: true })
    expect(await decideAccessRequest(UUID, 'approved', actor)).toEqual({ notFound: true })
  })
})

describe('createGuestSubmission con permiso (research B4)', () => {
  const input = { note: 'Fotos', files: [{ name: 'foto.jpg', size: 8386, mimeType: 'image/jpeg' }, { name: 'IMG.heic', size: 3_000_000, mimeType: 'image/heic', withTextSource: true }] }
  const hash = hashAccessToken(TOKEN)

  it('un solo lote en orden: envío condicional → archivos si existe → submission_id al final; luego firma', async () => {
    const fake = installNitro([{ rows: [{ id: 'x' }] }, { rows: [] }, { rows: [] }])
    const event = makeEvent({ auth: undefined, headers: { 'x-forwarded-for': '203.0.113.7' } })
    const res = await createGuestSubmission(event, input, { origin: 'permission', tokenHash: hash })
    if ('denied' in res) throw new Error('no debía negarse')
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    const [insert, filesInsert, reserve] = fake.db.execute.mock.calls.map(c => sqlText(c[0]))
    expect(insert).toContain('INSERT INTO guest_submissions')
    expect(insert).toContain(`'permission'::submission_origin, decided_by`)
    expect(insert).toContain(`token_hash = $`)
    expect(insert).toContain(`status = 'approved' AND access_expires_at > now()`)
    expect(insert).toContain(hash)
    expect(insert).toContain(res.submissionId)
    expect(insert).not.toContain('203.0.113.7')
    expect(filesInsert).toContain('INSERT INTO guest_submission_files')
    expect(filesInsert).toContain('WHERE EXISTS (SELECT 1 FROM guest_submissions WHERE id = $')
    expect(filesInsert).toContain('foto.jpg')
    expect(reserve).toContain('UPDATE guest_access_requests SET submission_id')
    expect(reserve).toContain(`status = 'approved' AND access_expires_at > now()`)
    expect(reserve).toContain('AND EXISTS (SELECT 1 FROM guest_submissions WHERE id = $')
    // Ninguna sentencia anterior a la última escribe submission_id.
    expect(insert).not.toContain('submission_id')
    expect(res.uploads).toHaveLength(2)
    expect(res.uploads[1]!.textSourceUploadUrl).toBe(`https://s3.test/put/pre/textsrc/${res.uploads[1]!.fileId}.jpg`)
    expect(s3.presignPut).toHaveBeenCalledTimes(3)
  })

  // `deniedAccessState` usa el reloj real: las fechas de estas filas se fijan respecto a `Date.now()`.
  it.each([
    ['waiting', request({ expiresAt: new Date(Date.now() + 60_000) })],
    ['rejected', request({ status: 'rejected', decidedBy: 'u1', decidedAt: now })],
    ['used', request({ status: 'used', decidedBy: 'u1', decidedAt: now, accessExpiresAt: minutesFrom(30), usedAt: now })],
    ['expired', request({ expiresAt: new Date(Date.now() - 1000) })],
    ['accessExpired', request({ status: 'approved', decidedBy: 'u1', decidedAt: now, accessExpiresAt: new Date(Date.now() - 1000) })],
    ['none', undefined],
  ] as const)('sin solicitud vigente (%s) no queda nada escrito ni firmado', async (state, row) => {
    installNitro([{ rows: [] }, { rows: [] }, { rows: [] }, row ? [row] : []])
    const res = await createGuestSubmission(makeEvent({ auth: undefined }), input, { origin: 'permission', tokenHash: hash })
    expect(res).toEqual({ denied: state })
    expect(s3.presignPut).not.toHaveBeenCalled()
  })

  it('si Postgres la ve vencida y el reloj del servidor todavía no, se niega como accessExpired', async () => {
    installNitro([{ rows: [] }, { rows: [] }, { rows: [] }, [request({ status: 'approved', decidedBy: 'u1', decidedAt: now, accessExpiresAt: new Date(Date.now() + 60_000) })]])
    expect(await createGuestSubmission(makeEvent({ auth: undefined }), input, { origin: 'permission', tokenHash: hash })).toEqual({ denied: 'accessExpired' })
  })

  it('un archivo no admitido corta antes de cualquier escritura', async () => {
    const fake = installNitro()
    const error = await createGuestSubmission(makeEvent({ auth: undefined }), { files: [{ name: 'setup.exe', size: 1, mimeType: '' }] }, { origin: 'permission', tokenHash: hash })
      .then(() => null, (e: { statusCode: number }) => e)
    expect(error?.statusCode).toBe(415)
    expect(fake.db.batch).not.toHaveBeenCalled()
    expect(fake.db.execute).not.toHaveBeenCalled()
  })
})

describe('consumeForSubmission', () => {
  const OTHER = '22222222-2222-4222-8222-222222222222'

  it('pasa a used solo desde approved con ese envío y ese token', async () => {
    const fake = installNitro([[{ id: UUID }]])
    const hash = hashAccessToken(TOKEN)
    expect(await consumeForSubmission(UUID, hash)).toBe('consumed')
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ status: 'used' })
    const where = sqlText(fake.calls.find(c => c.method === 'where')?.args[0])
    expect(where).toContain('"submission_id"')
    expect(where).toContain('"token_hash"')
    expect(where).toContain('"approved"')
    expect(where).toContain(hash)
  })

  it('es idempotente: si ya lo consumió este mismo envío devuelve already', async () => {
    installNitro([[], [{ status: 'used', submissionId: UUID }]])
    expect(await consumeForSubmission(UUID, hashAccessToken(TOKEN))).toBe('already')
  })

  it('distingue por qué no se pudo: lo gastó otro envío, la reserva pasó a otro o no hay solicitud', async () => {
    const hash = hashAccessToken(TOKEN)
    installNitro([[], [{ status: 'used', submissionId: OTHER }]])
    expect(await consumeForSubmission(UUID, hash)).toBe('used')
    installNitro([[], [{ status: 'approved', submissionId: OTHER }]])
    expect(await consumeForSubmission(UUID, hash)).toBe('replaced')
    installNitro([[], []])
    expect(await consumeForSubmission(UUID, hash)).toBe('lost')
    installNitro([[], [{ status: 'rejected', submissionId: null }]])
    expect(await consumeForSubmission(UUID, hash)).toBe('lost')
  })

  it('sin cookie no toca la base', async () => {
    const fake = installNitro()
    expect(await consumeForSubmission(UUID, null)).toBe('lost')
    expect(fake.calls).toHaveLength(0)
  })
})

describe('consultas del pulso y la limpieza', () => {
  it('openAccessRequestsSql filtra abiertas vigentes y, con since, las creadas después', () => {
    expect(sqlText(openAccessRequestsSql())).toContain(`status = 'open' AND expires_at > now()`)
    expect(sqlText(openAccessRequestsSql())).not.toContain('created_at >')
    const since = sqlText(openAccessRequestsSql(now))
    expect(since).toContain('AND created_at > $1::timestamptz')
    expect(since).toContain(now.toISOString())
  })

  it('purgeStaleAccessRequests borra terminadas o vencidas hace más de 24 h y devuelve cuántas', async () => {
    const fake = installNitro([[{ id: 'a' }, { id: 'b' }]])
    expect(await purgeStaleAccessRequests()).toBe(2)
    const where = sqlText(fake.calls.find(c => c.method === 'where')?.args[0])
    expect(where).toContain(`now() - interval '24 hours'`)
    for (const piece of [`= 'rejected' AND "guest_access_requests"."decided_at" <`, `= 'used' AND "guest_access_requests"."used_at" <`, `= 'open' AND "guest_access_requests"."expires_at" <`, `= 'approved' AND "guest_access_requests"."access_expires_at" <`]) {
      expect(where).toContain(piece)
    }
  })
})
