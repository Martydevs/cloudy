// T041 — Generar la presentación (feature 006, contracts/api.md § 4). `useDb` y `createLyricsPptx` simulados.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { songError } from '../../server/utils/songs'
import { presentationDisposition, presentationFilename } from '../../server/utils/songs'
import { expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, UUID } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const created = new Date('2026-11-05T10:00:00.000Z')
const row = (changes: Record<string, unknown> = {}) => ({
  id: UUID, sourceUrl: 'https://letras.com/a/b', title: 'Canción del Señor', artist: null,
  lyrics: [['uno', 'dos'], ['<tres>']], lastViewedAt: null, lastViewedBy: null, createdAt: created, updatedAt: created, ...changes,
})
const BYTES = new Uint8Array([0x50, 0x4B, 3, 4])
const pptx = (changes: Record<string, unknown> = {}) => ({ bytes: BYTES, contentDisposition: 'attachment; filename="x.pptx"', slideCount: 4, arrangedBy: 'llm', ...changes })
const post = () => makeEvent({ method: 'POST', params: { id: UUID } })

describe('POST /api/songs/:id/pptx', () => {
  it('envía la letra guardada como HTML escapado y el título; responde los bytes con las cinco cabeceras', async () => {
    const createLyricsPptx = vi.fn(async () => pptx())
    installNitro([[row()]], { createLyricsPptx })
    const handler = await loadHandler('api/songs/[id]/pptx.post.ts')
    const event = post()
    const body = await handler(event) as Buffer
    expect(Buffer.isBuffer(body)).toBe(true)
    expect([...body]).toEqual([...BYTES])
    expect(createLyricsPptx).toHaveBeenCalledWith({ html: '<div class="lyric-original"><p>uno<br>dos</p><p>&lt;tres&gt;</p></div>', title: 'Canción del Señor' })
    const res = event.node.res
    expect(res.getHeader('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect(res.getHeader('Content-Disposition')).toBe('attachment; filename="x.pptx"')
    expect(res.getHeader('X-Slide-Count')).toBe('4')
    expect(res.getHeader('X-Lyrics-Arranged-By')).toBe('llm')
    expect(res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('sin Content-Disposition del servicio arma uno propio con el título y filename* en UTF-8; sin conteo ni reparto no los envía', async () => {
    installNitro([[row()]], { createLyricsPptx: vi.fn(async () => pptx({ contentDisposition: null, slideCount: null, arrangedBy: null })) })
    const handler = await loadHandler('api/songs/[id]/pptx.post.ts')
    const event = post()
    await handler(event)
    expect(event.node.res.getHeader('Content-Disposition')).toBe('attachment; filename="Cancion del Senor.pptx"; filename*=UTF-8\'\'Canci%C3%B3n%20del%20Se%C3%B1or.pptx')
    expect(event.node.res.getHeader('X-Slide-Count')).toBeUndefined()
    expect(event.node.res.getHeader('X-Lyrics-Arranged-By')).toBeUndefined()
  })

  it('el título nunca pasa de 200 caracteres', async () => {
    const createLyricsPptx = vi.fn(async () => pptx())
    installNitro([[row({ title: 'T'.repeat(250) })]], { createLyricsPptx })
    await (await loadHandler('api/songs/[id]/pptx.post.ts'))(post())
    expect((createLyricsPptx.mock.calls[0] as unknown as [{ title: string }])[0].title).toHaveLength(200)
  })

  it('más de 300 líneas → 422 lyrics_too_long sin llamar al servicio', async () => {
    const createLyricsPptx = vi.fn()
    installNitro([[row({ lyrics: [Array.from({ length: 301 }, (_, i) => `l${i}`)] })]], { createLyricsPptx })
    const error = await expectStatus(Promise.resolve((await loadHandler('api/songs/[id]/pptx.post.ts'))(post())), 422)
    expect(error.data).toEqual({ code: 'lyrics_too_long' })
    expect(createLyricsPptx).not.toHaveBeenCalled()
  })

  it('letra vacía → 422 no_lyrics sin llamar al servicio', async () => {
    const createLyricsPptx = vi.fn()
    installNitro([[row({ lyrics: null })]], { createLyricsPptx })
    const error = await expectStatus(Promise.resolve((await loadHandler('api/songs/[id]/pptx.post.ts'))(post())), 422)
    expect(error.data).toEqual({ code: 'no_lyrics' })
    expect(createLyricsPptx).not.toHaveBeenCalled()
  })

  it.each([['waking', 503], ['misconfigured', 502], ['invalid', 502], ['not_configured', 503], ['no_lyrics', 404]] as const)('el error %s de la frontera se propaga con su código', async (code, status) => {
    installNitro([[row()]], { createLyricsPptx: vi.fn(async () => { throw songError(code) }) })
    const error = await expectStatus(Promise.resolve((await loadHandler('api/songs/[id]/pptx.post.ts'))(post())), status)
    expect(error.data).toEqual({ code })
  })

  it('inexistente o id sin forma → 404; exige sesión', async () => {
    const createLyricsPptx = vi.fn()
    installNitro([[]], { createLyricsPptx })
    const handler = await loadHandler('api/songs/[id]/pptx.post.ts')
    await expectStatus(Promise.resolve(handler(post())), 404)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'POST', params: { id: 'x' } }))), 404)
    expect(createLyricsPptx).not.toHaveBeenCalled()
    await expectGuarded(handler, { method: 'POST', params: { id: UUID } })
  })
})

describe('nombre del archivo', () => {
  it('conserva tildes y eñes y quita lo que no vale en un nombre', () => {
    expect(presentationFilename('Canción: «Señor» / 2?')).toBe('Canción «Señor» 2.pptx')
    expect(presentationFilename('  ')).toBe('cancion.pptx')
    expect(presentationDisposition('Ñandú')).toBe('attachment; filename="Nandu.pptx"; filename*=UTF-8\'\'%C3%91and%C3%BA.pptx')
  })
})
