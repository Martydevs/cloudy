// T044 — Capa de aplicación de las imágenes de peticiones (feature 007, contracts/api.md § 2; feature 008: el modelo lee las
// fotos): elegibilidad, qué foto ve el modelo, URLs firmadas, plantilla, orden, privacidad y traducción de cada fallo a
// HTTP. La IA, la base y el almacenamiento están simulados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrayerPhoto } from '../../server/utils/prayer-requests'
import { expectStatus, installNitro, RUNTIME_CONFIG, UUID, UUID2 } from './helpers/nitro'

const ai = vi.hoisted(() => ({ generatePrayerImage: vi.fn() }))
vi.mock('#server/ai', async importOriginal => ({ ...await importOriginal<typeof import('#server/ai')>(), generatePrayerImage: ai.generatePrayerImage }))
const s3 = vi.hoisted(() => ({ presignGet: vi.fn(async (key: string) => `https://bucket.test/${key}?X-Amz-Signature=f00`) }))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => path, ...s3 }))

const { createPrayerImage, photoSource } = await import('../../server/utils/prayer-images')

const TEMPLATE = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47])

/** La fila que devuelve `loadEligibleRequests`: sin nombre ni nota (nunca llegan a esta capa). */
const row = (id: string, changes: Partial<PrayerPhoto> = {}): PrayerPhoto => ({
  id, storageKey: `guest/s1/${id}`, previewKey: null, mimeType: 'image/jpeg',
  ...changes,
})
const signed = (key: string) => `https://bucket.test/${key}?X-Amz-Signature=f00`

let getItemRaw: ReturnType<typeof vi.fn>
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

function install(rows: PrayerPhoto[], { apikey = 'sk-or-x', template = TEMPLATE as Uint8Array | null } = {}) {
  getItemRaw = vi.fn(async () => template)
  return installNitro([rows], {
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

describe('createPrayerImage', () => {
  it('éxito: firma una URL corta por foto, en el orden de la consulta (no el del navegador), con la plantilla', async () => {
    install([row(UUID2, { previewKey: 'textsrc/b.jpg', mimeType: 'image/heic' }), row(UUID, { mimeType: 'image/png' })])
    const signal = new AbortController().signal
    // El navegador los manda al revés: el orden de las fotos lo fija la consulta.
    const result = await createPrayerImage([UUID, UUID2], { abortSignal: signal })
    expect(result).toEqual({ mediaType: 'image/png', data: PNG, count: 2 })
    expect(ai.generatePrayerImage).toHaveBeenCalledWith({
      photos: [
        { url: signed('textsrc/b.jpg'), mediaType: 'image/jpeg' },
        { url: signed(`guest/s1/${UUID}`), mediaType: 'image/png' },
      ],
      template: TEMPLATE,
      abortSignal: signal,
    })
    expect(s3.presignGet).toHaveBeenCalledWith('textsrc/b.jpg', {}, 600)
    expect(s3.presignGet).toHaveBeenCalledWith(`guest/s1/${UUID}`, {}, 600)
    expect(getItemRaw).toHaveBeenCalledWith('plantilla.jpg')
  })

  it('al modelo solo llegan las fotos y la plantilla: ni ids, ni nombres, ni notas (FR-022)', async () => {
    install([row(UUID)])
    await createPrayerImage([UUID])
    const input = ai.generatePrayerImage.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(input).sort()).toEqual(['abortSignal', 'photos', 'template'])
    expect(JSON.stringify(input.photos)).not.toMatch(/Ana|nota/)
  })

  it('acepta la plantilla como ArrayBuffer', async () => {
    install([row(UUID)], { template: TEMPLATE.buffer as unknown as Uint8Array })
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

  it('una HEIC sin copia JPEG → 422 unreadable_image con sus ids, sin firmar, leer la plantilla ni llamar al modelo', async () => {
    install([row(UUID), row(UUID2, { mimeType: 'image/heic' })])
    const err = await expectStatus(createPrayerImage([UUID, UUID2]), 422)
    expect(err.data).toEqual({ code: 'unreadable_image', ids: [UUID2] })
    expect(err.message).toBe('Alguna foto no se puede leer. Quítala de tu selección o pídele al invitado que la envíe de nuevo en JPG o PNG.')
    expect(warn).toHaveBeenCalledWith('[prayer-image] unreadable_image')
    expect(s3.presignGet).not.toHaveBeenCalled()
    expect(getItemRaw).not.toHaveBeenCalled()
    expect(ai.generatePrayerImage).not.toHaveBeenCalled()
  })

  it.each([
    ['sin clave', { apikey: '' }],
    ['clave en blanco', { apikey: '   ' }],
    ['sin plantilla', { template: null }],
    ['plantilla vacía', { template: new Uint8Array() }],
  ])('%s → 503 not_configured sin llamar al modelo', async (_, options) => {
    install([row(UUID)], options)
    const err = await expectStatus(createPrayerImage([UUID]), 503)
    expect(err.data).toEqual({ code: 'not_configured' })
    expect(err.message).toBe('La generación de imágenes no está configurada. Avisa a un administrador.')
    expect(s3.presignGet).not.toHaveBeenCalled()
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

  it('los registros solo llevan [prayer-image] <código>', async () => {
    install([row(UUID)])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: 'provider' })
    await createPrayerImage([UUID]).catch(() => {})
    install([row(UUID)])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: 'quota_exceeded' })
    await createPrayerImage([UUID]).catch(() => {})
    expect(warn).toHaveBeenCalledWith('[prayer-image] provider')
    expect(error).toHaveBeenCalledWith('[prayer-image] quota_exceeded')
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).not.toMatch(/guest\/|https:|[0-9a-f]{8}-/)
  })
})
