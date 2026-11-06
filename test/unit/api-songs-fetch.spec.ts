// T022 — Obtener la letra, abrir la ficha y volver a obtenerla (feature 006, contracts/api.md § 1–3). `useDb` y
// `crawlLetras` simulados: sin red ni base. Un fallo no escribe nada (FR-009).
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CrawledPage } from '../../server/utils/lyrics-crawler'
import { songError } from '../../server/utils/songs'
import { expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, UUID } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const URL = 'https://letras.com/musiko/de-buenas-part-josh-gamez'
const LYRIC_HTML = '<h1>De Buenas</h1><a class="title-secondary"><h2>Musiko</h2></a><div class="lyric-original"><p>uno<br>dos</p><p>tres</p></div>'
const created = new Date('2026-11-05T10:00:00.000Z')

const row = (changes: Record<string, unknown> = {}) => ({
  id: UUID,
  sourceUrl: URL,
  title: 'De Buenas',
  artist: 'Musiko',
  lyrics: [['uno', 'dos'], ['tres']],
  lastViewedAt: created,
  lastViewedBy: 'u1',
  createdAt: created,
  updatedAt: created,
  ...changes,
})

const detail = (changes: Record<string, unknown> = {}) => ({
  id: UUID,
  title: 'De Buenas',
  artist: 'Musiko',
  sourceUrl: URL,
  lyrics: [['uno', 'dos'], ['tres']],
  lineCount: 3,
  createdAt: created.toISOString(),
  updatedAt: created.toISOString(),
  ...changes,
})

const page = (changes: Partial<CrawledPage> = {}): CrawledPage => ({ html: LYRIC_HTML, status: 200, finalUrl: `${URL.replace('letras.com', 'www.letras.com')}/`, ...changes })

const writes = (fake: { calls: { method: string }[] }) => fake.calls.filter(c => c.method === 'insert' || c.method === 'onConflictDoUpdate')

describe('POST /api/songs/fetch', () => {
  it('enlace inválido → 400 con data.reason, sin tocar la base ni el rastreador', async () => {
    const crawlLetras = vi.fn()
    const fake = installNitro([], { crawlLetras })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    for (const [url, reason] of [['hola', 'not_url'], ['http://www.letras.com/a/b/', 'not_https'], ['https://letras.com.otro.test/a/b/', 'not_letras'], ['https://www.letras.com/musiko/', 'not_song']]) {
      const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ body: { url } }))), 400)
      expect(error.data).toEqual({ reason })
      expect(error.message).toMatch(/\S/)
    }
    expect(crawlLetras).not.toHaveBeenCalled()
    expect(fake.calls).toHaveLength(0)
  })

  it('sin url → 422 de validación', async () => {
    installNitro([], { crawlLetras: vi.fn() })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ body: {} }))), 422)
  })

  it('ya guardada (mismo enlace normalizado) → 200 crawled false, registra la vista y no rastrea', async () => {
    const crawlLetras = vi.fn()
    const fake = installNitro([[row()]], { crawlLetras })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    const event = makeEvent({ body: { url: ' https://www.letras.com/Musiko/de-buenas-part-josh-gamez/?utm_source=x ' } })
    expect(await handler(event)).toEqual({ song: detail(), crawled: false })
    expect(crawlLetras).not.toHaveBeenCalled()
    expect(fake.calls.map(c => c.method)).toEqual(['update', 'set', 'where', 'returning'])
    expect(event.node.res.statusCode).toBe(200)
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('nueva con letra → rastrea el enlace normalizado, upsert + vista en un db.batch y 201 crawled true', async () => {
    const crawlLetras = vi.fn(async () => page())
    const fake = installNitro([[], [row()]], { crawlLetras })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    const event = makeEvent({ body: { url: 'https://www.letras.com/musiko/de-buenas-part-josh-gamez/' } })
    expect(await handler(event)).toEqual({ song: detail(), crawled: true })
    expect(crawlLetras).toHaveBeenCalledWith(URL)
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    const values = fake.calls.find(c => c.method === 'values')!.args[0] as Record<string, unknown>
    expect(values).toMatchObject({ sourceUrl: URL, title: 'De Buenas', artist: 'Musiko', lyrics: [['uno', 'dos'], ['tres']], lastViewedBy: 'u1' })
    expect(values.lastViewedAt).toBeInstanceOf(Date)
    expect(fake.calls.some(c => c.method === 'onConflictDoUpdate')).toBe(true)
    expect(event.node.res.statusCode).toBe(201)
  })

  it.each([
    ['la página responde 404', page({ status: 404 })],
    ['la página responde 410', page({ status: 410 })],
    ['no trae el contenedor de la letra', page({ html: '<h1>Artista</h1><p>nada</p>' })],
    ['viene sin HTML', page({ html: null })],
    ['Letras redirige a otra canción', page({ finalUrl: 'https://www.letras.com/musiko/mas-part-gabrielrodriguezemc/' })],
    ['la dirección final no es de Letras', page({ finalUrl: 'https://otro.test/a/b' })],
  ])('%s → 404 no_lyrics sin escribir', async (_, crawled) => {
    const fake = installNitro([[]], { crawlLetras: vi.fn(async () => crawled) })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ body: { url: URL } }))), 404)
    expect(error.data).toEqual({ code: 'no_lyrics' })
    expect(error.message).toBe('No encontramos una letra en ese enlace.')
    expect(writes(fake)).toEqual([])
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it('sin dirección final se acepta la página rastreada', async () => {
    installNitro([[], [row()]], { crawlLetras: vi.fn(async () => page({ finalUrl: null })) })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    expect(await handler(makeEvent({ body: { url: URL } }))).toMatchObject({ crawled: true })
  })

  it('una página que responde 5xx → 502 crawl_failed sin escribir', async () => {
    const fake = installNitro([[]], { crawlLetras: vi.fn(async () => page({ status: 503 })) })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ body: { url: URL } }))), 502)
    expect(error.data).toEqual({ code: 'crawl_failed' })
    expect(writes(fake)).toEqual([])
  })

  it('más de 300 líneas → 422 lyrics_too_long sin escribir', async () => {
    const long = `<h1>T</h1><div class="lyric-original"><p>${Array.from({ length: 301 }, (_, i) => `l${i}`).join('<br>')}</p></div>`
    const fake = installNitro([[]], { crawlLetras: vi.fn(async () => page({ html: long })) })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ body: { url: URL } }))), 422)
    expect(error.data).toEqual({ code: 'lyrics_too_long' })
    expect(writes(fake)).toEqual([])
  })

  it('más de 500 000 caracteres → 422 lyrics_too_long sin escribir', async () => {
    const huge = `<h1>T</h1><div class="lyric-original"><p>${'a'.repeat(250_000)}<br>${'b'.repeat(250_001)}</p></div>`
    const fake = installNitro([[]], { crawlLetras: vi.fn(async () => page({ html: huge })) })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ body: { url: URL } }))), 422)
    expect(error.data).toEqual({ code: 'lyrics_too_long' })
    expect(writes(fake)).toEqual([])
  })

  it.each([
    ['not_configured', 503],
    ['misconfigured', 502],
    ['quota', 503],
    ['busy', 503],
    ['crawl_failed', 502],
  ] as const)('el error %s del rastreador sale tal cual y no escribe', async (code, status) => {
    const fake = installNitro([[]], { crawlLetras: vi.fn(async () => { throw songError(code) }) })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ body: { url: URL } }))), status)
    expect(error.data).toEqual({ code })
    expect(writes(fake)).toEqual([])
  })

  it('sin título en la página usa uno derivado del enlace; recorta título y artista', async () => {
    const html = `<a class="title-secondary"><h2>${'A'.repeat(250)}</h2></a><div class="lyric-original"><p>l</p></div>`
    const fake = installNitro([[], [row()]], { crawlLetras: vi.fn(async () => page({ html })) })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    await handler(makeEvent({ body: { url: URL } }))
    const values = fake.calls.find(c => c.method === 'values')!.args[0] as Record<string, unknown>
    expect(values.title).toBe('De buenas part josh gamez')
    expect(values.artist).toBe('A'.repeat(200))
  })

  it('si el upsert no devuelve fila → 502 crawl_failed', async () => {
    installNitro([[], []], { crawlLetras: vi.fn(async () => page()) })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ body: { url: URL } }))), 502)
  })

  it('exige sesión de equipo', async () => {
    installNitro([], { crawlLetras: vi.fn() })
    const handler = await loadHandler('api/songs/fetch.post.ts')
    await expectGuarded(handler, { body: { url: URL } })
  })
})

describe('GET /api/songs/:id', () => {
  it('id que no es UUID → 404 sin consultar', async () => {
    const fake = installNitro([])
    const handler = await loadHandler('api/songs/[id]/index.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: 'abc' } }))), 404)
    expect(fake.calls).toHaveLength(0)
  })

  it('inexistente → 404', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/songs/[id]/index.get.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)
    expect(error.message).toBe('Esa canción ya no existe.')
  })

  it('existente → SongDetail con lineCount y la vista registrada en la misma sentencia', async () => {
    const fake = installNitro([[row()]])
    const handler = await loadHandler('api/songs/[id]/index.get.ts')
    const event = makeEvent({ params: { id: UUID } })
    expect(await handler(event)).toEqual(detail())
    expect(fake.calls.map(c => c.method)).toEqual(['update', 'set', 'where', 'returning'])
    expect(fake.calls[1]!.args[0]).toMatchObject({ lastViewedBy: 'u1' })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('una letra guardada que no es arreglo se muestra vacía', async () => {
    installNitro([[row({ lyrics: null })]])
    const handler = await loadHandler('api/songs/[id]/index.get.ts')
    expect(await handler(makeEvent({ params: { id: UUID } }))).toMatchObject({ lyrics: [], lineCount: 0 })
  })

  it('exige sesión de equipo', async () => {
    installNitro([])
    await expectGuarded(await loadHandler('api/songs/[id]/index.get.ts'), { params: { id: UUID } })
  })
})

describe('POST /api/songs/:id/refresh', () => {
  it('con letra válida reemplaza lyrics, title, artist y updated_at', async () => {
    const crawlLetras = vi.fn(async () => page({ html: '<h1>Nuevo</h1><div class="lyric-original"><p>otra</p></div>' }))
    const updated = row({ title: 'Nuevo', artist: null, lyrics: [['otra']], updatedAt: new Date('2026-11-06T10:00:00.000Z') })
    const fake = installNitro([[row()], [updated]], { crawlLetras })
    const handler = await loadHandler('api/songs/[id]/refresh.post.ts')
    expect(await handler(makeEvent({ method: 'POST', params: { id: UUID } }))).toEqual(detail({ title: 'Nuevo', artist: null, lyrics: [['otra']], lineCount: 1, updatedAt: '2026-11-06T10:00:00.000Z' }))
    expect(crawlLetras).toHaveBeenCalledWith(URL)
    const set = fake.calls.find(c => c.method === 'set')!.args[0] as Record<string, unknown>
    expect(set).toMatchObject({ title: 'Nuevo', artist: null, lyrics: [['otra']] })
    expect(set.updatedAt).toBeDefined()
  })

  it('sin letra o con error del rastreador deja la fila intacta', async () => {
    for (const crawl of [vi.fn(async () => page({ html: '<p>nada</p>' })), vi.fn(async () => { throw songError('crawl_failed') })]) {
      const fake = installNitro([[row()]], { crawlLetras: crawl })
      const handler = await loadHandler('api/songs/[id]/refresh.post.ts')
      await expect(Promise.resolve(handler(makeEvent({ method: 'POST', params: { id: UUID } })))).rejects.toMatchObject({ statusCode: expect.any(Number) })
      expect(fake.calls.some(c => c.method === 'update')).toBe(false)
    }
  })

  it('inexistente → 404 sin rastrear; si desaparece al guardar, también 404', async () => {
    const crawlLetras = vi.fn(async () => page())
    installNitro([[]], { crawlLetras })
    let handler = await loadHandler('api/songs/[id]/refresh.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'POST', params: { id: UUID } }))), 404)
    expect(crawlLetras).not.toHaveBeenCalled()

    installNitro([[row()], []], { crawlLetras })
    handler = await loadHandler('api/songs/[id]/refresh.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'POST', params: { id: UUID } }))), 404)
  })

  it('exige sesión de equipo; id sin forma → 404', async () => {
    installNitro([])
    const handler = await loadHandler('api/songs/[id]/refresh.post.ts')
    await expectGuarded(handler, { method: 'POST', params: { id: UUID } })
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'POST', params: { id: 'x' } }))), 404)
  })
})
