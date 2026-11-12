// T044 — Capa de aplicación de las imágenes de peticiones (feature 007, contracts/api.md § 2): elegibilidad, plantilla, orden
// de los párrafos, privacidad y traducción de cada fallo a HTTP. La IA, la base y el almacenamiento están simulados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrayerRow } from '../../server/utils/prayer-requests'
import { created, expectStatus, installNitro, RUNTIME_CONFIG, UUID, UUID2 } from './helpers/nitro'

const ai = vi.hoisted(() => ({ generatePrayerImage: vi.fn() }))
vi.mock('#server/ai', async importOriginal => ({ ...await importOriginal<typeof import('#server/ai')>(), generatePrayerImage: ai.generatePrayerImage }))

const { createPrayerImage } = await import('../../server/utils/prayer-images')

const TEMPLATE = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47])

const row = (id: string, text: string, changes: Partial<PrayerRow> = {}): PrayerRow => ({
  id, name: 'x.jpg', senderName: 'Ana Secreta', note: 'nota privada', sentAt: created, approvedAt: created,
  textStatus: 'ready', textContent: text, textError: null, textStartedAt: null, textReadAt: created, textEditedAt: null, editedByName: null,
  ...changes,
})

let getItemRaw: ReturnType<typeof vi.fn>
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

function install(rows: PrayerRow[], { apikey = 'sk-or-x', template = TEMPLATE as Uint8Array | null } = {}) {
  getItemRaw = vi.fn(async () => template)
  return installNitro([rows], {
    useRuntimeConfig: () => ({ ...RUNTIME_CONFIG, openrouterApikey: apikey }),
    useStorage: vi.fn(() => ({ getItemRaw })),
  })
}

beforeEach(() => {
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
  it('éxito: pasa solo los textos recortados, en el orden de la consulta, con la plantilla', async () => {
    install([row(UUID2, '  Primera  '), row(UUID, 'Segunda\n')])
    const signal = new AbortController().signal
    const result = await createPrayerImage([UUID, UUID2], { abortSignal: signal })
    expect(result).toEqual({ mediaType: 'image/png', data: PNG, count: 2 })
    expect(ai.generatePrayerImage).toHaveBeenCalledWith({ paragraphs: ['Primera', 'Segunda'], template: TEMPLATE, abortSignal: signal })
    const sent = JSON.stringify(ai.generatePrayerImage.mock.calls[0]![0].paragraphs)
    expect(sent).not.toContain('Ana Secreta')
    expect(sent).not.toContain('nota privada')
    expect(getItemRaw).toHaveBeenCalledWith('plantilla.jpg')
  })

  it('acepta la plantilla como ArrayBuffer', async () => {
    install([row(UUID, 'a')], { template: TEMPLATE.buffer as unknown as Uint8Array })
    await createPrayerImage([UUID])
    expect(ai.generatePrayerImage.mock.calls[0]![0].template).toEqual(TEMPLATE)
  })

  it('una petición que falta → 409 request_unavailable con sus ids, sin leer la plantilla ni llamar al modelo', async () => {
    install([row(UUID, 'a')])
    const err = await expectStatus(createPrayerImage([UUID, UUID2]), 409)
    expect(err.data).toEqual({ code: 'request_unavailable', ids: [UUID2] })
    expect(getItemRaw).not.toHaveBeenCalled()
    expect(ai.generatePrayerImage).not.toHaveBeenCalled()
  })

  it.each([
    ['sin clave', { apikey: '' }],
    ['clave en blanco', { apikey: '   ' }],
    ['sin plantilla', { template: null }],
    ['plantilla vacía', { template: new Uint8Array() }],
  ])('%s → 503 not_configured sin llamar al modelo', async (_, options) => {
    install([row(UUID, 'a')], options)
    const err = await expectStatus(createPrayerImage([UUID]), 503)
    expect(err.data).toEqual({ code: 'not_configured' })
    expect(err.message).toBe('La generación de imágenes no está configurada. Avisa a un administrador.')
    expect(ai.generatePrayerImage).not.toHaveBeenCalled()
  })

  it('la plantilla que no se puede leer cuenta como sin configurar', async () => {
    install([row(UUID, 'a')])
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
  ] as const)('fallo %s → %i %s', async (failure, status, code) => {
    install([row(UUID, 'a')])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: failure })
    const err = await expectStatus(createPrayerImage([UUID]), status)
    expect(err.data).toEqual({ code })
  })

  it('los registros solo llevan [prayer-image] <código>', async () => {
    install([row(UUID, 'Oremos por Ana')])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: 'provider' })
    await createPrayerImage([UUID]).catch(() => {})
    install([row(UUID, 'Oremos por Ana')])
    ai.generatePrayerImage.mockResolvedValue({ status: 'failed', error: 'quota_exceeded' })
    await createPrayerImage([UUID]).catch(() => {})
    expect(warn).toHaveBeenCalledWith('[prayer-image] provider')
    expect(error).toHaveBeenCalledWith('[prayer-image] quota_exceeded')
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).not.toMatch(/Oremos|Ana/)
  })
})
