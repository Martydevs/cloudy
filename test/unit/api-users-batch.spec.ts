// Selección múltiple de Usuarios: `POST /api/users/batch` desactiva, elimina o cambia el rol de varias cuentas en una
// sola transacción, con el guard del último administrador por cuenta y actividad solo para las que cambiaron.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authAs, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, profileRow, sqlText } from './helpers/nitro'
import { ADMIN_LOCK_KEY } from '../../server/utils/users'
import { USER_BATCH_MAX } from '../../shared/validation/users'

afterEach(() => {
  vi.unstubAllGlobals()
})

type Result = { updated: string[], skipped: { id: string, reason: string }[] }
type Fake = ReturnType<typeof installNitro>

const admin = () => authAs({ role: 'admin' })
const account = (userId: string, changes: Record<string, unknown> = {}) =>
  profileRow({ userId, email: `${userId}@iglesia.org`, name: `Persona ${userId}`, role: 'editor', status: 'active', ...changes })
const LOCK = { rows: [] }

const handler = () => loadHandler<Result>('api/users/batch.post.ts')
const post = (body: unknown, auth = admin()) => makeEvent({ method: 'POST', body, auth })

const sets = (fake: Fake) => fake.calls.filter(c => c.method === 'set').map(c => c.args[0])
const activity = (fake: Fake) => fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
/** Los `WHERE` de los `UPDATE` (el primero de todos es el de la consulta de la selección). */
const updateWheres = (fake: Fake) => fake.calls.filter(c => c.method === 'where').slice(1).map(c => sqlText(c.args[0]))
const batchSizes = (fake: Fake) => fake.db.batch.mock.calls.map(call => (call[0] as unknown[]).length)

describe('POST /api/users/batch', () => {
  it('desactiva varias cuentas activas en una transacción (lock + un UPDATE por cuenta) y registra cada una', async () => {
    const [a, b] = [account('u2'), account('u3')]
    const fake = installNitro([[a, b], LOCK, [{ ...a, status: 'disabled' }], [{ ...b, status: 'disabled' }]])
    const run = await handler()
    expect(await run(post({ ids: ['u2', 'u3'], action: 'disable' }))).toEqual({ updated: ['u2', 'u3'], skipped: [] })

    // Una consulta para la selección, un lote con el lock y los dos cambios, y otro con la actividad.
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(1)
    expect(batchSizes(fake)).toEqual([3, 2])
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
    expect(sqlText(fake.db.execute.mock.calls[0]![0])).toContain(String(ADMIN_LOCK_KEY))
    expect(sets(fake)).toEqual([
      expect.objectContaining({ status: 'disabled', updatedAt: expect.any(Date) }),
      expect.objectContaining({ status: 'disabled', updatedAt: expect.any(Date) }),
    ])
    // Cada UPDATE lleva el guard del último administrador de su cuenta, en el orden pedido.
    const wheres = updateWheres(fake)
    expect(wheres).toHaveLength(2)
    expect(wheres[0]).toContain('u2')
    expect(wheres[1]).toContain('u3')
    for (const where of wheres) expect(where).toContain('count(*)')
    expect(activity(fake)).toEqual([
      expect.objectContaining({ action: 'user.disable', actorId: 'u1', targetType: 'user', targetId: 'u2', targetLabel: 'Persona u2' }),
      expect.objectContaining({ action: 'user.disable', actorId: 'u1', targetType: 'user', targetId: 'u3', targetLabel: 'Persona u3' }),
    ])
  })

  it('cambia el rol de las cuentas activas que tienen otro; la que ya lo tiene o no está activa no cambia', async () => {
    const rows = [account('u2'), account('u3', { role: 'admin' }), account('u4', { role: null, status: 'pending' }), account('u5', { status: 'disabled' })]
    const fake = installNitro([rows, LOCK, [{ ...rows[0], role: 'admin' }]])
    const run = await handler()
    expect(await run(post({ ids: ['u2', 'u3', 'u4', 'u5'], action: 'role', role: 'admin' }))).toEqual({
      updated: ['u2'],
      skipped: [{ id: 'u3', reason: 'unchanged' }, { id: 'u4', reason: 'unchanged' }, { id: 'u5', reason: 'unchanged' }],
    })
    expect(batchSizes(fake)).toEqual([2, 1])
    expect(sets(fake)).toEqual([expect.objectContaining({ role: 'admin' })])
    // Subir a administrador nunca deja al sistema sin administradores: el guard no cuenta nada.
    expect(updateWheres(fake)[0]).not.toContain('count(*)')
    expect(activity(fake)).toEqual([expect.objectContaining({ action: 'user.role_change', targetId: 'u2', meta: { from: 'editor', to: 'admin' } })])
  })

  it('elimina cuentas en cualquier estado: quedan anonimizadas y se registra su correo', async () => {
    const rows = [account('u2'), account('u3', { role: null, status: 'pending' }), account('u4', { status: 'disabled' })]
    const fake = installNitro([rows, LOCK, [{ ...rows[0], status: 'removed' }], [{ ...rows[1], status: 'removed' }], [{ ...rows[2], status: 'removed' }]])
    const run = await handler()
    expect(await run(post({ ids: ['u2', 'u3', 'u4'], action: 'remove' }))).toEqual({ updated: ['u2', 'u3', 'u4'], skipped: [] })
    for (const set of sets(fake)) expect(set).toMatchObject({ status: 'removed', role: null, name: 'Usuario eliminado' })
    expect(activity(fake).map(log => (log as { action: string, targetLabel: string, meta: unknown }))).toEqual([
      expect.objectContaining({ action: 'user.remove', targetLabel: 'Persona u2', meta: { email: 'u2@iglesia.org' } }),
      expect.objectContaining({ action: 'user.remove', targetLabel: 'Persona u3', meta: { email: 'u3@iglesia.org' } }),
      expect.objectContaining({ action: 'user.remove', targetLabel: 'Persona u4', meta: { email: 'u4@iglesia.org' } }),
    ])
  })

  it('la cuenta que frena el guard del último administrador se salta, no falla el lote, y no se registra', async () => {
    // Los dos únicos administradores van en la selección: el primero se desactiva y el segundo ya sería el último.
    const [first, last, editor] = [account('u2', { role: 'admin' }), account('u3', { role: 'admin' }), account('u4')]
    const fake = installNitro([[first, last, editor], LOCK, [{ ...first, status: 'disabled' }], [], [{ ...editor, status: 'disabled' }]])
    const run = await handler()
    expect(await run(post({ ids: ['u2', 'u3', 'u4'], action: 'disable' }))).toEqual({
      updated: ['u2', 'u4'],
      skipped: [{ id: 'u3', reason: 'last_admin' }],
    })
    // Los tres cambios van en el mismo lote, en orden: el guard de cada uno ve lo que hicieron los anteriores.
    expect(batchSizes(fake)).toEqual([4, 2])
    expect(updateWheres(fake).map(where => ['u2', 'u3', 'u4'].find(id => where.includes(`"${id}"`)))).toEqual(['u2', 'u3', 'u4'])
    expect(activity(fake).map(log => (log as { targetId: string }).targetId)).toEqual(['u2', 'u4'])
  })

  it('incluirse a uno mismo vale como cualquier otra cuenta: cambia si queda otro administrador', async () => {
    const [me, other] = [account('u1', { role: 'admin', name: 'Ana' }), account('u2', { role: 'admin' })]
    const fake = installNitro([[me, other], LOCK, [{ ...me, role: 'editor' }], []])
    const run = await handler()
    expect(await run(post({ ids: ['u1', 'u2'], action: 'role', role: 'editor' }))).toEqual({
      updated: ['u1'],
      skipped: [{ id: 'u2', reason: 'last_admin' }],
    })
    expect(activity(fake)).toEqual([expect.objectContaining({ action: 'user.role_change', actorId: 'u1', targetId: 'u1', meta: { from: 'admin', to: 'editor' } })])
  })

  it('las cuentas que ya no existen o fueron eliminadas se informan como not_found; sin nada que cambiar no abre transacción', async () => {
    const fake = installNitro([[account('u2', { status: 'removed', role: null })]])
    const run = await handler()
    expect(await run(post({ ids: ['u2', 'u9'], action: 'disable' }))).toEqual({
      updated: [],
      skipped: [{ id: 'u2', reason: 'not_found' }, { id: 'u9', reason: 'not_found' }],
    })
    expect(fake.db.batch).not.toHaveBeenCalled()
    expect(fake.db.execute).not.toHaveBeenCalled()
    expect(activity(fake)).toEqual([])
  })

  it('si una cuenta que no es administradora no cambia (la tocó otra persona a la vez), se informa como not_found', async () => {
    const fake = installNitro([[account('u2')], LOCK, []])
    const run = await handler()
    expect(await run(post({ ids: ['u2'], action: 'remove' }))).toEqual({ updated: [], skipped: [{ id: 'u2', reason: 'not_found' }] })
    // Sin cambios no hay nada que registrar: solo corrió el lote del lock y el UPDATE.
    expect(batchSizes(fake)).toEqual([2])
    expect(activity(fake)).toEqual([])
  })

  it('los ids repetidos cuentan una vez', async () => {
    const fake = installNitro([[account('u2')], LOCK, [account('u2', { status: 'disabled' })]])
    const run = await handler()
    expect(await run(post({ ids: ['u2', 'u2'], action: 'disable' }))).toEqual({ updated: ['u2'], skipped: [] })
    expect(sets(fake)).toHaveLength(1)
  })

  it.each([
    ['sin cuentas', { ids: [], action: 'disable' }],
    ['sin lista', { action: 'disable' }],
    [`más de ${USER_BATCH_MAX} cuentas`, { ids: Array.from({ length: USER_BATCH_MAX + 1 }, (_, i) => `u${i}`), action: 'disable' }],
    ['un id que no es texto', { ids: ['u2', 7], action: 'disable' }],
    ['una acción desconocida', { ids: ['u2'], action: 'activate' }],
    ['sin acción', { ids: ['u2'] }],
    ['cambiar rol sin rol', { ids: ['u2'], action: 'role' }],
    ['un rol que no existe', { ids: ['u2'], action: 'role', role: 'owner' }],
  ])('422 con %s, sin tocar la base', async (_, body) => {
    const fake = installNitro()
    const run = await handler()
    await expectStatus(Promise.resolve().then(() => run(post(body))), 422)
    expect(fake.calls).toEqual([])
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it(`acepta ${USER_BATCH_MAX} cuentas (una página completa)`, async () => {
    const ids = Array.from({ length: USER_BATCH_MAX }, (_, i) => `u${i + 2}`)
    installNitro([ids.map(id => account(id)), LOCK, ...ids.map(id => [account(id, { status: 'disabled' })])])
    const run = await handler()
    expect((await run(post({ ids, action: 'disable' }))).updated).toEqual(ids)
  })

  it('solo administradores: sin sesión 401; cuenta pendiente, desactivada o editor 403', async () => {
    const fake = installNitro()
    const run = await handler()
    await expectGuarded(run, { method: 'POST', body: { ids: ['u2'], action: 'disable' } }, 'admin')
    expect(fake.calls).toEqual([])
  })
})
