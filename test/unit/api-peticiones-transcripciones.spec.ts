// Endpoints de la revisión de transcripciones de Peticiones y la verificación que exige crear una generación: guard de
// equipo, validación antes de consultar, `Cache-Control: no-store` y los códigos de error de la capa de aplicación.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prayerError } from '../../server/utils/prayer-errors'
import { expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, UUID, UUID2 } from './helpers/nitro'

const ai = vi.hoisted(() => ({ generatePrayerImage: vi.fn(), transcribePrayerPhoto: vi.fn() }))
vi.mock('#server/ai', async importOriginal => ({ ...await importOriginal<typeof import('#server/ai')>(), ...ai }))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => path, presignGet: vi.fn(async () => 'https://bucket.test/signed') }))

const transcript = { fileId: UUID, text: 'Por mi familia', status: 'draft', origin: 'model', verifiedAt: null, verifiedBy: null, updatedAt: '2026-11-17T10:00:00.000Z' }
const me = expect.objectContaining({ userId: 'u1', name: 'Ana', status: 'active' })

beforeEach(() => {
  ai.generatePrayerImage.mockReset()
  ai.transcribePrayerPhoto.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/peticiones/transcripciones', () => {
  const FILE = 'api/peticiones/transcripciones/index.get.ts'

  it('devuelve las transcripciones de los ids pedidos con no-store, sin llamar al modelo', async () => {
    const listPrayerTranscripts = vi.fn(async () => [transcript])
    installNitro([], { listPrayerTranscripts })
    const handler = await loadHandler(FILE)
    const event = makeEvent({ url: `/api/peticiones/transcripciones?ids=${UUID},${UUID2}` })
    expect(await handler(event)).toEqual([transcript])
    expect(listPrayerTranscripts).toHaveBeenCalledWith([UUID, UUID2])
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
    expect(ai.transcribePrayerPhoto).not.toHaveBeenCalled()
  })

  it.each([
    ['sin ids', ''],
    ['un id que no es UUID', 'ids=x'],
    ['ids repetidos', `ids=${UUID},${UUID}`],
    ['más de 40 ids', `ids=${Array.from({ length: 41 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',')}`],
  ])('%s → 422 con data.errors sin consultar', async (_, query) => {
    const listPrayerTranscripts = vi.fn()
    installNitro([], { listPrayerTranscripts })
    const handler = await loadHandler(FILE)
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: `/api/peticiones/transcripciones?${query}` }))), 422)
    expect((error.data as { errors: { ids: string } }).errors.ids).toBeTruthy()
    expect(listPrayerTranscripts).not.toHaveBeenCalled()
  })

  it('exige sesión de equipo y sin ella no consulta nada', async () => {
    const listPrayerTranscripts = vi.fn()
    installNitro([], { listPrayerTranscripts })
    await expectGuarded(await loadHandler(FILE), { url: `/api/peticiones/transcripciones?ids=${UUID}` })
    expect(listPrayerTranscripts).not.toHaveBeenCalled()
  })
})

describe('POST /api/peticiones/transcripciones/:fileId/lectura', () => {
  const FILE = 'api/peticiones/transcripciones/[fileId]/lectura.post.ts'

  function install(readPrayerTranscript = vi.fn(async (..._args: unknown[]) => transcript)) {
    const hitRateLimit = vi.fn(async () => {})
    installNitro([], { readPrayerTranscript, hitRateLimit })
    return { readPrayerTranscript, hitRateLimit }
  }

  const post = async (body: unknown, fileId = UUID) => {
    const handler = await loadHandler(FILE)
    const event = makeEvent({ method: 'POST', url: `/api/peticiones/transcripciones/${fileId}/lectura`, params: { fileId }, body })
    return { event, result: Promise.resolve().then(() => handler(event)) }
  }

  it('lee la foto con quien la pide, sin force por defecto, y responde la transcripción con no-store', async () => {
    const { readPrayerTranscript } = install()
    const { event, result } = await post({})
    expect(await result).toEqual(transcript)
    expect(readPrayerTranscript).toHaveBeenCalledWith(UUID, { force: false, me, abortSignal: expect.any(AbortSignal) })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('force: true vuelve a leer', async () => {
    const { readPrayerTranscript } = install()
    await (await post({ force: true })).result
    expect(readPrayerTranscript).toHaveBeenCalledWith(UUID, expect.objectContaining({ force: true }))
  })

  // Decisión del equipo: Cloudy no limita las lecturas; el crédito de OpenRouter es el único freno.
  it('no aplica ningún límite propio', async () => {
    const { hitRateLimit } = install()
    await (await post({})).result
    expect(hitRateLimit).not.toHaveBeenCalled()
  })

  it('un force que no es booleano → 422 sin leer', async () => {
    const { readPrayerTranscript } = install()
    await expectStatus((await post({ force: 'sí' })).result, 422)
    expect(readPrayerTranscript).not.toHaveBeenCalled()
  })

  it('un id que no es UUID → 404 sin leer', async () => {
    const { readPrayerTranscript } = install()
    await expectStatus((await post({}, 'x')).result, 404)
    expect(readPrayerTranscript).not.toHaveBeenCalled()
  })

  it.each([
    ['request_unavailable', 409, { ids: [UUID] }],
    ['unreadable_image', 422, { ids: [UUID] }],
    ['not_configured', 503, {}],
    ['quota_exceeded', 503, {}],
    ['provider', 502, {}],
    ['timeout', 504, {}],
  ] as const)('%s → %i con su data.code', async (code, status, data) => {
    install(vi.fn(async () => { throw prayerError(code, data) }))
    expect((await expectStatus((await post({})).result, status)).data).toEqual({ code, ...data })
  })

  it('cerrar la conexión antes de responder aborta la lectura; el cierre normal no', async () => {
    const signals: AbortSignal[] = []
    install(vi.fn(async (_id: unknown, options: unknown) => {
      signals.push((options as { abortSignal: AbortSignal }).abortSignal)
      return transcript
    }))
    const closed = await post({})
    await closed.result
    closed.event.node.res.emit('close')
    const finished = await post({})
    await finished.result
    Object.defineProperty(finished.event.node.res, 'writableFinished', { value: true, configurable: true })
    finished.event.node.res.emit('close')
    expect(signals.map(signal => signal.aborted)).toEqual([true, false])
  })

  it('exige sesión de equipo y sin ella no se lee nada', async () => {
    const { readPrayerTranscript } = install()
    await expectGuarded(await loadHandler(FILE), { method: 'POST', url: `/api/peticiones/transcripciones/${UUID}/lectura`, params: { fileId: UUID }, body: {} })
    expect(readPrayerTranscript).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/peticiones/transcripciones/:fileId', () => {
  const FILE = 'api/peticiones/transcripciones/[fileId]/index.patch.ts'

  function install(savePrayerTranscript = vi.fn(async (..._args: unknown[]) => ({ ...transcript, status: 'verified' }))) {
    installNitro([], { savePrayerTranscript })
    return { savePrayerTranscript }
  }

  const patch = async (body: unknown, fileId = UUID) => {
    const handler = await loadHandler(FILE)
    const event = makeEvent({ method: 'PATCH', url: `/api/peticiones/transcripciones/${fileId}`, params: { fileId }, body })
    return { event, result: Promise.resolve().then(() => handler(event)) }
  }

  it('guarda el texto recortado y la verificación con quien guarda, y responde con no-store', async () => {
    const { savePrayerTranscript } = install()
    const { event, result } = await patch({ text: '  Por mi familia\ny mi trabajo  ', verified: true })
    expect(await result).toMatchObject({ fileId: UUID, status: 'verified' })
    expect(savePrayerTranscript).toHaveBeenCalledWith(UUID, { text: 'Por mi familia\ny mi trabajo', verified: true }, me)
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('un borrador vacío es válido («Escribir a mano» antes de teclear)', async () => {
    const { savePrayerTranscript } = install()
    await (await patch({ text: '', verified: false })).result
    expect(savePrayerTranscript).toHaveBeenCalledWith(UUID, { text: '', verified: false }, me)
  })

  it.each([
    ['texto en blanco al verificar', { text: '   ', verified: true }, 'text', 'Escribe el texto de la petición para marcarla como verificada'],
    ['texto de más de 1000 caracteres', { text: 'a'.repeat(1001), verified: true }, 'text', 'Debe tener como máximo 1000 caracteres'],
    ['sin verified', { text: 'Hola' }, 'verified', 'Debe ser verdadero o falso'],
    ['sin texto', { verified: false }, 'text', 'Este campo es obligatorio'],
  ])('%s → 422 con el mensaje del campo, sin guardar', async (_, body, field, message) => {
    const { savePrayerTranscript } = install()
    const error = await expectStatus((await patch(body)).result, 422)
    expect((error.data as { errors: Record<string, string> }).errors[field]).toBe(message)
    expect(savePrayerTranscript).not.toHaveBeenCalled()
  })

  it('un id que no es UUID → 404 sin guardar', async () => {
    const { savePrayerTranscript } = install()
    await expectStatus((await patch({ text: 'Hola', verified: true }, 'x')).result, 404)
    expect(savePrayerTranscript).not.toHaveBeenCalled()
  })

  it('una petición que ya no está disponible → 409 request_unavailable', async () => {
    install(vi.fn(async () => { throw prayerError('request_unavailable', { ids: [UUID] }) }))
    expect((await expectStatus((await patch({ text: 'Hola', verified: true })).result, 409)).data).toEqual({ code: 'request_unavailable', ids: [UUID] })
  })

  it('exige sesión de equipo y sin ella no se guarda nada', async () => {
    const { savePrayerTranscript } = install()
    await expectGuarded(await loadHandler(FILE), { method: 'PATCH', url: `/api/peticiones/transcripciones/${UUID}`, params: { fileId: UUID }, body: { text: 'Hola', verified: true } })
    expect(savePrayerTranscript).not.toHaveBeenCalled()
  })
})

describe('POST /api/peticiones/generaciones (verificación)', () => {
  const FILE = 'api/peticiones/generaciones/index.post.ts'
  const eligible = (id: string) => ({ id, storageKey: `guest/s1/${id}`, previewKey: null, mimeType: 'image/jpeg' })
  const verified = (fileId: string, status = 'verified') => ({ fileId, text: 'Por mi familia', status })

  const post = async (body: unknown) => {
    const handler = await loadHandler<{ id: string }>(FILE)
    const event = makeEvent({ method: 'POST', url: '/api/peticiones/generaciones', body })
    return { event, result: Promise.resolve().then(() => handler(event)) }
  }

  it('con todas las peticiones verificadas crea la generación con sus grupos y responde 201', async () => {
    const fake = installNitro([[eligible(UUID), eligible(UUID2)], [verified(UUID), verified(UUID2)], [{ id: 'g1' }]])
    const { event, result } = await post({ groups: [[UUID], [UUID2]] })
    expect(await result).toEqual({ id: 'g1' })
    expect(event.node.res.statusCode).toBe(201)
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toEqual({ groups: [[UUID], [UUID2]], createdBy: 'u1' })
  })

  // Regresión de la revisión antes de generar: el servidor es la autoridad, envíe lo que envíe el navegador.
  it.each([
    ['sin transcripción', [verified(UUID)]],
    ['en borrador', [verified(UUID), verified(UUID2, 'draft')]],
  ])('una petición %s → 409 transcript_unverified con sus ids, sin crear nada ni llamar al proveedor', async (_, transcripts) => {
    const fake = installNitro([[eligible(UUID), eligible(UUID2)], transcripts])
    const error = await expectStatus((await post({ groups: [[UUID, UUID2]] })).result, 409)
    expect(error.data).toEqual({ code: 'transcript_unverified', ids: [UUID2] })
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
    expect(ai.generatePrayerImage).not.toHaveBeenCalled()
    expect(ai.transcribePrayerPhoto).not.toHaveBeenCalled()
  })

  it('una petición que ya no está disponible manda sobre la verificación → 409 request_unavailable', async () => {
    const fake = installNitro([[eligible(UUID)], [verified(UUID)]])
    const error = await expectStatus((await post({ groups: [[UUID, UUID2]] })).result, 409)
    expect(error.data).toEqual({ code: 'request_unavailable', ids: [UUID2] })
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('el texto no viaja en el cuerpo: grupos con texto en vez de ids → 422', async () => {
    installNitro([])
    await expectStatus((await post({ groups: [[{ fileId: UUID, text: 'Texto colado' }]] })).result, 422)
  })

  it('exige sesión de equipo', async () => {
    installNitro([])
    await expectGuarded(await loadHandler(FILE), { method: 'POST', url: '/api/peticiones/generaciones', body: { groups: [[UUID]] } })
  })
})
