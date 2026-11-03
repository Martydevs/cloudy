// T019 — Videos conocidos y registro en el historial (feature 005, data-model.md, research D10).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanVideo, findStoredVideo, jobIdParam, toYoutubePerson, toYoutubeVideo, upsertVideoView, videoIdParam } from '../../server/utils/youtube-videos'
import { created, expectStatus, installNitro, makeEvent, profileRow } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const video = (changes: Record<string, unknown> = {}) => ({
  videoId: 'okShortVid1',
  title: 'Alabanza',
  channel: 'Iglesia',
  durationSeconds: 185,
  thumbnailUrl: 'https://i.ytimg.com/vi/okShortVid1/hq.jpg',
  ...changes,
})

describe('upsertVideoView', () => {
  it('INSERT … ON CONFLICT (video_id) DO UPDATE que refresca los datos y fija quién y cuándo', async () => {
    vi.useFakeTimers({ now: created, toFake: ['Date'] })
    const fake = installNitro([[]])
    await fake.db.batch([upsertVideoView(video(), profileRow({ userId: 'u7' }))])
    expect(fake.calls.map(c => c.method)).toEqual(['insert', 'values', 'onConflictDoUpdate'])
    const values = fake.calls[1]!.args[0] as Record<string, unknown>
    expect(values).toEqual({ ...video(), lastViewedAt: created, lastViewedBy: 'u7' })
    const conflict = fake.calls[2]!.args[0] as { target: { name: string }, set: Record<string, unknown> }
    expect(conflict.target.name).toBe('video_id')
    expect(conflict.set).toMatchObject({ title: 'Alabanza', channel: 'Iglesia', durationSeconds: 185, thumbnailUrl: video().thumbnailUrl, lastViewedAt: created, lastViewedBy: 'u7' })
    expect(conflict.set.updatedAt).toBeDefined()
  })

  it('recorta el título a 300 y el canal a 200, y descarta una miniatura que no es https', () => {
    const fake = installNitro()
    upsertVideoView(video({ title: `  ${'t'.repeat(320)}  `, channel: 'c'.repeat(250), thumbnailUrl: 'http://x/y.jpg' }), profileRow())
    const values = fake.calls[1]!.args[0] as { title: string, channel: string, thumbnailUrl: string | null }
    expect(values.title).toHaveLength(300)
    expect(values.channel).toHaveLength(200)
    expect(values.thumbnailUrl).toBeNull()
  })
})

describe('cleanVideo', () => {
  it('título vacío → el ID; canal vacío → null; duración negativa o no finita → null', () => {
    expect(cleanVideo(video({ title: '   ', channel: '  ', durationSeconds: -3 }))).toMatchObject({ title: 'okShortVid1', channel: null, durationSeconds: null })
    expect(cleanVideo(video({ durationSeconds: Number.NaN, thumbnailUrl: null }))).toMatchObject({ durationSeconds: null, thumbnailUrl: null })
    expect(cleanVideo(video({ durationSeconds: 12.6, channel: null }))).toMatchObject({ durationSeconds: 13, channel: null })
  })
})

describe('mapeo y lectura', () => {
  it('toYoutubeVideo y toYoutubePerson', () => {
    expect(toYoutubeVideo({ ...video(), lastViewedAt: null } as never)).toEqual(video())
    expect(toYoutubePerson(profileRow())).toEqual({ userId: 'u1', name: 'Ana', active: true })
    expect(toYoutubePerson(profileRow({ status: 'removed' }))).toEqual({ userId: 'u1', name: 'Ana', active: false })
  })

  it('findStoredVideo devuelve la fila o null', async () => {
    installNitro([[video()], []])
    expect(await findStoredVideo('okShortVid1')).toEqual(video())
    expect(await findStoredVideo('okShortVid1')).toBeNull()
  })

  it('videoIdParam y jobIdParam responden 404 si no tienen forma', async () => {
    installNitro()
    expect(videoIdParam(makeEvent({ params: { videoId: 'okShortVid1' } }))).toBe('okShortVid1')
    await expectStatus(Promise.resolve().then(() => videoIdParam(makeEvent({ params: { videoId: 'corto' } }))), 404)
    await expectStatus(Promise.resolve().then(() => videoIdParam(makeEvent())), 404)
    expect(jobIdParam(makeEvent({ params: { jobId: 'f'.repeat(32) } }))).toBe('f'.repeat(32))
    await expectStatus(Promise.resolve().then(() => jobIdParam(makeEvent({ params: { jobId: 'F'.repeat(32) } }))), 404)
  })
})
