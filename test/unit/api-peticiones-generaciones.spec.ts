// Generaciones de Peticiones (feature 007, enmienda «Página de generación», 2026-11-15): crear una generación con los grupos
// de la selección (409 si alguna petición ya no está disponible, sin crear nada), leerla con la imagen más reciente de cada
// grupo (404 si no existe) y la comprobación de que una imagen con `generationId` sea uno de sus grupos. Los endpoints
// exigen rol de equipo, validan antes de consultar y responden con `no-store`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertPrayerGenerationGroup, createPrayerGeneration, getPrayerGeneration } from '../../server/utils/prayer-generations'
import { created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'

vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, putObject: vi.fn(), deleteMany: vi.fn(), presignGet: vi.fn() }))

afterEach(() => {
  vi.unstubAllGlobals()
})

const FILE = '00000000-0000-4000-8000-000000000001'
const FILE2 = '00000000-0000-4000-8000-000000000002'
const GENERATION = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'

/** Lo que `loadEligibleRequests` lee de `files` por cada petición que sigue aprobada y visible. */
const eligible = (id: string) => ({ id, storageKey: `pre/guest/${id}`, previewKey: null, mimeType: 'image/jpeg' })
/** Lo que `loadVerifiedTexts` lee de `prayer_transcripts`: el texto que una persona ya verificó. */
const verified = (fileId: string) => ({ fileId, text: 'Por mi familia', status: 'verified' })
const imageRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID, storageKey: `pre/peticiones/${UUID}.png`, mediaType: 'image/png', fileIds: [FILE], createdBy: 'u1', createdAt: created,
  generationId: GENERATION, authorName: 'Ana', authorStatus: 'active', ...changes,
})
const generationRow = (changes: Record<string, unknown> = {}) => ({
  id: GENERATION, groups: [[FILE], [FILE2, UUID2]], createdBy: 'u1', createdAt: created, authorName: 'Ana', authorStatus: 'active', ...changes,
})

describe('prayer-generations', () => {
  it('createPrayerGeneration: comprueba las peticiones, guarda los grupos en orden y devuelve el id', async () => {
    const fake = installNitro([[eligible(FILE), eligible(FILE2)], [verified(FILE), verified(FILE2)], [{ id: GENERATION }]])
    expect(await createPrayerGeneration([[FILE], [FILE2]], { userId: 'u1' })).toEqual({ id: GENERATION })
    const check = sqlText(fake.calls.find(c => c.method === 'where')?.args[0])
    expect(check).toContain(FILE)
    expect(check).toContain(FILE2)
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toEqual({ groups: [[FILE], [FILE2]], createdBy: 'u1' })
  })

  it('createPrayerGeneration: una petición que ya no está disponible → 409 request_unavailable con sus ids y sin insertar', async () => {
    const fake = installNitro([[eligible(FILE)]])
    const error = await expectStatus(createPrayerGeneration([[FILE, FILE2]], { userId: 'u1' }), 409)
    expect(error.data).toEqual({ code: 'request_unavailable', ids: [FILE2] })
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('assertPrayerGenerationGroup: pasa si los ids son uno de los grupos (en cualquier orden)', async () => {
    installNitro([[{ groups: [[FILE], [FILE2, UUID2]] }]])
    await expect(assertPrayerGenerationGroup(GENERATION, [UUID2, FILE2])).resolves.toBeUndefined()
  })

  it('assertPrayerGenerationGroup: generación inexistente → 404; ids que no son un grupo → 409', async () => {
    installNitro([[]])
    expect((await expectStatus(assertPrayerGenerationGroup(GENERATION, [FILE]), 404)).data).toEqual({ code: 'generation_not_found' })
    installNitro([[{ groups: [[FILE], [FILE2, UUID2]] }]])
    expect((await expectStatus(assertPrayerGenerationGroup(GENERATION, [FILE, FILE2]), 409)).data).toEqual({ code: 'generation_mismatch' })
    installNitro([[{ groups: [[FILE, FILE2]] }]])
    await expectStatus(assertPrayerGenerationGroup(GENERATION, [FILE]), 409)
  })

  it('getPrayerGeneration: cada grupo con su imagen más reciente (o null), dos sentencias sin N+1', async () => {
    // Dos consultas en paralelo: la de las imágenes toma el primer resultado de la cola y la de la fila el segundo.
    const older = imageRow({ id: UUID2, fileIds: [UUID2, FILE2], createdAt: new Date(created.getTime() - 60_000) })
    const newer = imageRow({ id: FILE, fileIds: [FILE2, UUID2] })
    const fake = installNitro([[newer, older, imageRow({ id: UUID, fileIds: [UUID] })], [generationRow()]])
    const generation = await getPrayerGeneration(GENERATION)
    expect(generation).toEqual({
      id: GENERATION,
      createdAt: created.toISOString(),
      author: { userId: 'u1', name: 'Ana', active: true },
      groups: [
        { index: 1, fileIds: [FILE], image: null },
        { index: 2, fileIds: [FILE2, UUID2], image: expect.objectContaining({ id: FILE, generationId: GENERATION, requestCount: 2 }) },
      ],
    })
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(2)
  })

  it('getPrayerGeneration: sin fila → 404 generation_not_found; autora inactiva → «Usuario»', async () => {
    installNitro([[], []])
    expect((await expectStatus(getPrayerGeneration(GENERATION), 404)).data).toEqual({ code: 'generation_not_found' })
    installNitro([[], [generationRow({ authorName: null, authorStatus: 'disabled' })]])
    expect((await getPrayerGeneration(GENERATION)).author).toEqual({ userId: 'u1', name: 'Usuario', active: false })
  })
})

describe('POST /api/peticiones/generaciones', () => {
  const post = async (body: unknown) => {
    const handler = await loadHandler<Record<string, unknown>>('api/peticiones/generaciones/index.post.ts')
    const event = makeEvent({ method: 'POST', url: '/api/peticiones/generaciones', body })
    return { event, result: Promise.resolve().then(() => handler(event)) }
  }

  it('crea la generación con los grupos validados y responde 201 { id } con no-store', async () => {
    const createPrayerGeneration = vi.fn(async () => ({ id: GENERATION }))
    installNitro([], { createPrayerGeneration })
    const { event, result } = await post({ groups: [[FILE.toUpperCase()], [FILE2, UUID2]] })
    expect(await result).toEqual({ id: GENERATION })
    expect(createPrayerGeneration).toHaveBeenCalledWith([[FILE], [FILE2, UUID2]], expect.objectContaining({ userId: 'u1' }))
    expect(event.node.res.statusCode).toBe(201)
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it.each([
    ['sin grupos', { groups: [] }],
    ['un grupo vacío', { groups: [[]] }],
    ['cinco en un grupo', { groups: [[FILE, FILE2, UUID, UUID2, '6fa459ea-ee8a-3ca4-894e-db77e160355e']] }],
    ['la misma petición en dos grupos', { groups: [[FILE], [FILE]] }],
    ['sin cuerpo', undefined],
    ['la forma vieja', { fileIds: [FILE] }],
  ])('%s → 422 sin crear nada', async (_, body) => {
    const createPrayerGeneration = vi.fn()
    installNitro([], { createPrayerGeneration })
    const { result } = await post(body)
    const error = await expectStatus(result, 422)
    expect((error.data as { errors: object }).errors).toBeTruthy()
    expect(createPrayerGeneration).not.toHaveBeenCalled()
  })

  it('un 409 de la capa de datos llega tal cual (con los ids)', async () => {
    const { prayerError } = await import('../../server/utils/prayer-errors')
    installNitro([], { createPrayerGeneration: vi.fn(async () => { throw prayerError('request_unavailable', { ids: [FILE] }) }) })
    const { result } = await post({ groups: [[FILE]] })
    expect((await expectStatus(result, 409)).data).toEqual({ code: 'request_unavailable', ids: [FILE] })
  })

  it('exige sesión de equipo', async () => {
    installNitro([], { createPrayerGeneration: vi.fn() })
    await expectGuarded(await loadHandler('api/peticiones/generaciones/index.post.ts'), { method: 'POST', url: '/api/peticiones/generaciones', body: { groups: [[FILE]] } })
  })
})

describe('GET /api/peticiones/generaciones/:id', () => {
  it('devuelve la generación con no-store', async () => {
    const generation = { id: GENERATION, createdAt: created.toISOString(), author: { userId: 'u1', name: 'Ana', active: true }, groups: [] }
    const getPrayerGeneration = vi.fn(async () => generation)
    installNitro([], { getPrayerGeneration })
    const handler = await loadHandler('api/peticiones/generaciones/[id].get.ts')
    const event = makeEvent({ url: `/api/peticiones/generaciones/${GENERATION}`, params: { id: GENERATION } })
    expect(await handler(event)).toBe(generation)
    expect(getPrayerGeneration).toHaveBeenCalledWith(GENERATION)
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('un id que no es UUID → 404 sin consultar; una generación borrada → 404 generation_not_found', async () => {
    const { prayerError } = await import('../../server/utils/prayer-errors')
    const getPrayerGeneration = vi.fn(async () => { throw prayerError('generation_not_found') })
    installNitro([], { getPrayerGeneration })
    const handler = await loadHandler('api/peticiones/generaciones/[id].get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/peticiones/generaciones/x', params: { id: 'x' } }))), 404)
    expect(getPrayerGeneration).not.toHaveBeenCalled()
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: GENERATION } }))), 404)
    expect(error.data).toEqual({ code: 'generation_not_found' })
  })

  it('exige sesión de equipo', async () => {
    installNitro([], { getPrayerGeneration: vi.fn() })
    await expectGuarded(await loadHandler('api/peticiones/generaciones/[id].get.ts'), { params: { id: GENERATION } })
  })
})
