// T020 — Ficha de un video y su registro en el historial (feature 005, contracts/api.md, research D10).
import { createError } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectGuarded, expectStatus, installNitro, loadHandler, makeEvent } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const detail = (changes: Record<string, unknown> = {}) => ({
  videoId: 'okShortVid1',
  title: 'Alabanza',
  channel: 'Iglesia',
  durationSeconds: 185,
  thumbnailUrl: 'https://i.ytimg.com/vi/okShortVid1/hq.jpg',
  availableHeights: [360, 720, 1080],
  downloadable: true,
  reason: null,
  ...changes,
})

const stored = { videoId: 'privateVid1', title: 'Guardado', channel: null, durationSeconds: 60, thumbnailUrl: null, lastViewedAt: null }

describe('GET /api/youtube/videos/:videoId', () => {
  it('sonda + upsert en un solo db.batch y devuelve la ficha', async () => {
    const probeVideo = vi.fn(async () => detail())
    const fake = installNitro([[]], { probeVideo })
    const handler = await loadHandler('api/youtube/videos/[videoId].get.ts')
    const event = makeEvent({ params: { videoId: 'okShortVid1' } })
    expect(await handler(event)).toEqual(detail())
    expect(probeVideo).toHaveBeenCalledWith('okShortVid1')
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect(fake.calls.map(c => c.method)).toEqual(['insert', 'values', 'onConflictDoUpdate'])
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('registra también un video que no se puede descargar', async () => {
    const fake = installNitro([[]], { probeVideo: vi.fn(async () => detail({ downloadable: false, reason: 'too_long' })) })
    const handler = await loadHandler('api/youtube/videos/[videoId].get.ts')
    expect(await handler(makeEvent({ params: { videoId: 'tooLongVid1' } }))).toMatchObject({ downloadable: false, reason: 'too_long' })
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
  })

  it('error de video con fila previa → la fila guardada con downloadable false y el motivo', async () => {
    const fake = installNitro([[stored], []], { probeVideo: vi.fn(async () => { throw createError({ statusCode: 404, data: { code: 'private' } }) }) })
    const handler = await loadHandler('api/youtube/videos/[videoId].get.ts')
    expect(await handler(makeEvent({ params: { videoId: 'privateVid1' } }))).toEqual({
      videoId: 'privateVid1', title: 'Guardado', channel: null, durationSeconds: 60, thumbnailUrl: null,
      availableHeights: [], downloadable: false, reason: 'private',
    })
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
  })

  it('un código que no es motivo de bloqueo se muestra como no disponible', async () => {
    installNitro([[stored], []], { probeVideo: vi.fn(async () => { throw createError({ statusCode: 404, data: { code: 'raro' } }) }) })
    const handler = await loadHandler('api/youtube/videos/[videoId].get.ts')
    expect(await handler(makeEvent({ params: { videoId: 'privateVid1' } }))).toMatchObject({ reason: 'unavailable' })
  })

  it('error de video sin fila previa → 404 y no registra nada', async () => {
    const fake = installNitro([[]], {
      probeVideo: vi.fn(async () => { throw createError({ statusCode: 404, message: 'No encontramos ese video. Revisa el enlace.', data: { code: 'private' } }) }),
    })
    const handler = await loadHandler('api/youtube/videos/[videoId].get.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ params: { videoId: 'privateVid1' } }))), 404)
    expect(error.message).toBe('No encontramos ese video. Revisa el enlace.')
    expect(fake.db.batch).not.toHaveBeenCalled()
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('503 del servicio sale tal cual, sin leer la base', async () => {
    const fake = installNitro([], { probeVideo: vi.fn(async () => { throw createError({ statusCode: 503, data: { state: 'waking' } }) }) })
    const handler = await loadHandler('api/youtube/videos/[videoId].get.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { videoId: 'okShortVid1' } }))), 503)
    expect(fake.calls).toHaveLength(0)
  })

  it('404 sin llamar al servicio con un ID sin forma; exige sesión', async () => {
    const probeVideo = vi.fn(async () => detail())
    installNitro([], { probeVideo })
    const handler = await loadHandler('api/youtube/videos/[videoId].get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { videoId: 'abc' } }))), 404)
    expect(probeVideo).not.toHaveBeenCalled()
    await expectGuarded(handler, { params: { videoId: 'okShortVid1' } })
  })
})
