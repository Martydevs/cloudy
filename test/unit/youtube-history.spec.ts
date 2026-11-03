// T055 — Historial compartido de YouTube (feature 005, FR-023, FR-025, research D11): keyset, límites, quién lo abrió
// en el mismo select y quitar sin tocar las listas.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeCursor } from '../../server/utils/pagination'
import { historyKeyset } from '../../server/utils/youtube-videos'
import { created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const row = (n: number, changes: Record<string, unknown> = {}) => ({
  videoId: `video${String(n).padStart(6, '0')}`,
  title: `Video ${n}`,
  channel: 'Canal',
  durationSeconds: 60,
  thumbnailUrl: null,
  lastViewedAt: new Date(created.getTime() - n * 1000),
  viewerId: 'u1',
  viewerName: 'Ana',
  viewerStatus: 'active',
  ...changes,
})

describe('historyKeyset', () => {
  it('ordena por (last_viewed_at DESC, video_id DESC) y filtra "después del cursor"', () => {
    installNitro()
    const cursor = encodeCursor({ v: created.toISOString(), id: 'video000001' })
    const keyset = historyKeyset(cursor, 24)
    expect(sqlText(keyset.where)).toContain('("youtube_videos"."last_viewed_at", "youtube_videos"."video_id") < (')
    expect(sqlText(keyset.where)).toContain(created.toISOString())
    expect(keyset.orderBy.map(sqlText).join(' ')).toMatch(/"last_viewed_at" desc.*"video_id" desc/)
    expect(historyKeyset(undefined, 24).where).toBeUndefined()
  })

  it('nextCursor solo con una página llena', () => {
    installNitro()
    const { nextCursor } = historyKeyset(undefined, 2)
    expect(nextCursor([row(1)])).toBeNull()
    expect(nextCursor([row(1), row(2)])).toBe(encodeCursor({ v: row(2).lastViewedAt.toISOString(), id: row(2).videoId }))
  })

  it('un cursor inválido da 422', async () => {
    installNitro()
    await expectStatus(Promise.resolve().then(() => historyKeyset('no-es-cursor', 24)), 422)
  })
})

describe('GET /api/youtube/history', () => {
  it('24 por defecto, con viewedBy por LEFT JOIN y solo filas en el historial', async () => {
    const fake = installNitro([[row(1), row(2, { viewerId: null, viewerName: null, viewerStatus: null })]])
    const handler = await loadHandler('api/youtube/history/index.get.ts')
    const event = makeEvent({ url: '/api/youtube/history' })
    const page = await handler(event) as { items: { viewedBy: unknown, viewedAt: string }[], nextCursor: string | null }
    expect(page.nextCursor).toBeNull()
    expect(page.items[0]).toMatchObject({ videoId: 'video000001', viewedAt: row(1).lastViewedAt.toISOString(), viewedBy: { userId: 'u1', name: 'Ana', active: true } })
    expect(page.items[1]!.viewedBy).toBeNull()
    expect(fake.calls.find(c => c.method === 'limit')!.args[0]).toBe(24)
    expect(fake.calls.some(c => c.method === 'leftJoin')).toBe(true)
    expect(sqlText(fake.calls.find(c => c.method === 'where')!.args[0])).toContain('"last_viewed_at" IS NOT NULL')
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('aplica limit, exclude y cursor; página llena → nextCursor', async () => {
    const fake = installNitro([[row(1), row(2)]])
    const handler = await loadHandler('api/youtube/history/index.get.ts')
    const cursor = encodeCursor({ v: created.toISOString(), id: 'video000000' })
    const page = await handler(makeEvent({ url: `/api/youtube/history?limit=2&exclude=okShortVid1&cursor=${cursor}` })) as { nextCursor: string | null }
    expect(page.nextCursor).not.toBeNull()
    expect(fake.calls.find(c => c.method === 'limit')!.args[0]).toBe(2)
    const where = sqlText(fake.calls.find(c => c.method === 'where')!.args[0])
    expect(where).toContain('<>')
    expect(where).toContain('okShortVid1')
  })

  it('422 con limit 0 o 49 y con un cursor inválido; exige sesión', async () => {
    installNitro()
    const handler = await loadHandler('api/youtube/history/index.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/youtube/history?limit=0' }))), 422)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/youtube/history?limit=49' }))), 422)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/youtube/history?cursor=zzz' }))), 422)
    await expectGuarded(handler, { url: '/api/youtube/history' })
  })
})

describe('DELETE /api/youtube/history/:videoId', () => {
  it('pone ambos last_viewed_* en NULL, responde 204 aunque no exista y no toca las listas', async () => {
    const fake = installNitro([[], []])
    const handler = await loadHandler('api/youtube/history/[videoId].delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { videoId: 'okShortVid1' } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.find(c => c.method === 'set')!.args[0]).toEqual({ lastViewedAt: null, lastViewedBy: null })
    expect(await handler(makeEvent({ method: 'DELETE', params: { videoId: 'okShortVid1' } }))).toBeNull()
    expect(fake.calls.some(c => c.method === 'delete')).toBe(false)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { videoId: 'x' } }))), 404)
    await expectGuarded(handler, { method: 'DELETE', params: { videoId: 'okShortVid1' } })
  })
})
