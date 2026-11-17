// Generaciones de Peticiones (página de generación): que una imagen pertenezca a uno de los grupos de su generación, la
// generación con la imagen más reciente de cada grupo, su endpoint y la imagen ligada a su generación.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prayerError } from '../../server/utils/prayer-errors'
import { assertPrayerGenerationGroup, getPrayerGeneration } from '../../server/utils/prayer-generations'
import { created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'

const s3 = vi.hoisted(() => ({ putObject: vi.fn(async () => {}), deleteMany: vi.fn(async () => {}), presignGet: vi.fn(async () => 'https://bucket.test/signed') }))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

const GENERATION = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const FILE3 = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'
const IMAGE_OLD = '10000000-0000-4000-8000-000000000001'
const IMAGE_NEW = '10000000-0000-4000-8000-000000000002'

const generationRow = (changes: Record<string, unknown> = {}) => ({
  id: GENERATION, groups: [[UUID, UUID2], [FILE3]], createdBy: 'u1', createdAt: created, authorName: 'Ana', authorStatus: 'active', ...changes,
})
const imageRow = (id: string, fileIds: string[], createdAt: Date) => ({
  id, storageKey: `pre/peticiones/${id}.png`, mediaType: 'image/png', fileIds, createdBy: 'u1', createdAt, generationId: GENERATION, authorName: 'Ana', authorStatus: 'active',
})

beforeEach(() => {
  s3.putObject.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('assertPrayerGenerationGroup', () => {
  it('pasa si las peticiones son uno de los grupos, en cualquier orden', async () => {
    const fake = installNitro([[{ groups: [[UUID, UUID2], [FILE3]] }]])
    await expect(assertPrayerGenerationGroup(GENERATION, [UUID2, UUID])).resolves.toBeUndefined()
    expect(sqlText(fake.calls.find(c => c.method === 'where')!.args[0])).toContain(GENERATION)
  })

  it('la generación no existe → 404 generation_not_found', async () => {
    installNitro([[]])
    const error = await expectStatus(assertPrayerGenerationGroup(GENERATION, [UUID]), 404)
    expect(error.data).toEqual({ code: 'generation_not_found' })
  })

  it.each([
    ['una parte de un grupo', [UUID]],
    ['peticiones de dos grupos', [UUID, FILE3]],
    ['una petición de fuera', [UUID, UUID2, FILE3]],
  ])('%s → 409 generation_mismatch', async (_, fileIds) => {
    installNitro([[{ groups: [[UUID, UUID2], [FILE3]] }]])
    const error = await expectStatus(assertPrayerGenerationGroup(GENERATION, fileIds), 409)
    expect(error.data).toEqual({ code: 'generation_mismatch' })
  })
})

describe('getPrayerGeneration', () => {
  it('devuelve sus grupos en orden y, para cada uno, la imagen guardada más reciente (o null), en dos consultas', async () => {
    const newer = new Date(created.getTime() + 60_000)
    // La consulta de las imágenes sale primero (las dos van en paralelo). Llegan de la más reciente a la más antigua; las dos
    // son del primer grupo.
    const fake = installNitro([[imageRow(IMAGE_NEW, [UUID2, UUID], newer), imageRow(IMAGE_OLD, [UUID, UUID2], created)], [generationRow()]])
    const generation = await getPrayerGeneration(GENERATION)
    expect(generation).toMatchObject({ id: GENERATION, createdAt: created.toISOString(), author: { userId: 'u1', name: 'Ana', active: true } })
    expect(generation.groups.map(group => [group.index, group.fileIds, group.image?.id ?? null])).toEqual([
      [1, [UUID, UUID2], IMAGE_NEW],
      [2, [FILE3], null],
    ])
    expect(generation.groups[0]!.image).toMatchObject({ previewUrl: `/api/peticiones/imagenes/${IMAGE_NEW}/content`, generationId: GENERATION, requestCount: 2 })
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(2)
  })

  it('quien la creó ya no está activa: se muestra como inactiva', async () => {
    installNitro([[], [generationRow({ authorName: null, authorStatus: 'removed' })]])
    expect((await getPrayerGeneration(GENERATION)).author).toEqual({ userId: 'u1', name: 'Usuario', active: false })
  })

  it('no existe → 404 generation_not_found', async () => {
    installNitro([[], []])
    const error = await expectStatus(getPrayerGeneration(GENERATION), 404)
    expect(error.data).toEqual({ code: 'generation_not_found' })
  })
})

describe('GET /api/peticiones/generaciones/:id', () => {
  const FILE = 'api/peticiones/generaciones/[id].get.ts'

  it('devuelve la generación con no-store', async () => {
    const generation = { id: GENERATION, groups: [] }
    const getPrayerGeneration = vi.fn(async () => generation)
    installNitro([], { getPrayerGeneration })
    const handler = await loadHandler(FILE)
    const event = makeEvent({ url: `/api/peticiones/generaciones/${GENERATION}`, params: { id: GENERATION } })
    expect(await handler(event)).toBe(generation)
    expect(getPrayerGeneration).toHaveBeenCalledWith(GENERATION)
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('un id que no es UUID → 404 sin consultar', async () => {
    const getPrayerGeneration = vi.fn()
    installNitro([], { getPrayerGeneration })
    const handler = await loadHandler(FILE)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/peticiones/generaciones/x', params: { id: 'x' } }))), 404)
    expect(getPrayerGeneration).not.toHaveBeenCalled()
  })

  it('exige sesión de equipo', async () => {
    installNitro([])
    await expectGuarded(await loadHandler(FILE), { url: `/api/peticiones/generaciones/${GENERATION}`, params: { id: GENERATION } })
  })
})

describe('POST /api/peticiones/imagenes con generationId', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47])
  const FILE = 'api/peticiones/imagenes/index.post.ts'

  function install(assert: (...args: unknown[]) => Promise<void> = async () => {}) {
    const createPrayerImage = vi.fn(async () => ({ mediaType: 'image/png', data: PNG, count: 2 }))
    const assertPrayerGenerationGroup = vi.fn(assert)
    const fake = installNitro([], { createPrayerImage, assertPrayerGenerationGroup, hitRateLimit: vi.fn(async () => {}) })
    return { createPrayerImage, assertPrayerGenerationGroup, fake }
  }

  const post = async (body: unknown) => {
    const handler = await loadHandler<Record<string, unknown>>(FILE)
    return Promise.resolve().then(() => handler(makeEvent({ method: 'POST', url: '/api/peticiones/imagenes', body })))
  }

  it('comprueba que las peticiones sean un grupo de la generación y guarda la imagen ligada a ella', async () => {
    const { assertPrayerGenerationGroup, fake } = install()
    const image = await post({ fileIds: [UUID, UUID2], generationId: GENERATION })
    expect(assertPrayerGenerationGroup).toHaveBeenCalledWith(GENERATION, [UUID, UUID2])
    expect(image.generationId).toBe(GENERATION)
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({ fileIds: [UUID, UUID2], generationId: GENERATION })
  })

  it('sin generationId no se comprueba ninguna generación', async () => {
    const { assertPrayerGenerationGroup } = install()
    expect((await post({ fileIds: [UUID] })).generationId).toBeNull()
    expect(assertPrayerGenerationGroup).not.toHaveBeenCalled()
  })

  it.each([
    ['generation_not_found', 404],
    ['generation_mismatch', 409],
  ] as const)('%s → %i sin generar ni subir nada', async (code, status) => {
    const { createPrayerImage } = install(async () => { throw prayerError(code) })
    const error = await expectStatus(post({ fileIds: [UUID], generationId: GENERATION }), status)
    expect(error.data).toEqual({ code })
    expect(createPrayerImage).not.toHaveBeenCalled()
    expect(s3.putObject).not.toHaveBeenCalled()
  })

  it('un generationId que no es UUID → 422', async () => {
    const { createPrayerImage } = install()
    await expectStatus(post({ fileIds: [UUID], generationId: 'x' }), 422)
    expect(createPrayerImage).not.toHaveBeenCalled()
  })
})
