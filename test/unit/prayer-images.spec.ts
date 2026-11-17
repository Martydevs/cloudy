// T044 — Capa de aplicación de las imágenes de peticiones (feature 007, contracts/api.md § 2; revisión antes de generar):
// elegibilidad, texto verificado que carga el servidor, plantilla, orden, privacidad y traducción de cada fallo a HTTP. La
// IA, la base y el almacenamiento están simulados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrayerPhoto } from '../../server/utils/prayer-requests'
import { expectStatus, installNitro, RUNTIME_CONFIG, UUID, UUID2 } from './helpers/nitro'

const ai = vi.hoisted(() => ({ generatePrayerImage: vi.fn() }))
vi.mock('#server/ai', async importOriginal => ({ ...await importOriginal<typeof import('#server/ai')>(), generatePrayerImage: ai.generatePrayerImage }))
const s3 = vi.hoisted(() => ({ presignGet: vi.fn(async (key: string) => `https://bucket.test/${key}?X-Amz-Signature=f00`) }))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => path, ...s3 }))

const { createPrayerImage } = await import('../../server/utils/prayer-images')

const TEMPLATE = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47])

/** La fila que devuelve `loadEligibleRequests`: sin nombre ni nota (nunca llegan a esta capa). */
const row = (id: string, changes: Partial<PrayerPhoto> = {}): PrayerPhoto => ({
  id, storageKey: `guest/s1/${id}`, previewKey: null, mimeType: 'image/jpeg',
  ...changes,
})
/** La fila que devuelve `loadVerifiedTexts`. */
const transcript = (fileId: string, text: string, status: 'draft' | 'verified' = 'verified') => ({ fileId, text, status })

let getItemRaw: ReturnType<typeof vi.fn>
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

/** Dos consultas, en este orden: las peticiones elegibles y sus transcripciones. */
function install(
  rows: PrayerPhoto[],
  transcripts: ReturnType<typeof transcript>[] = rows.map(r => transcript(r.id, `Texto de ${r.id.slice(0, 4)}`)),
  { apikey = 'sk-or-x', template = TEMPLATE as Uint8Array | null } = {},
) {
  getItemRaw = vi.fn(async () => template)
  return installNitro([rows, transcripts], {
    useRuntimeConfig: () => ({ ...RUNTIME_CONFIG, openrouterApikey: apikey }),
    useStorage: vi.fn(() => ({ getItemRaw })),
  })
}

beforeEach(() => {
  s3.presignGet.mockClear()
  ai.generatePrayerImage.mockReset()
  ai.generatePrayerImage.mockResolvedValue({ status: 'ready', mediaType: 'image/png', data: PNG })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createPrayerImage', () => {
  it('éxito: manda los textos verificados en el orden de la consulta (no el del navegador), con la plantilla y sin fotos', async () => {
    // La consulta de elegibles fija el orden; las transcripciones llegan en cualquiera.
    install([row(UUID2), row(UUID)], [transcript(UUID, 'Por mi trabajo'), transcript(UUID2, 'Por mi mamá\ny mi abuela')])
    const signal = new AbortController().signal
    const result = await createPrayerImage([UUID, UUID2], { abortSignal: signal })
    expect(result).toEqual({ mediaType: 'image/png', data: PNG, count: 2 })
    expect(ai.generatePrayerImage).toHaveBeenCalledWith({
      texts: ['Por mi mamá\ny mi abuela', 'Por mi trabajo'],
      template: TEMPLATE,
      abortSignal: signal,
    })
    // Ninguna foto se firma: al modelo de imágenes no le llega ninguna.
    expect(s3.presignGet).not.toHaveBeenCalled()
    expect(getItemRaw).toHaveBeenCalledWith('plantilla.jpg')
  })

  it('al modelo solo llegan los textos y la plantilla: ni fotos, ni ids, ni claves del bucket', async () => {
    install([row(UUID)], [transcript(UUID, 'Por mi familia')])
    await createPrayerImage([UUID])
    const input = ai.generatePrayerImage.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(input).sort()).toEqual(['abortSignal', 'template', 'texts'])
    expect(JSON.stringify(input.texts)).not.toMatch(/guest\/|https:|[0-9a-f]{8}-/)
  })

  it('carga las transcripciones de esos ids en una sola consulta', async () => {
    const fake = install([row(UUID), row(UUID2)])
    await createPrayerImage([UUID, UUID2])
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(2)
  })

  it('acepta la plantilla como ArrayBuffer', async () => {
    install([row(UUID)])
    getItemRaw.mockResolvedValue(TEMPLATE.buffer)
    await createPrayerImage([UUID])
    expect(ai.generatePrayerImage.mock.calls[0]![0].template).toEqual(TEMPLATE)
  })

  it('una petición que falta → 409 request_unavailable con sus ids, sin leer la plantilla ni llamar al modelo', async () => {
    install([row(UUID)])
    const err = await expectStatus(createPrayerImage([UUID, UUID2]), 409)
    expect(err.data).toEqual({ code: 'request_unavailable', ids: [UUID2] })
    expect(getItemRaw).not.toHaveBeenCalled()
    expect(ai.generatePrayerImage).not.toHaveBeenCalled()
  })

  // Regresión de la revisión antes de generar: sin texto verificado no se gasta crédito.
  it.each([
    ['sin transcripción', [transcript(UUID, 'Por mi familia')]],
    ['en borrador', [transcript(UUID, 'Por mi familia'), transcript(UUID2, 'Por mi trabajo', 'draft')]],
    ['verificada pero con el texto en blanco', [transcript(UUID, 'Por mi familia'), transcript(UUID2, '  \n ')]],
  ])('una petición %s → 409 transcript_unverified con sus ids y cero llamadas al proveedor', async (_, transcripts) => {
    install([row(UUID), row(UUID2)], transcripts)
    const err = await expectStatus(createPrayerImage([UUID, UUID2]), 409)
    expect(err.data).toEqual({ code: 'transcript_unverified', ids: [UUID2] })
    expect(err.message).toBe('Alguna petición no tiene su texto verificado. Vuelve a Peticiones, revisa el texto y márcalo como verificado.')
    expect(warn).toHaveBeenCalledWith('[prayer-image] transcript_unverified')
    expect(getItemRaw).not.toHaveBeenCalled()
    expect(ai.generatePrayerImage).not.toHaveBeenCalled()
  })

  it('usa el texto guardado en el momento de generar: uno vuelto a guardar mientras la imagen esperaba en la cola es el que viaja', async () => {
    install([row(UUID)], [transcript(UUID, 'Por mi famlia')])
    await createPrayerImage([UUID])
    install([row(UUID)], [transcript(UUID, 'Por mi familia')])
    await createPrayerImage([UUID])
    expect(ai.generatePrayerImage.mock.calls.map(call => call[0].texts)).toEqual([['Por mi famlia'], ['Por mi familia']])
  })

  it.each([
    ['sin clave', { apikey: '' }],
    ['clave en blanco', { apikey: '   ' }],
    ['sin plantilla', { template: null }],
    ['plantilla vacía', { template: new Uint8Array() }],
  ])('%s → 503 not_configured sin llamar al modelo', async (_, options) => {
    install([row(UUID)], undefined, options)
    const err = await expectStatus(createPrayerImage([UUID]), 503)
    expect(err.data).toEqual({ code: 'not_configured' })
    expect(err.message).toBe('La generación de imágenes no está configurada. Avisa a un administrador.')
    expect(ai.generatePrayerImage).not.toHaveBeenCalled()
  })

  it('la plantilla que no se puede leer cuenta como sin configurar', async () => {
    install([row(UUID)])
    getItemRaw.mockRejectedValue(new Error('sin asset'))
    await expectStatus(createPrayerImage([UUID]), 503)
  })

  it.each([
    ['quota_exceeded', 503, 'quota_exceeded'],
    ['rate_limited', 429, 'rate_limited'],
    ['provider', 502, 'provider'],
    ['invalid_output', 502, 'invalid_output'],
    ['too_large', 502, 'too_large'],
    ['timeout', 504, 'timeout'],
    ['invalid_input', 502, 'provider'],
    ['rejected', 503, 'not_configured'],
  ] as const)('fallo %s → %i %s', async (failure, status, code) => {
    install([row(UUID)])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: failure })
    const err = await expectStatus(createPrayerImage([UUID]), status)
    expect(err.data).toEqual({ code })
  })

  // Regresión: una clave borrada en OpenRouter llegaba al navegador como 502 `provider`, con «Reintentar».
  it('clave o preset rechazados por OpenRouter → 503 not_configured, sin reintento, registrado como error con el motivo', async () => {
    install([row(UUID)])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: 'rejected' })
    const err = await expectStatus(createPrayerImage([UUID]), 503)
    expect(err.data).toEqual({ code: 'not_configured' })
    expect(err.message).toBe('La generación de imágenes no está configurada. Avisa a un administrador.')
    expect(error).toHaveBeenCalledWith('[prayer-image] not_configured (OpenRouter rejected the key or preset)')
    expect(warn).not.toHaveBeenCalled()
  })

  it('los registros solo llevan [prayer-image] <código>: ni texto, ni claves, ni ids', async () => {
    install([row(UUID)], [transcript(UUID, 'Por mi familia')])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: 'provider' })
    await createPrayerImage([UUID]).catch(() => {})
    install([row(UUID)], [transcript(UUID, 'Por mi familia')])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: 'quota_exceeded' })
    await createPrayerImage([UUID]).catch(() => {})
    expect(warn).toHaveBeenCalledWith('[prayer-image] provider')
    expect(error).toHaveBeenCalledWith('[prayer-image] quota_exceeded')
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).not.toMatch(/guest\/|https:|[0-9a-f]{8}-|familia/)
  })
})
