// T044 — Capa de aplicación de las imágenes de peticiones (feature 007, contracts/api.md § 2; revisión antes de generar):
// elegibilidad, texto verificado que carga el servidor, plantilla, orden, privacidad y traducción de cada fallo a HTTP. La
// IA, la base y el almacenamiento están simulados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrayerPhoto } from '../../server/utils/prayer-requests'
import { expectStatus, installNitro, RUNTIME_CONFIG, UUID, UUID2 } from './helpers/nitro'

const ai = vi.hoisted(() => ({ generatePrayerImage: vi.fn() }))
vi.mock('#server/ai', async importOriginal => ({ ...await importOriginal<typeof import('#server/ai')>(), generatePrayerImage: ai.generatePrayerImage }))
const s3 = vi.hoisted(() => ({
  presignGet: vi.fn(async (key: string, _options?: unknown, _expiresIn?: number) => `https://bucket.test/${key}?X-Amz-Signature=f00`),
  head: vi.fn(async (_key: string): Promise<{ size: number } | null> => null),
  putObject: vi.fn(async (_key: string, _body: Uint8Array, _type: string) => {}),
}))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

const { createPrayerImage } = await import('../../server/utils/prayer-images')
const { resetPrayerTemplate } = await import('../../server/utils/prayer-template')

// Un JPEG mínimo con su trama SOF0: 1376 × 768 (16:9), como la plantilla real.
const TEMPLATE = new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x03, 0x00, 0x05, 0x60, 0x01, 0x01, 0x11, 0x00])
const TEMPLATE_KEY_RE = /^pre\/peticiones\/plantilla-[0-9a-f]{16}\.jpg$/
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
let info: ReturnType<typeof vi.spyOn>

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
  resetPrayerTemplate()
  for (const fn of Object.values(s3)) fn.mockClear()
  s3.head.mockResolvedValue(null)
  s3.putObject.mockResolvedValue(undefined)
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
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
      template: expect.any(URL),
      aspectRatio: '16:9',
      abortSignal: signal,
    })
    // Lo único que se firma es la copia de la plantilla: ninguna foto de invitado.
    expect(s3.presignGet).toHaveBeenCalledTimes(1)
    expect(s3.presignGet.mock.calls[0]![0]).toMatch(TEMPLATE_KEY_RE)
    expect(getItemRaw).toHaveBeenCalledWith('plantilla.jpg')
  })

  it('la plantilla viaja como URL firmada de 300 s de su copia en el bucket, que se sube una sola vez por instancia', async () => {
    install([row(UUID)])
    await createPrayerImage([UUID])
    expect(s3.head).toHaveBeenCalledTimes(1)
    expect(s3.putObject).toHaveBeenCalledTimes(1)
    const [objectKey, body, contentType] = s3.putObject.mock.calls[0]!
    expect(objectKey).toMatch(TEMPLATE_KEY_RE)
    expect(body).toEqual(TEMPLATE)
    expect(contentType).toBe('image/jpeg')
    expect(s3.presignGet).toHaveBeenCalledWith(objectKey, {}, 300)
    const template = ai.generatePrayerImage.mock.calls[0]![0].template as URL
    expect(template.href).toBe(`https://bucket.test/${objectKey}?X-Amz-Signature=f00`)

    // Segunda generación en la misma instancia: ni se relee el asset ni se vuelve a comprobar o subir la copia.
    install([row(UUID)])
    await createPrayerImage([UUID])
    expect(getItemRaw).not.toHaveBeenCalled()
    expect(s3.head).toHaveBeenCalledTimes(1)
    expect(s3.putObject).toHaveBeenCalledTimes(1)
    expect(s3.presignGet).toHaveBeenCalledTimes(2)
  })

  it('si la copia ya existe en el bucket no se vuelve a subir', async () => {
    s3.head.mockResolvedValue({ size: TEMPLATE.byteLength })
    install([row(UUID)])
    await createPrayerImage([UUID])
    expect(s3.putObject).not.toHaveBeenCalled()
    expect(ai.generatePrayerImage.mock.calls[0]![0].template).toBeInstanceOf(URL)
  })

  it.each([
    ['no se puede comprobar la copia', () => s3.head.mockRejectedValueOnce(new Error('S3 caído'))],
    ['no se puede subir la copia', () => s3.putObject.mockRejectedValueOnce(new Error('S3 caído'))],
    ['no se puede firmar la URL', () => s3.presignGet.mockRejectedValueOnce(new Error('sin credenciales'))],
    ['la URL firmada no es https', () => s3.presignGet.mockResolvedValueOnce('http://localhost:9000/b/plantilla.jpg')],
  ])('respaldo: si %s, la plantilla viaja en bytes y la imagen se genera igual', async (_, breakStorage) => {
    breakStorage()
    install([row(UUID)])
    expect(await createPrayerImage([UUID])).toMatchObject({ mediaType: 'image/png', count: 1 })
    expect(ai.generatePrayerImage.mock.calls[0]![0]).toMatchObject({ template: TEMPLATE, aspectRatio: '16:9' })
  })

  it('una plantilla sin encabezado legible no pide relación de aspecto', async () => {
    install([row(UUID)], undefined, { template: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]) })
    await createPrayerImage([UUID])
    expect(ai.generatePrayerImage.mock.calls[0]![0].aspectRatio).toBeNull()
  })

  it('mide cada llamada solo con números y códigos: duración, cómo viajó la plantilla, textos y peso de la imagen', async () => {
    install([row(UUID), row(UUID2)], [transcript(UUID, 'Por mi familia'), transcript(UUID2, 'Por mi trabajo')])
    await createPrayerImage([UUID, UUID2])
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]![0]).toMatch(/^\[prayer-image\] call status=ok ms=\d+ template=url texts=2 out=\d+KB$/)

    s3.presignGet.mockRejectedValueOnce(new Error('x'))
    install([row(UUID)], [transcript(UUID, 'Por mi familia')])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: 'timeout' })
    await createPrayerImage([UUID]).catch(() => {})
    expect(info.mock.calls[1]![0]).toMatch(/^\[prayer-image\] call status=failed ms=\d+ template=bytes:\d+KB texts=1$/)
    expect(info.mock.calls.flat().join(' ')).not.toMatch(/guest\/|https:|[0-9a-f]{8}-|familia|trabajo/)
  })

  it('al modelo solo llegan los textos y la plantilla: ni fotos, ni ids, ni claves del bucket', async () => {
    install([row(UUID)], [transcript(UUID, 'Por mi familia')])
    await createPrayerImage([UUID])
    const input = ai.generatePrayerImage.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(input).sort()).toEqual(['abortSignal', 'aspectRatio', 'template', 'texts'])
    expect((input.template as URL).href).not.toMatch(/guest\//)
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
    expect(s3.putObject.mock.calls[0]![1]).toEqual(TEMPLATE)
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
