// Capa de las transcripciones de Peticiones (revisión antes de generar): qué foto ve el modelo, reutilizar el texto
// guardado, `force`, que una lectura no pise lo que guardó una persona, el guardado con su sello de verificación, los textos
// verificados para generar y la traducción de cada fallo a HTTP. La IA, la base y el almacenamiento están simulados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrayerPhoto } from '../../server/utils/prayer-requests'
import { expectStatus, installNitro, RUNTIME_CONFIG, sqlText, UUID, UUID2 } from './helpers/nitro'

const ai = vi.hoisted(() => ({ transcribePrayerPhoto: vi.fn() }))
vi.mock('#server/ai', async importOriginal => ({ ...await importOriginal<typeof import('#server/ai')>(), transcribePrayerPhoto: ai.transcribePrayerPhoto }))
const s3 = vi.hoisted(() => ({ presignGet: vi.fn(async (key: string) => `https://bucket.test/${key}?X-Amz-Signature=f00`) }))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => path, ...s3 }))

const { listPrayerTranscripts, loadVerifiedTexts, photoSource, readPrayerTranscript, requireVerifiedTexts, savePrayerTranscript }
  = await import('../../server/utils/prayer-transcripts')

const me = { userId: 'u1', name: 'Ana', status: 'active' }
const AT = new Date('2026-11-17T10:00:00.000Z')

const photo = (id: string, changes: Partial<PrayerPhoto> = {}): PrayerPhoto => ({
  id, storageKey: `guest/s1/${id}`, previewKey: null, mimeType: 'image/jpeg',
  ...changes,
})

/** Una fila de `prayer_transcripts` tal como la devuelve `returning` o el listado (con quien verificó). */
const stored = (changes: Record<string, unknown> = {}) => ({
  fileId: UUID, text: 'Por mi familia', status: 'draft', origin: 'model', verifiedAt: null, verifiedBy: null, updatedAt: AT,
  verifierName: null, verifierStatus: null,
  ...changes,
})
const dto = (changes: Record<string, unknown> = {}) => ({
  fileId: UUID, text: 'Por mi familia', status: 'draft', origin: 'model', verifiedAt: null, verifiedBy: null, updatedAt: AT.toISOString(),
  ...changes,
})

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

const install = (results: unknown[], apikey = 'sk-or-x') =>
  installNitro(results, { useRuntimeConfig: () => ({ ...RUNTIME_CONFIG, openrouterApikey: apikey }) })

const call = (fake: ReturnType<typeof install>, method: string) => fake.calls.find(c => c.method === method)?.args[0] as Record<string, unknown>

beforeEach(() => {
  s3.presignGet.mockClear()
  ai.transcribePrayerPhoto.mockReset()
  ai.transcribePrayerPhoto.mockResolvedValue({ status: 'ready', hasText: true, text: 'Por mi familia' })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('photoSource', () => {
  it.each([
    ['la copia JPEG de una HEIC antigua, antes que el original', { previewKey: 'textsrc/a.jpg', mimeType: 'image/heic' }, { key: 'textsrc/a.jpg', mediaType: 'image/jpeg' }],
    ['la copia JPEG aunque el original sea legible', { previewKey: 'textsrc/a.jpg', mimeType: 'image/png' }, { key: 'textsrc/a.jpg', mediaType: 'image/jpeg' }],
    ['JPEG original', { mimeType: 'image/jpeg' }, { key: 'guest/s1/a', mediaType: 'image/jpeg' }],
    ['image/jpg se normaliza', { mimeType: 'image/jpg' }, { key: 'guest/s1/a', mediaType: 'image/jpeg' }],
    ['PNG original', { mimeType: 'image/png' }, { key: 'guest/s1/a', mediaType: 'image/png' }],
    ['WebP original', { mimeType: 'image/webp' }, { key: 'guest/s1/a', mediaType: 'image/webp' }],
    ['GIF original en mayúsculas', { mimeType: 'IMAGE/GIF' }, { key: 'guest/s1/a', mediaType: 'image/gif' }],
    ['HEIC sin copia', { mimeType: 'image/heic' }, null],
    ['HEIF sin copia', { mimeType: 'image/heif' }, null],
    ['SVG', { mimeType: 'image/svg+xml' }, null],
  ])('%s', (_, changes, expected) => {
    expect(photoSource({ storageKey: 'guest/s1/a', previewKey: null, mimeType: 'image/jpeg', ...changes })).toEqual(expected)
  })
})

describe('listPrayerTranscripts', () => {
  it('una consulta para todos los ids, con quien verificó; los que no tienen transcripción no aparecen', async () => {
    const fake = install([[
      stored(),
      stored({ fileId: UUID2, text: 'Por mi trabajo', status: 'verified', origin: 'manual', verifiedAt: AT, verifiedBy: 'u2', verifierName: 'Beto', verifierStatus: 'disabled' }),
    ]])
    expect(await listPrayerTranscripts([UUID, UUID2, '00000000-0000-4000-8000-000000000001'])).toEqual([
      dto(),
      dto({ fileId: UUID2, text: 'Por mi trabajo', status: 'verified', origin: 'manual', verifiedAt: AT.toISOString(), verifiedBy: { userId: 'u2', name: 'Beto', active: false } }),
    ])
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(1)
    expect(sqlText(call(fake, 'where'))).toContain('"prayer_transcripts"."file_id" in ($1, $2, $3)')
  })

  it('sin ids no consulta', async () => {
    const fake = install([])
    expect(await listPrayerTranscripts([])).toEqual([])
    expect(fake.calls).toHaveLength(0)
  })
})

describe('readPrayerTranscript', () => {
  it('con texto guardado y sin force lo devuelve sin comprobar nada ni llamar al modelo (no gasta crédito)', async () => {
    const fake = install([[stored({ status: 'verified', verifiedAt: AT, verifiedBy: 'u1', verifierName: 'Ana', verifierStatus: 'active' })]])
    expect(await readPrayerTranscript(UUID, { me })).toEqual(
      dto({ status: 'verified', verifiedAt: AT.toISOString(), verifiedBy: { userId: 'u1', name: 'Ana', active: true } }),
    )
    expect(ai.transcribePrayerPhoto).not.toHaveBeenCalled()
    expect(s3.presignGet).not.toHaveBeenCalled()
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('sin texto guardado: firma una URL corta de la foto, llama al modelo y guarda un borrador del modelo sin pisar nada', async () => {
    const fake = install([[], [photo(UUID, { mimeType: 'image/png' })], [stored()]])
    const signal = new AbortController().signal
    expect(await readPrayerTranscript(UUID, { me, abortSignal: signal })).toEqual(dto())
    expect(s3.presignGet).toHaveBeenCalledWith(`guest/s1/${UUID}`, {}, 300)
    expect(ai.transcribePrayerPhoto).toHaveBeenCalledWith({
      photo: { url: `https://bucket.test/guest/s1/${UUID}?X-Amz-Signature=f00`, mediaType: 'image/png' },
      abortSignal: signal,
    })
    expect(call(fake, 'values')).toMatchObject({ fileId: UUID, text: 'Por mi familia', status: 'draft', origin: 'model', verifiedBy: null, verifiedAt: null, updatedBy: 'u1' })
    expect(fake.calls.some(c => c.method === 'onConflictDoNothing')).toBe(true)
    expect(fake.calls.some(c => c.method === 'onConflictDoUpdate')).toBe(false)
  })

  it('al modelo solo llega la foto: ni ids sueltos, ni nombres, ni notas', async () => {
    install([[], [photo(UUID)], [stored()]])
    await readPrayerTranscript(UUID, { me })
    const input = ai.transcribePrayerPhoto.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(input).sort()).toEqual(['abortSignal', 'photo'])
    expect(Object.keys(input.photo as object).sort()).toEqual(['mediaType', 'url'])
  })

  it('lee la copia JPEG de una HEIC antigua', async () => {
    install([[], [photo(UUID, { previewKey: 'textsrc/a.jpg', mimeType: 'image/heic' })], [stored()]])
    await readPrayerTranscript(UUID, { me })
    expect(ai.transcribePrayerPhoto.mock.calls[0]![0].photo).toEqual({ url: 'https://bucket.test/textsrc/a.jpg?X-Amz-Signature=f00', mediaType: 'image/jpeg' })
  })

  it('el modelo no encontró texto → borrador vacío', async () => {
    ai.transcribePrayerPhoto.mockResolvedValue({ status: 'ready', hasText: false, text: '' })
    const fake = install([[], [photo(UUID)], [stored({ text: '' })]])
    expect(await readPrayerTranscript(UUID, { me })).toEqual(dto({ text: '' }))
    expect(call(fake, 'values')).toMatchObject({ text: '', status: 'draft', origin: 'model' })
  })

  it('un texto más largo que el tope se guarda recortado a 1000 caracteres', async () => {
    ai.transcribePrayerPhoto.mockResolvedValue({ status: 'ready', hasText: true, text: `${'a'.repeat(999)} bcd` })
    const fake = install([[], [photo(UUID)], [stored()]])
    await readPrayerTranscript(UUID, { me })
    expect(call(fake, 'values').text).toBe('a'.repeat(999))
  })

  it('force: no consulta lo guardado, vuelve a leer y reemplaza el texto por un borrador sin verificar', async () => {
    const fake = install([[photo(UUID)], [stored({ text: 'Por mi hermano' })]])
    ai.transcribePrayerPhoto.mockResolvedValue({ status: 'ready', hasText: true, text: 'Por mi hermano' })
    expect(await readPrayerTranscript(UUID, { force: true, me })).toEqual(dto({ text: 'Por mi hermano' }))
    expect(ai.transcribePrayerPhoto).toHaveBeenCalledTimes(1)
    const update = call(fake, 'onConflictDoUpdate') as { set: Record<string, unknown> }
    expect(update.set).toMatchObject({ text: 'Por mi hermano', status: 'draft', origin: 'model', verifiedBy: null, verifiedAt: null, updatedBy: 'u1' })
    expect(fake.calls.some(c => c.method === 'onConflictDoNothing')).toBe(false)
  })

  // Sin `force`, una lectura nunca pisa lo que alguien guardó (o verificó) mientras el modelo leía.
  it('si alguien guardó la transcripción mientras el modelo leía, vale la suya', async () => {
    const theirs = stored({ text: 'Por mi mamá', status: 'verified', origin: 'manual', verifiedAt: AT, verifiedBy: 'u2', verifierName: 'Beto', verifierStatus: 'active' })
    const fake = install([[], [photo(UUID)], [], [theirs]])
    expect(await readPrayerTranscript(UUID, { me })).toEqual(
      dto({ text: 'Por mi mamá', status: 'verified', origin: 'manual', verifiedAt: AT.toISOString(), verifiedBy: { userId: 'u2', name: 'Beto', active: true } }),
    )
    expect(fake.calls.some(c => c.method === 'onConflictDoUpdate')).toBe(false)
  })

  it('si la foto se purgó mientras el modelo leía → 409 request_unavailable', async () => {
    install([[], [photo(UUID)], [], []])
    const err = await expectStatus(readPrayerTranscript(UUID, { me }), 409)
    expect(err.data).toEqual({ code: 'request_unavailable', ids: [UUID] })
  })

  it('una petición que ya no está disponible → 409 request_unavailable sin firmar ni llamar al modelo', async () => {
    install([[], []])
    const err = await expectStatus(readPrayerTranscript(UUID, { me }), 409)
    expect(err.data).toEqual({ code: 'request_unavailable', ids: [UUID] })
    expect(s3.presignGet).not.toHaveBeenCalled()
    expect(ai.transcribePrayerPhoto).not.toHaveBeenCalled()
  })

  it('una HEIC sin copia JPEG → 422 unreadable_image con su id, sin firmar ni llamar al modelo', async () => {
    install([[], [photo(UUID, { mimeType: 'image/heic' })]])
    const err = await expectStatus(readPrayerTranscript(UUID, { me }), 422)
    expect(err.data).toEqual({ code: 'unreadable_image', ids: [UUID] })
    expect(warn).toHaveBeenCalledWith('[prayer-transcript] unreadable_image')
    expect(s3.presignGet).not.toHaveBeenCalled()
    expect(ai.transcribePrayerPhoto).not.toHaveBeenCalled()
  })

  it.each([[''], ['   ']])('sin clave (%j) → 503 not_configured sin firmar ni llamar al modelo', async (apikey) => {
    install([[], [photo(UUID)]], apikey)
    const err = await expectStatus(readPrayerTranscript(UUID, { me }), 503)
    expect(err.data).toEqual({ code: 'not_configured' })
    expect(error).toHaveBeenCalledWith('[prayer-transcript] not_configured')
    expect(s3.presignGet).not.toHaveBeenCalled()
    expect(ai.transcribePrayerPhoto).not.toHaveBeenCalled()
  })

  it.each([
    ['quota_exceeded', 503, 'quota_exceeded'],
    ['rate_limited', 429, 'rate_limited'],
    ['provider', 502, 'provider'],
    ['invalid_output', 502, 'invalid_output'],
    ['timeout', 504, 'timeout'],
    ['invalid_input', 502, 'provider'],
    ['rejected', 503, 'not_configured'],
  ] as const)('fallo %s → %i %s y no se guarda nada', async (failure, status, code) => {
    const fake = install([[], [photo(UUID)]])
    ai.transcribePrayerPhoto.mockResolvedValue({ status: 'failed', error: failure })
    const err = await expectStatus(readPrayerTranscript(UUID, { me }), status)
    expect(err.data).toEqual({ code })
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('los registros solo llevan [prayer-transcript] <código>: ni URLs, ni claves, ni ids', async () => {
    install([[], [photo(UUID)]])
    ai.transcribePrayerPhoto.mockResolvedValue({ status: 'failed', error: 'provider' })
    await readPrayerTranscript(UUID, { me }).catch(() => {})
    install([[], [photo(UUID)]])
    ai.transcribePrayerPhoto.mockResolvedValue({ status: 'failed', error: 'quota_exceeded' })
    await readPrayerTranscript(UUID, { me }).catch(() => {})
    install([[], [photo(UUID)]])
    ai.transcribePrayerPhoto.mockResolvedValue({ status: 'failed', error: 'rejected' })
    await readPrayerTranscript(UUID, { me }).catch(() => {})
    expect(warn).toHaveBeenCalledWith('[prayer-transcript] provider')
    expect(error).toHaveBeenCalledWith('[prayer-transcript] quota_exceeded')
    expect(error).toHaveBeenCalledWith('[prayer-transcript] not_configured (OpenRouter rejected the key or preset)')
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).not.toMatch(/guest\/|https:|[0-9a-f]{8}-/)
  })
})

describe('savePrayerTranscript', () => {
  it('verificada: guarda el texto y sella quién y cuándo la verificó', async () => {
    const fake = install([[photo(UUID)], [stored({ status: 'verified', origin: 'manual', verifiedAt: AT, verifiedBy: 'u1' })]])
    expect(await savePrayerTranscript(UUID, { text: 'Por mi familia', verified: true }, me)).toEqual(
      dto({ status: 'verified', origin: 'manual', verifiedAt: AT.toISOString(), verifiedBy: { userId: 'u1', name: 'Ana', active: true } }),
    )
    const values = call(fake, 'values')
    expect(values).toMatchObject({ fileId: UUID, text: 'Por mi familia', status: 'verified', origin: 'manual', verifiedBy: 'u1', updatedBy: 'u1' })
    expect(values.verifiedAt).toBeInstanceOf(Date)
    const update = call(fake, 'onConflictDoUpdate') as { set: Record<string, unknown> }
    expect(update.set).toMatchObject({ text: 'Por mi familia', status: 'verified', verifiedBy: 'u1', updatedBy: 'u1' })
    // Verificar el texto del modelo sin tocarlo no lo vuelve «manual»; si cambió, sí.
    expect(sqlText(update.set.origin)).toContain(`CASE WHEN "prayer_transcripts"."text" = excluded.text THEN "prayer_transcripts"."origin" ELSE 'manual' END`)
  })

  it('borrador (o quitar la verificación): limpia quién y cuándo', async () => {
    const fake = install([[photo(UUID)], [stored({ text: '', origin: 'manual' })]])
    expect(await savePrayerTranscript(UUID, { text: '', verified: false }, me)).toEqual(dto({ text: '', origin: 'manual' }))
    expect(call(fake, 'values')).toMatchObject({ text: '', status: 'draft', verifiedBy: null, verifiedAt: null })
    expect((call(fake, 'onConflictDoUpdate') as { set: Record<string, unknown> }).set).toMatchObject({ status: 'draft', verifiedBy: null, verifiedAt: null })
  })

  it('una petición que ya no está disponible → 409 request_unavailable sin guardar', async () => {
    const fake = install([[]])
    const err = await expectStatus(savePrayerTranscript(UUID, { text: 'Hola', verified: true }, me), 409)
    expect(err.data).toEqual({ code: 'request_unavailable', ids: [UUID] })
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })
})

describe('loadVerifiedTexts / requireVerifiedTexts', () => {
  const rows = [
    { fileId: UUID, text: 'Por mi familia', status: 'verified' },
    { fileId: UUID2, text: 'Por mi trabajo', status: 'draft' },
    { fileId: '00000000-0000-4000-8000-000000000002', text: '  ', status: 'verified' },
  ]
  const ids = [UUID, UUID2, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']

  it('solo cuentan las verificadas con texto: sin fila, en borrador o en blanco quedan sin verificar', async () => {
    const fake = install([rows])
    const { texts, unverified } = await loadVerifiedTexts(ids)
    expect([...texts]).toEqual([[UUID, 'Por mi familia']])
    expect(unverified).toEqual(ids.slice(1))
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(1)
  })

  it('sin ids no consulta', async () => {
    const fake = install([])
    expect(await loadVerifiedTexts([])).toEqual({ texts: new Map(), unverified: [] })
    expect(fake.calls).toHaveLength(0)
  })

  it('requireVerifiedTexts: todas verificadas → sus textos; si falta alguna → 409 transcript_unverified con sus ids', async () => {
    install([[rows[0]]])
    expect([...await requireVerifiedTexts([UUID])]).toEqual([[UUID, 'Por mi familia']])
    install([rows])
    const err = await expectStatus(requireVerifiedTexts(ids), 409)
    expect(err.data).toEqual({ code: 'transcript_unverified', ids: ids.slice(1) })
  })
})
