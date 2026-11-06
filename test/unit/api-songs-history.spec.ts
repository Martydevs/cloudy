// T065 — Historial de Canciones (feature 006, contracts/api.md § 5–6): keyset `(last_viewed_at DESC, id DESC)`, límites,
// `exclude`, sin la letra, con quién la abrió; quitar del historial sin tocar las colecciones.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeCursor } from '../../server/utils/pagination'
import { listSongHistory, songHistoryKeyset } from '../../server/utils/songs'
import { created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const historyRow = (n: number, changes: Record<string, unknown> = {}) => ({
  id: n === 0 ? UUID : UUID2, title: `Canción ${n}`, artist: null, sourceUrl: `https://letras.com/a/c${n}`,
  lastViewedAt: new Date(created.getTime() - n * 60_000), viewerId: 'u2', viewerName: 'Luis', viewerStatus: 'active', ...changes,
})

describe('songHistoryKeyset', () => {
  it('orden y condición después del cursor sobre (last_viewed_at, id)', () => {
    const cursor = encodeCursor({ v: created.toISOString(), id: UUID })
    const keyset = songHistoryKeyset(cursor, 2)
    expect(sqlText(keyset.where)).toContain('("songs"."last_viewed_at", "songs"."id") < ($1::timestamptz, $2::uuid)')
    expect(sqlText(keyset.where)).toContain(UUID)
    expect(songHistoryKeyset(undefined, 2).where).toBeUndefined()
  })

  it('siguiente cursor solo con una página llena', () => {
    const { nextCursor } = songHistoryKeyset(undefined, 2)
    expect(nextCursor([{ id: UUID, lastViewedAt: created }])).toBeNull()
    expect(nextCursor([{ id: UUID, lastViewedAt: created }, { id: UUID2, lastViewedAt: created }])).toBe(encodeCursor({ v: created.toISOString(), id: UUID2 }))
    expect(nextCursor([{ id: UUID, lastViewedAt: created }, { id: UUID2, lastViewedAt: null }])).toBeNull()
  })

  it('cursor inválido → 422', () => {
    expect(() => songHistoryKeyset('basura', 2)).toThrow()
  })

  it('la consulta no trae la letra, filtra el historial y excluye la canción actual', async () => {
    const fake = installNitro([[]])
    await listSongHistory({ limit: 24, exclude: UUID })
    const columns = fake.calls.find(c => c.method === 'select')!.args[0] as Record<string, unknown>
    expect(Object.keys(columns)).not.toContain('lyrics')
    const where = sqlText(fake.calls.find(c => c.method === 'where')!.args[0])
    expect(where).toContain('"songs"."last_viewed_at" IS NOT NULL')
    expect(where).toContain(`"songs"."id" <> $1::uuid ["${UUID}"]`.split(' [')[0])
    const order = fake.calls.find(c => c.method === 'orderBy')!.args.map(sqlText).join(' ')
    expect(order).toContain('"songs"."last_viewed_at" desc')
    expect(order).toContain('"songs"."id" desc')
  })
})

describe('GET /api/songs/history', () => {
  it('24 por defecto, con quién la abrió (activo o no) y el siguiente cursor', async () => {
    installNitro([[historyRow(0), historyRow(1, { viewerId: null, viewerName: null, viewerStatus: null })]])
    const handler = await loadHandler('api/songs/history/index.get.ts')
    const event = makeEvent({ url: '/api/songs/history' })
    expect(await handler(event)).toEqual({
      items: [
        { id: UUID, title: 'Canción 0', artist: null, sourceUrl: 'https://letras.com/a/c0', viewedAt: created.toISOString(), viewedBy: { userId: 'u2', name: 'Luis', active: true } },
        { id: UUID2, title: 'Canción 1', artist: null, sourceUrl: 'https://letras.com/a/c1', viewedAt: new Date(created.getTime() - 60_000).toISOString(), viewedBy: null },
      ],
      nextCursor: null,
    })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('con limit 2 y dos filas devuelve el cursor de la última', async () => {
    const fake = installNitro([[historyRow(0), historyRow(1)]])
    const handler = await loadHandler('api/songs/history/index.get.ts')
    const page = await handler(makeEvent({ url: '/api/songs/history?limit=2' })) as { nextCursor: string }
    expect(page.nextCursor).toBe(encodeCursor({ v: new Date(created.getTime() - 60_000).toISOString(), id: UUID2 }))
    expect(fake.calls.find(c => c.method === 'limit')?.args[0]).toBe(2)
  })

  it.each(['limit=0', 'limit=49', 'exclude=no', 'cursor=basura'])('%s → 422', async (query) => {
    installNitro([[]])
    const handler = await loadHandler('api/songs/history/index.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: `/api/songs/history?${query}` }))), 422)
  })

  it('exige sesión de equipo', async () => {
    installNitro([])
    await expectGuarded(await loadHandler('api/songs/history/index.get.ts'), { url: '/api/songs/history' })
  })
})

describe('DELETE /api/songs/history/:id', () => {
  it('pone last_viewed_at y last_viewed_by en NULL (204) sin tocar las colecciones', async () => {
    const fake = installNitro([[{ id: UUID }]])
    const handler = await loadHandler('api/songs/history/[id].delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { id: UUID } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toEqual({ lastViewedAt: null, lastViewedBy: null })
    expect(fake.calls.some(c => c.method === 'delete')).toBe(false)
  })

  it('inexistente → 404; id sin forma → 404 sin consultar; exige sesión', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/songs/history/[id].delete.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'DELETE', params: { id: UUID } }))), 404)
    const before = fake.calls.length
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { id: 'x' } }))), 404)
    expect(fake.calls.length).toBe(before)
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID } })
  })
})
