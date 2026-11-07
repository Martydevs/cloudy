// Lote de presentaciones (POST /api/songs/presentations): revisión local por canción, una sola llamada al servicio con las
// válidas, éxito parcial con el resultado de cada canción en `X-Song-Presentations` y 422 cuando no sale ninguna.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { songError } from '../../server/utils/songs'
import { expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, UUID, UUID2 } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const UUID3 = 'c56a4180-65aa-42ec-a945-5fd21dec0538'
const ROUTE = 'api/songs/presentations.post.ts'
const ZIP = new Uint8Array([0x50, 0x4B, 5, 6])

const song = (id: string, changes: Record<string, unknown> = {}) => ({ id, title: `Canción ${id.slice(0, 4)}`, lyrics: [['uno', 'dos']], ...changes })
const doneItem = (index: number, filename: string) => ({ index, status: 'done', filename, slideCount: 2, arrangedBy: 'llm', errorCode: null })
const post = (songIds: unknown) => makeEvent({ method: 'POST', body: { songIds } })
const results = (event: ReturnType<typeof post>) =>
  JSON.parse(decodeURIComponent(String(event.node.res.getHeader('X-Song-Presentations'))))

describe('POST /api/songs/presentations', () => {
  it('envía las canciones válidas en orden y responde el zip con el resultado de cada una', async () => {
    const createLyricsPptxBatch = vi.fn(async () => ({ zip: ZIP, items: [doneItem(0, 'Cancion 3f25.pptx'), doneItem(1, 'Cancion 9b2c.pptx')] }))
    installNitro([[song(UUID2), song(UUID)]], { createLyricsPptxBatch })
    const event = post([UUID, UUID2, UUID])
    const body = await (await loadHandler(ROUTE))(event) as Buffer
    expect([...body]).toEqual([...ZIP])
    expect(createLyricsPptxBatch).toHaveBeenCalledWith([
      { position: 0, html: '<div class="lyric-original"><p>uno<br>dos</p></div>', title: 'Canción 3f25' },
      { position: 1, html: '<div class="lyric-original"><p>uno<br>dos</p></div>', title: 'Canción 9b2c' },
    ])
    const res = event.node.res
    expect(res.getHeader('Content-Type')).toBe('application/zip')
    expect(res.getHeader('Content-Disposition')).toBe('attachment; filename="canciones.zip"')
    expect(res.getHeader('Cache-Control')).toBe('no-store')
    expect(results(event)).toEqual([
      { songId: UUID, status: 'done', filename: 'Cancion 3f25.pptx', slideCount: 2, arrangedBy: 'llm', errorCode: null },
      { songId: UUID2, status: 'done', filename: 'Cancion 9b2c.pptx', slideCount: 2, arrangedBy: 'llm', errorCode: null },
    ])
  })

  it('éxito parcial: inexistente, sin letra y demasiado larga no van al servicio; un fallo del servicio se mapea a su canción', async () => {
    const UUID4 = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
    const createLyricsPptxBatch = vi.fn(async () => ({
      zip: ZIP,
      items: [doneItem(0, 'A.pptx'), { index: 1, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'no_lyrics' }],
    }))
    const long = [Array.from({ length: 301 }, (_, i) => `l${i}`)]
    installNitro([[song(UUID), song(UUID2, { lyrics: null }), song(UUID3, { lyrics: long }), song(UUID4)]], { createLyricsPptxBatch })
    const MISSING = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const event = post([UUID, MISSING, UUID2])
    // Tres ids como máximo: el cuarto caso se prueba aparte.
    await (await loadHandler(ROUTE))(event)
    expect((createLyricsPptxBatch.mock.calls[0] as unknown as [unknown[]])[0]).toHaveLength(1)
    expect(results(event).map((r: { songId: string, status: string, errorCode: string | null }) => [r.songId, r.status, r.errorCode])).toEqual([
      [UUID, 'done', null],
      [MISSING, 'failed', 'not_found'],
      [UUID2, 'failed', 'no_lyrics'],
    ])

    installNitro([[song(UUID), song(UUID3, { lyrics: long }), song(UUID4)]], { createLyricsPptxBatch })
    const second = post([UUID3, UUID, UUID4])
    await (await loadHandler(ROUTE))(second)
    expect(results(second).map((r: { status: string, errorCode: string | null }) => [r.status, r.errorCode])).toEqual([
      ['failed', 'lyrics_too_long'],
      ['done', null],
      ['failed', 'no_lyrics'],
    ])
  })

  it('≤ 300 líneas pero más de 500 000 caracteres de HTML → lyrics_too_long sin ir al servicio (la misma regla que el .pptx suelto)', async () => {
    const createLyricsPptxBatch = vi.fn(async () => ({ zip: ZIP, items: [doneItem(0, 'A.pptx')] }))
    const huge = [Array.from({ length: 100 }, () => 'x'.repeat(5_100))]
    installNitro([[song(UUID), song(UUID2, { lyrics: huge })]], { createLyricsPptxBatch })
    const event = post([UUID2, UUID])
    await (await loadHandler(ROUTE))(event)
    expect((createLyricsPptxBatch.mock.calls[0] as unknown as [unknown[]])[0]).toHaveLength(1)
    expect(results(event).map((r: { status: string, errorCode: string | null }) => [r.status, r.errorCode])).toEqual([
      ['failed', 'lyrics_too_long'],
      ['done', null],
    ])
  })

  it('ninguna válida → 422 presentations_failed con cada canción y sin llamar al servicio', async () => {
    const createLyricsPptxBatch = vi.fn()
    installNitro([[song(UUID, { lyrics: [] })]], { createLyricsPptxBatch })
    const error = await expectStatus(Promise.resolve((await loadHandler(ROUTE))(post([UUID, UUID2]))), 422)
    expect(error.message).toBe('No se pudo generar ninguna de las presentaciones.')
    expect(error.data).toMatchObject({
      code: 'presentations_failed',
      items: [{ songId: UUID, errorCode: 'no_lyrics' }, { songId: UUID2, errorCode: 'not_found' }],
    })
    expect(createLyricsPptxBatch).not.toHaveBeenCalled()
  })

  it('el servicio no logra ninguna → 422 con el código de cada una', async () => {
    const failedItem = (index: number) => ({ index, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode: 'lyrics_too_long' })
    installNitro([[song(UUID)]], { createLyricsPptxBatch: vi.fn(async () => ({ zip: null, items: [failedItem(0), failedItem(7)] })) })
    const error = await expectStatus(Promise.resolve((await loadHandler(ROUTE))(post([UUID]))), 422)
    expect(error.data).toMatchObject({ code: 'presentations_failed', items: [{ songId: UUID, status: 'failed', errorCode: 'lyrics_too_long' }] })
  })

  it.each([['waking', 503], ['misconfigured', 502], ['not_configured', 503]] as const)('el error %s de la frontera se propaga con su código', async (code, status) => {
    installNitro([[song(UUID)]], { createLyricsPptxBatch: vi.fn(async () => { throw songError(code) }) })
    const error = await expectStatus(Promise.resolve((await loadHandler(ROUTE))(post([UUID]))), status)
    expect(error.data).toEqual({ code })
  })

  it.each([
    ['vacío', []],
    ['más de 3', [UUID, UUID2, UUID3, '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d']],
    ['13 copias del mismo id (lista demasiado larga aunque sea uno solo)', Array.from({ length: 13 }, () => UUID)],
    ['id sin forma', ['x']],
    ['sin lista', undefined],
  ])('cuerpo %s → 422 de validación sin consultar', async (_, songIds) => {
    const createLyricsPptxBatch = vi.fn()
    installNitro([], { createLyricsPptxBatch })
    await expectStatus(Promise.resolve().then(async () => (await loadHandler(ROUTE))(post(songIds))), 422)
    expect(createLyricsPptxBatch).not.toHaveBeenCalled()
  })

  it('exige sesión de editor', async () => {
    installNitro([], { createLyricsPptxBatch: vi.fn() })
    await expectGuarded(await loadHandler(ROUTE), { method: 'POST', body: { songIds: [UUID] } })
  })
})
