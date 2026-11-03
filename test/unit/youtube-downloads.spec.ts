// Descargas guardadas de YouTube (sección «Descargas» de /youtube): keyset, listado con quién bajó cada video y el registro
// que hace el navegador al guardar un archivo (una fila por video, solo videos conocidos).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeCursor } from '../../server/utils/pagination'
import { downloadsKeyset } from '../../server/utils/youtube-downloads'
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
  format: 'mp3',
  downloadedAt: new Date(created.getTime() - n * 1000),
  userId: 'u1',
  userName: 'Ana',
  userStatus: 'active',
  ...changes,
})

describe('downloadsKeyset', () => {
  it('ordena por (downloaded_at DESC, video_id DESC) y filtra "después del cursor"', () => {
    installNitro()
    const cursor = encodeCursor({ v: created.toISOString(), id: 'video000001' })
    const keyset = downloadsKeyset(cursor, 24)
    expect(sqlText(keyset.where)).toContain('("youtube_downloads"."downloaded_at", "youtube_downloads"."video_id") < (')
    expect(keyset.orderBy.map(sqlText).join(' ')).toMatch(/"downloaded_at" desc.*"video_id" desc/)
    expect(downloadsKeyset(undefined, 24).where).toBeUndefined()
  })

  it('nextCursor solo con una página llena', () => {
    installNitro()
    const { nextCursor } = downloadsKeyset(undefined, 2)
    expect(nextCursor([row(1)])).toBeNull()
    expect(nextCursor([row(1), row(2)])).toBe(encodeCursor({ v: row(2).downloadedAt.toISOString(), id: row(2).videoId }))
  })
})

describe('GET /api/youtube/downloads', () => {
  it('24 por defecto, con quién la bajó por LEFT JOIN, formato y sin caché', async () => {
    const fake = installNitro([[row(1), row(2, { userId: null, userName: null, userStatus: null })]])
    const handler = await loadHandler('api/youtube/downloads/index.get.ts')
    const event = makeEvent({ url: '/api/youtube/downloads' })
    const page = await handler(event) as { items: { downloadedBy: unknown, downloadedAt: string, format: string }[], nextCursor: string | null }
    expect(page.nextCursor).toBeNull()
    expect(page.items[0]).toMatchObject({
      videoId: 'video000001',
      format: 'mp3',
      downloadedAt: row(1).downloadedAt.toISOString(),
      downloadedBy: { userId: 'u1', name: 'Ana', active: true },
    })
    expect(page.items[1]!.downloadedBy).toBeNull()
    expect(fake.calls.find(c => c.method === 'limit')!.args[0]).toBe(24)
    expect(fake.calls.some(c => c.method === 'leftJoin')).toBe(true)
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('página llena → nextCursor; 422 con limit 0 o cursor inválido; exige sesión de equipo', async () => {
    installNitro([[row(1), row(2)]])
    const handler = await loadHandler('api/youtube/downloads/index.get.ts')
    const page = await handler(makeEvent({ url: '/api/youtube/downloads?limit=2' })) as { nextCursor: string | null }
    expect(page.nextCursor).not.toBeNull()
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/youtube/downloads?limit=0' }))), 422)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/youtube/downloads?cursor=zzz' }))), 422)
    await expectGuarded(handler, { url: '/api/youtube/downloads' })
  })
})

describe('POST /api/youtube/downloads', () => {
  it('guarda una fila por video conocido (upsert por video_id) y devuelve cuántos', async () => {
    const fake = installNitro([[{ videoId: 'okShortVid1' }, { videoId: 'lowResVid01' }], []])
    const handler = await loadHandler('api/youtube/downloads/index.post.ts')
    const result = await handler(makeEvent({ method: 'POST', body: { videoIds: ['okShortVid1', 'lowResVid01'], format: 'mp3' } }))
    expect(result).toEqual({ recorded: 2 })
    const values = fake.calls.find(c => c.method === 'values')!.args[0] as Record<string, unknown>[]
    expect(values).toEqual([
      expect.objectContaining({ videoId: 'okShortVid1', format: 'mp3', downloadedBy: 'u1' }),
      expect.objectContaining({ videoId: 'lowResVid01', format: 'mp3', downloadedBy: 'u1' }),
    ])
    const conflict = fake.calls.find(c => c.method === 'onConflictDoUpdate')!.args[0] as { set: Record<string, unknown> }
    expect(conflict.set).toMatchObject({ format: 'mp3', downloadedBy: 'u1' })
  })

  it('ignora los videos que Cloudy no conoce: sin ninguno no inserta nada', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/youtube/downloads/index.post.ts')
    expect(await handler(makeEvent({ method: 'POST', body: { videoIds: ['okShortVid1'], format: 'mp4_720' } }))).toEqual({ recorded: 0 })
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('422 con formato o videos inválidos y más de 10 videos; exige sesión de equipo', async () => {
    const fake = installNitro()
    const handler = await loadHandler('api/youtube/downloads/index.post.ts')
    const post = (body: unknown) => Promise.resolve().then(() => handler(makeEvent({ method: 'POST', body })))
    await expectStatus(post({ videoIds: ['okShortVid1'], format: 'avi' }), 422)
    await expectStatus(post({ videoIds: [], format: 'mp3' }), 422)
    await expectStatus(post({ videoIds: ['corto'], format: 'mp3' }), 422)
    await expectStatus(post({ videoIds: Array.from({ length: 11 }, (_, i) => `video${String(i).padStart(6, '0')}`), format: 'mp3' }), 422)
    expect(fake.calls).toHaveLength(0)
    await expectGuarded(handler, { method: 'POST', body: { videoIds: ['okShortVid1'], format: 'mp3' } })
  })
})
