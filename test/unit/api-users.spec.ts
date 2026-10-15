// US4 — gestión de usuarios y registro de actividad (solo admin).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authAs, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, profileRow, sqlText } from './helpers/nitro'
import { ADMIN_LOCK_KEY, LAST_ADMIN_MESSAGE, lastAdminGuardSql } from '../../server/utils/users'

afterEach(() => {
  vi.unstubAllGlobals()
})

const admin = () => authAs({ role: 'admin' })
const pending = profileRow({ userId: 'u2', email: 'luis@iglesia.org', name: 'Luis', role: null, status: 'pending' })
const editor = profileRow({ userId: 'u2', email: 'luis@iglesia.org', name: 'Luis', role: 'editor', status: 'active' })

describe('GET /api/users', () => {
  it('lista pendientes primero con total y paginación por offset', async () => {
    const fake = installNitro([[pending, editor], [{ total: 2 }]])
    const handler = await loadHandler('api/users/index.get.ts')
    const page = await handler(makeEvent({ auth: admin(), url: '/api/users?page=2&pageSize=10' }))
    expect(page).toEqual({
      items: [
        expect.objectContaining({ userId: 'u2', status: 'pending', role: null, createdAt: created.toISOString() }),
        expect.objectContaining({ userId: 'u2', status: 'active', role: 'editor' }),
      ],
      total: 2,
    })
    expect(fake.calls.find(c => c.method === 'offset')?.args[0]).toBe(10)
    expect(fake.calls.find(c => c.method === 'limit')?.args[0]).toBe(10)
    expect(sqlText(fake.calls.find(c => c.method === 'orderBy')?.args[0])).toContain('pending')
  })

  it('filtra por estado, valida la query y exige admin', async () => {
    const fake = installNitro([[], [{ total: 0 }]])
    const handler = await loadHandler('api/users/index.get.ts')
    expect(await handler(makeEvent({ auth: admin(), url: '/api/users?status=pending' }))).toEqual({ items: [], total: 0 })
    expect(sqlText(fake.calls.find(c => c.method === 'where')?.args[0])).toContain('pending')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: admin(), url: '/api/users?pageSize=99' }))), 422)
    await expectGuarded(handler, {}, 'admin')
  })
})

describe('PATCH /api/users/:id', () => {
  const patch = (body: unknown, target = pending, updated: unknown[] = [{ ...target, status: 'active', role: 'editor' }]) =>
    installNitro([[target], { rows: [] }, updated, []])

  it('activa a un pendiente con rol, fija approvedBy y registra user.activate', async () => {
    const fake = patch({ status: 'active', role: 'editor' })
    const handler = await loadHandler('api/users/[id].patch.ts')
    const profile = await handler(makeEvent({ auth: admin(), method: 'PATCH', params: { id: 'u2' }, body: { status: 'active', role: 'editor' } }))
    expect(profile).toMatchObject({ userId: 'u2', status: 'active', role: 'editor' })
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect(sqlText(fake.db.execute.mock.calls[0]![0])).toContain(String(ADMIN_LOCK_KEY))
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ status: 'active', role: 'editor', approvedBy: 'u1' })
    const log = fake.calls.find(c => c.method === 'values')?.args[0]
    expect(log).toMatchObject({ action: 'user.activate', actorId: 'u1', targetId: 'u2', targetLabel: 'Luis', meta: { role: 'editor' } })
  })

  it('activar a un pendiente sin rol responde 422', async () => {
    const fake = patch({ status: 'active' })
    const handler = await loadHandler('api/users/[id].patch.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: admin(), method: 'PATCH', params: { id: 'u2' }, body: { status: 'active' } }))), 422)
    expect(error.data).toEqual({ errors: { role: 'Elige un rol para activar la cuenta' } })
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it('desactiva y reactiva (sin volver a pedir rol) registrando la actividad', async () => {
    let fake = patch({ status: 'disabled' }, editor, [{ ...editor, status: 'disabled' }])
    let handler = await loadHandler('api/users/[id].patch.ts')
    expect(await handler(makeEvent({ auth: admin(), method: 'PATCH', params: { id: 'u2' }, body: { status: 'disabled' } }))).toMatchObject({ status: 'disabled' })
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({ action: 'user.disable' })

    fake = patch({ status: 'active' }, { ...editor, status: 'disabled' }, [editor])
    handler = await loadHandler('api/users/[id].patch.ts')
    expect(await handler(makeEvent({ auth: admin(), method: 'PATCH', params: { id: 'u2' }, body: { status: 'active' } }))).toMatchObject({ status: 'active', role: 'editor' })
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({ action: 'user.activate', meta: { role: 'editor' } })
  })

  it('cambia el rol y registra user.role_change con from/to', async () => {
    const fake = patch({ role: 'admin' }, editor, [{ ...editor, role: 'admin' }])
    const handler = await loadHandler('api/users/[id].patch.ts')
    expect(await handler(makeEvent({ auth: admin(), method: 'PATCH', params: { id: 'u2' }, body: { role: 'admin' } }))).toMatchObject({ role: 'admin' })
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({ action: 'user.role_change', meta: { from: 'editor', to: 'admin' } })
  })

  it('el mismo rol no registra nada', async () => {
    const fake = patch({ role: 'editor' }, editor, [editor])
    const handler = await loadHandler('api/users/[id].patch.ts')
    await handler(makeEvent({ auth: admin(), method: 'PATCH', params: { id: 'u2' }, body: { role: 'editor' } }))
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('responde 409 cuando el guard del último admin deja 0 filas', async () => {
    const me = profileRow({ role: 'admin' })
    const fake = installNitro([[me], { rows: [] }, []])
    const handler = await loadHandler('api/users/[id].patch.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: admin(), method: 'PATCH', params: { id: 'u1' }, body: { role: 'editor' } }))), 409)
    expect(error.message).toBe(LAST_ADMIN_MESSAGE)
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('404 si no existe o fue eliminado; 422 sin cambios; exige admin', async () => {
    installNitro([[], [{ ...editor, status: 'removed' }]])
    const handler = await loadHandler('api/users/[id].patch.ts')
    const call = (body: unknown) => Promise.resolve().then(() => handler(makeEvent({ auth: admin(), method: 'PATCH', params: { id: 'u2' }, body })))
    await expectStatus(call({ status: 'disabled' }), 404)
    await expectStatus(call({ status: 'disabled' }), 404)
    await expectStatus(call({}), 422)
    await expectGuarded(handler, { method: 'PATCH', params: { id: 'u2' }, body: { status: 'disabled' } }, 'admin')
  })
})

describe('DELETE /api/users/:id', () => {
  it('anonimiza el perfil, responde 204 y registra user.remove', async () => {
    const fake = installNitro([[editor], { rows: [] }, [{ ...editor, status: 'removed' }], []])
    const handler = await loadHandler('api/users/[id].delete.ts')
    const event = makeEvent({ auth: admin(), method: 'DELETE', params: { id: 'u2' } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ status: 'removed', role: null, name: 'Usuario eliminado' })
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({ action: 'user.remove', targetLabel: 'Luis', meta: { email: 'luis@iglesia.org' } })
  })

  it('409 para el último admin, 404 si no existe y exige admin', async () => {
    installNitro([[profileRow({ role: 'admin' })], { rows: [] }, [], []])
    const handler = await loadHandler('api/users/[id].delete.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: admin(), method: 'DELETE', params: { id: 'u1' } }))), 409)
    expect(error.message).toBe(LAST_ADMIN_MESSAGE)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: admin(), method: 'DELETE', params: { id: 'u9' } }))), 404)
    await expectGuarded(handler, { method: 'DELETE', params: { id: 'u2' } }, 'admin')
  })
})

describe('lastAdminGuardSql', () => {
  it('solo protege cuando el cambio puede quitar un admin activo', () => {
    expect(sqlText(lastAdminGuardSql('u2', { role: 'admin' }))).not.toContain('count')
    expect(sqlText(lastAdminGuardSql('u2', { status: 'active' }))).not.toContain('count')
    for (const next of [{ role: 'editor' as const }, { status: 'disabled' as const }, { status: 'removed' as const, role: null }]) {
      expect(sqlText(lastAdminGuardSql('u2', next))).toContain('count')
    }
  })
})

describe('GET /api/activity', () => {
  const entry = {
    id: 7, actorId: 'u1', actorLabel: 'Ana', action: 'user.activate', targetType: 'user', targetId: 'u2',
    targetLabel: 'Luis', meta: { role: 'editor' }, createdAt: created,
  }

  it('devuelve las entradas más recientes con cursor por id y filtros', async () => {
    const fake = installNitro([[entry]])
    const handler = await loadHandler('api/activity.get.ts')
    const page = await handler(makeEvent({ auth: admin(), url: '/api/activity?actor=u1&action=user.activate&cursor=10' }))
    expect(page).toEqual({ items: [{ ...entry, createdAt: created.toISOString() }], nextCursor: null })
    const where = sqlText(fake.calls.find(c => c.method === 'where')?.args[0])
    expect(where).toContain('u1')
    expect(where).toContain('user.activate')
    expect(where).toContain('10')
    expect(fake.calls.find(c => c.method === 'limit')?.args[0]).toBe(50)
  })

  it('entrega nextCursor cuando la página está llena', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ ...entry, id: 100 - i }))
    installNitro([rows])
    const handler = await loadHandler('api/activity.get.ts')
    expect((await handler(makeEvent({ auth: admin() })) as { nextCursor: string | null }).nextCursor).toBe('51')
  })

  it('rechaza acción desconocida o cursor inválido y exige admin', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/activity.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: admin(), url: '/api/activity?action=x' }))), 422)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: admin(), url: '/api/activity?cursor=abc' }))), 422)
    await expectGuarded(handler, {}, 'admin')
  })
})
