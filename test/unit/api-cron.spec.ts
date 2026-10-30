// Limpieza programada (FR-020, R8): autorización y lotes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID } from './helpers/nitro'

const s3 = vi.hoisted(() => ({ deleteMany: vi.fn(async () => {}) }))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

beforeEach(() => {
  s3.deleteMany.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const authorized = () => makeEvent({ auth: undefined, url: '/api/cron/cleanup', headers: { authorization: 'Bearer cron-secreto' } })

describe('GET /api/cron/cleanup', () => {
  it('responde 401 sin el secreto y no toca la base', async () => {
    const fake = installNitro()
    const handler = await loadHandler('api/cron/cleanup.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: undefined, url: '/api/cron/cleanup' }))), 401)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ auth: undefined, headers: { authorization: 'Bearer otro' } }))), 401)
    expect(fake.calls).toHaveLength(0)
  })

  it('caduca envíos, borra subidas huérfanas (equipo e invitados) y ventanas viejas', async () => {
    // Un lote menor que 500 termina cada vuelta sin otra consulta.
    const fake = installNitro([
      // Papelera vencida: ninguna raíz.
      { rows: [] },
      // Envíos caducados: update, objetos, delete.
      [{ id: 's1' }], [{ id: 'a1', storageKey: 'pre/guest/s1/a', textSourceKey: 'pre/textsrc/a1.jpg' }, { id: 'a2', storageKey: 'pre/guest/s1/c', textSourceKey: null }], [],
      // Subidas del equipo huérfanas: select, delete.
      [{ id: UUID, storageKey: `pre/files/${UUID}` }], [],
      // Archivos de invitados huérfanos: select, delete.
      [{ id: 'g1', storageKey: 'pre/guest/s2/b' }], [],
      // Envíos vacíos sin cerrar.
      [],
      // Ventanas de rate limit.
      [{ key: 'a' }, { key: 'b' }],
      // Solicitudes de acceso terminadas o vencidas hace más de 24 h (feature 003).
      [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
    ])
    const handler = await loadHandler('api/cron/cleanup.get.ts')
    expect(await handler(authorized())).toEqual({ purgedTrash: 0, expiredSubmissions: 1, orphanUploads: 2, rateLimitRows: 2, accessRequests: 3 })
    const purge = sqlText(fake.calls.filter(c => c.method === 'where').at(-1)?.args[0])
    expect(purge).toContain(`now() - interval '24 hours'`)
    expect(purge).toContain('"guest_access_requests"."used_at"')
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toEqual({ status: 'expired' })
    expect(s3.deleteMany.mock.calls.map(c => c[0])).toEqual([
      // La copia JPEG de una HEIC (feature 002): la columna y la clave derivada del id, aunque esté vacía.
      ['pre/guest/s1/a', 'pre/textsrc/a1.jpg', 'pre/textsrc/a1.jpg', 'pre/guest/s1/c', '', 'pre/textsrc/a2.jpg'],
      [`pre/files/${UUID}`, `pre/thumbs/${UUID}.webp`, `pre/textsrc/${UUID}.jpg`],
      ['pre/guest/s2/b', 'pre/textsrc/g1.jpg'],
    ])
    expect(fake.calls.filter(c => c.method === 'delete')).toHaveLength(6)
  })

  it('sin nada que limpiar devuelve ceros', async () => {
    installNitro([{ rows: [] }, [], [], [], [], [], []])
    const handler = await loadHandler('api/cron/cleanup.get.ts')
    expect(await handler(authorized())).toEqual({ purgedTrash: 0, expiredSubmissions: 0, orphanUploads: 0, rateLimitRows: 0, accessRequests: 0 })
    expect(s3.deleteMany).not.toHaveBeenCalled()
  })

  it('purga las raíces con más de 30 días en la papelera, filas y objetos', async () => {
    const fake = installNitro([
      { rows: [{ id: UUID }] },
      { rows: [{ purged: 1, id: UUID, storage_key: `pre/files/${UUID}`, thumb_key: null }] },
      [], [], [], [], [],
    ])
    const handler = await loadHandler('api/cron/cleanup.get.ts')
    expect(await handler(authorized())).toMatchObject({ purgedTrash: 1 })
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    expect(sqlText(fake.db.execute.mock.calls[0]![0])).toContain('deleted_at <')
    expect(sqlText(fake.db.execute.mock.calls[0]![0])).toContain(cutoff)
    expect(s3.deleteMany.mock.calls[0]![0]).toEqual([`pre/files/${UUID}`, '', `pre/thumbs/${UUID}.webp`, ''])
  })
})
