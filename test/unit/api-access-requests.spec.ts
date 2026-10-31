// Feature 003 (US1) — endpoints del equipo: solicitudes abiertas, dar acceso y rechazar.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/access-requests', () => {
  it('devuelve las abiertas vigentes, la más antigua primero, máximo 50', async () => {
    const expiresAt = new Date(created.getTime() + 8 * 60_000)
    const fake = installNitro([[{ id: UUID, senderName: 'Eva', createdAt: created, expiresAt }]])
    const handler = await loadHandler('api/access-requests/index.get.ts')
    expect(await handler(makeEvent())).toEqual([{ id: UUID, senderName: 'Eva', createdAt: created.toISOString(), expiresAt: expiresAt.toISOString() }])
    const where = sqlText(fake.calls.find(c => c.method === 'where')?.args[0])
    expect(where).toContain('"open"')
    expect(where).toContain('> now()')
    expect(fake.calls.find(c => c.method === 'limit')?.args[0]).toBe(50)
  })

  it('exige sesión activa (401 / 403)', async () => {
    installNitro()
    const handler = await loadHandler('api/access-requests/index.get.ts')
    await expectGuarded(handler)
  })
})

describe.each([
  ['approve', 'access.approve'],
  ['reject', 'access.reject'],
] as const)('POST /api/access-requests/:id/%s', (verb, action) => {
  const path = `api/access-requests/[id]/${verb}.post.ts`
  const run = async (queue: unknown[], id = UUID) => {
    const fake = installNitro(queue)
    const handler = await loadHandler(path)
    const event = makeEvent({ method: 'POST', params: { id } })
    return { fake, event, result: Promise.resolve().then(() => handler(event)) }
  }

  it('204 si la decisión ganó, con la actividad en la misma sentencia', async () => {
    const { fake, event, result } = await run([{ rows: [{ id: 1 }] }])
    expect(await result).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    const text = sqlText(fake.db.execute.mock.calls[0]![0])
    expect(text).toContain('INSERT INTO activity_log')
    expect(text).toContain(`"${action}"`)
    expect(text).toContain('"u1"')
  })

  it('409 si otra persona ya la había aprobado, con su nombre', async () => {
    const { result } = await run([{ rows: [] }, [{ status: 'approved', decidedByName: 'Luis' }]])
    const error = await expectStatus(result, 409)
    expect(error.message).toBe('Luis ya dio acceso a esta persona')
    expect(error.data).toEqual({ state: 'approved', decidedBy: { name: 'Luis' } })
  })

  it('409 si ya se había rechazado; "Alguien del equipo" si no queda el perfil', async () => {
    const rejected = await run([{ rows: [] }, [{ status: 'rejected', decidedByName: 'Luis' }]])
    expect((await expectStatus(rejected.result, 409)).message).toBe('Luis ya rechazó esta solicitud')
    const used = await run([{ rows: [] }, [{ status: 'used', decidedByName: null }]])
    const error = await expectStatus(used.result, 409)
    expect(error.message).toBe('Alguien del equipo ya dio acceso a esta persona')
    expect(error.data).toEqual({ state: 'used', decidedBy: null })
  })

  it('410 si caducó antes de atenderla y 404 si ya no existe o el id no es uuid', async () => {
    const expired = await run([{ rows: [] }, [{ status: 'open', decidedByName: null }]])
    expect((await expectStatus(expired.result, 410)).message).toBe('La solicitud caducó antes de atenderla')
    const gone = await run([{ rows: [] }, []])
    expect((await expectStatus(gone.result, 404)).message).toBe('La solicitud ya no existe')
    const bad = await run([], 'x')
    await expectStatus(bad.result, 404)
    expect(bad.fake.db.execute).not.toHaveBeenCalled()
  })

  it('exige sesión activa (401 sin sesión, 403 con cuenta pendiente o desactivada)', async () => {
    installNitro()
    const handler = await loadHandler(path)
    await expectGuarded(handler, { method: 'POST', params: { id: UUID } })
  })
})
