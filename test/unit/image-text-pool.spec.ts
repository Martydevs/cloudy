// Lectura en segundo plano de un envío de invitado (feature 002, research A6 y A7): pool de 4, reclamación
// por trabajador, presupuesto compartido, límite `guest-text` y cortacircuito por ejecución. Usa el
// `extractImageText` real con un `MockLanguageModelV4` en lugar de OpenRouter; el store y el storage se simulan.
import { readFileSync } from 'node:fs'
import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaimedImageText, ImageTextRow } from '../../server/utils/image-text-store'
import { UUID } from './helpers/nitro'

const JPEG = new Uint8Array(readFileSync(new URL('../fixtures/files/foto.jpg', import.meta.url)))

const s3 = vi.hoisted(() => ({ head: vi.fn(), readRange: vi.fn(), deleteMany: vi.fn() }))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

const timing = vi.hoisted(() => ({ remaining: undefined as number | undefined }))
vi.mock('../../server/utils/background', () => ({ remainingMs: () => timing.remaining, runInBackground: vi.fn() }))

const quota = vi.hoisted(() => ({ hit: vi.fn(async () => {}) }))
vi.mock('../../server/utils/rate-limit', () => ({ hitRateLimit: quota.hit }))

const store = vi.hoisted(() => ({
  rows: [] as ImageTextRow[],
  senderKey: 'remitente' as string | null,
  claimed: [] as string[],
  saved: new Map<string, unknown>(),
  released: [] as string[],
  listPendingSubmissionImages: vi.fn(),
  claimImageText: vi.fn(),
  saveImageTextResult: vi.fn(),
  releaseImageText: vi.fn(),
  markUnavailable: vi.fn(async () => {}),
  loadImageTextRow: vi.fn(),
  setTextSourceKey: vi.fn(),
}))
vi.mock('../../server/utils/image-text-store', () => store)

const openrouter = vi.hoisted(() => ({ model: null as unknown, resolve: vi.fn() }))
vi.mock('../../server/ai/providers/openrouter', () => ({ resolveImageTextModel: openrouter.resolve }))

const { readSubmissionImages } = await import('../../server/utils/image-text')

const USAGE = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
const reply = { content: [{ type: 'text' as const, text: '{"hasText":true,"text":"Oremos"}' }], finishReason: { unified: 'stop' as const, raw: 'stop' }, usage: USAGE, warnings: [] }

type Behavior = (options: { abortSignal?: AbortSignal }) => Promise<typeof reply>
const model = (behavior: Behavior = async () => reply) => new MockLanguageModelV4({ doGenerate: behavior as never })
const apiError = (statusCode: number, data?: unknown) =>
  new APICallError({ message: 'x', url: 'https://api.test', requestBodyValues: {}, statusCode, data, isRetryable: false })
const fails = (error: unknown): Behavior => async () => {
  throw error
}

const row = (n: number, changes: Partial<ImageTextRow> = {}): ImageTextRow => ({
  id: `${UUID.slice(0, -2)}${String(n).padStart(2, '0')}`, extension: 'jpg', category: 'image', sizeBytes: JPEG.byteLength,
  storageKey: `pre/guest/${n}`, textStatus: null, textContent: null, textError: null, textSourceKey: null, textAttempts: 0,
  textStartedAt: null, textReadAt: null, textEditedAt: null, editedByName: null, ...changes,
})

beforeEach(() => {
  vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApikey: 'sk-or', openrouterBaseUrl: '' }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  timing.remaining = undefined
  store.rows = [row(1), row(2), row(3)]
  store.senderKey = 'remitente'
  store.claimed = []
  store.saved = new Map()
  store.released = []
  store.listPendingSubmissionImages.mockImplementation(async () => ({ senderKey: store.senderKey, rows: store.rows }))
  store.claimImageText.mockImplementation(async ({ id }: { id: string }): Promise<ClaimedImageText> => {
    store.claimed.push(id)
    return { ...store.rows.find(r => r.id === id)!, textStatus: 'reading', claimedAt: `t-${id}` }
  })
  store.saveImageTextResult.mockImplementation(async ({ id }: { id: string }, _at: string, outcome: unknown) => {
    store.saved.set(id, outcome)
    return true
  })
  store.releaseImageText.mockImplementation(async ({ id }: { id: string }) => {
    store.released.push(id)
  })
  s3.readRange.mockResolvedValue(JPEG)
  quota.hit.mockReset()
  quota.hit.mockResolvedValue(undefined)
  openrouter.model = model()
  openrouter.resolve.mockReset()
  openrouter.resolve.mockImplementation(() => openrouter.model)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('readSubmissionImages', () => {
  it('lee solo las imágenes aptas del envío y guarda cada resultado', async () => {
    store.rows = [row(1), row(2, { extension: 'webp' }), row(3, { extension: 'heic' }), row(4, { extension: 'heic', textSourceKey: 'pre/textsrc/4.jpg' }), row(5, { sizeBytes: 6_000_000 })]
    await readSubmissionImages('s1')
    expect(store.listPendingSubmissionImages).toHaveBeenCalledWith('s1')
    expect(store.claimed).toEqual([row(1).id, row(4).id])
    expect([...store.saved.values()]).toEqual([{ status: 'ready', text: 'Oremos' }, { status: 'ready', text: 'Oremos' }])
  })

  it('nunca más de 4 a la vez; cada trabajador reclama justo antes de leer', async () => {
    store.rows = Array.from({ length: 10 }, (_, i) => row(i + 1))
    let active = 0
    let peak = 0
    const gates: (() => void)[] = []
    openrouter.model = model(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise<void>(resolve => gates.push(resolve))
      active--
      return reply
    })
    const run = readSubmissionImages('s1', { concurrency: 4 })
    await vi.waitFor(() => expect(gates).toHaveLength(4))
    // Las que ningún trabajador ha tomado siguen pendientes (sin reclamar).
    expect(store.claimed).toHaveLength(4)
    while (gates.length || active) {
      gates.shift()?.()
      await new Promise(r => setTimeout(r, 0))
    }
    await run
    expect(peak).toBe(4)
    expect(store.claimed).toHaveLength(10)
  })

  it('cada lectura recibe el mismo abortSignal del presupuesto y conserva los tiempos de extractImageText', async () => {
    const signals: (AbortSignal | undefined)[] = []
    openrouter.model = model(async ({ abortSignal }) => (signals.push(abortSignal), reply))
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await readSubmissionImages('s1', { budgetMs: 60_000 })
    expect(timeout).toHaveBeenCalledWith(60_000)
    // El presupuesto del pool solo se combina con el tope de 45 s y el intento de 30 s de cada lectura.
    expect(timeout.mock.calls.map(c => c[0]).filter(ms => ms !== 60_000 && ms !== 45_000 && ms !== 30_000)).toEqual([])
    expect(signals).toHaveLength(3)
  })

  it.each([
    [100_000, 85_000],
    [undefined, 240_000],
    [500_000, 240_000],
  ])('con remainingMs %s el presupuesto es %s', async (remaining, expected) => {
    timing.remaining = remaining
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await readSubmissionImages('s1')
    expect(timeout.mock.calls[0]![0]).toBe(expected)
  })

  it('sin presupuesto (<= 0) no lee nada y todo queda pendiente', async () => {
    timing.remaining = 10_000
    await readSubmissionImages('s1')
    await readSubmissionImages('s1', { budgetMs: 0 })
    expect(store.listPendingSubmissionImages).not.toHaveBeenCalled()
    expect(store.claimed).toEqual([])
  })

  it('al vencer el presupuesto aborta las lecturas en curso (timeout) y no inicia más', async () => {
    store.rows = Array.from({ length: 6 }, (_, i) => row(i + 1))
    openrouter.model = model(({ abortSignal }) => new Promise((_, reject) => {
      abortSignal?.addEventListener('abort', () => reject(abortSignal.reason))
    }))
    await readSubmissionImages('s1', { budgetMs: 30, concurrency: 4 })
    expect(store.claimed).toHaveLength(4)
    expect([...store.saved.values()]).toEqual(Array(4).fill({ status: 'failed', error: 'timeout' }))
  })

  it('el límite guest-text se consulta tras reclamar; excedido, la fila vuelve a pendiente sin error', async () => {
    quota.hit.mockResolvedValueOnce(undefined).mockRejectedValue(Object.assign(new Error('429'), { statusCode: 429 }))
    await expect(readSubmissionImages('s1', { concurrency: 1 })).resolves.toBeUndefined()
    expect(quota.hit).toHaveBeenCalledWith(null, 'guest-text:remitente', { limit: 20, windowSec: 3600 })
    expect(store.saved.size).toBe(1)
    expect(store.released).toEqual([row(2).id, row(3).id])
    expect(store.releaseImageText).toHaveBeenCalledWith({ table: 'guest_submission_files', id: row(2).id }, `t-${row(2).id}`)
  })

  it('si otro lector ya tomó la fila no se consume cupo', async () => {
    store.claimImageText.mockResolvedValue(null)
    await readSubmissionImages('s1')
    expect(quota.hit).not.toHaveBeenCalled()
  })

  it('al modelo solo llegan los bytes de la imagen, nunca nombre, nota ni IP (FR-019)', async () => {
    const primary = model()
    openrouter.model = primary
    store.rows = [row(1)]
    await readSubmissionImages('s1')
    const prompt = JSON.stringify(primary.doGenerateCalls[0]!.prompt)
    expect(prompt).not.toContain('remitente')
    expect(prompt).not.toContain('pre/guest')
    const user = primary.doGenerateCalls[0]!.prompt.find(m => m.role === 'user')!
    expect((user.content as { type: string }[]).map(p => p.type)).toEqual(['text', 'file'])
  })

  it('nunca lanza: fallos de BD, storage o del listado quedan registrados', async () => {
    store.claimImageText.mockRejectedValueOnce(new Error('BD caída'))
    s3.readRange.mockRejectedValueOnce(new Error('S3 caído'))
    await expect(readSubmissionImages('s1', { concurrency: 1 })).resolves.toBeUndefined()
    expect(store.saved.size).toBe(2)
    store.listPendingSubmissionImages.mockRejectedValue(new Error('BD caída'))
    await expect(readSubmissionImages('s1')).resolves.toBeUndefined()
  })
})

describe('readSubmissionImages · OpenRouter y cortacircuito por ejecución', () => {
  it('sin clave de OpenRouter no lee nada y todo queda pendiente', async () => {
    openrouter.model = null
    await readSubmissionImages('s1')
    expect(store.listPendingSubmissionImages).not.toHaveBeenCalled()
    expect(store.claimed).toEqual([])
    expect(store.saved.size).toBe(0)
  })

  it('resuelve el modelo una vez por ejecución y lo usa en cada lectura', async () => {
    const shared = model()
    openrouter.model = shared
    await readSubmissionImages('s1')
    expect(openrouter.resolve).toHaveBeenCalledOnce()
    expect(shared.doGenerateCalls).toHaveLength(3)
  })

  it('OpenRouter sin créditos (402) en la primera imagen → se llama una vez y el resto queda pendiente', async () => {
    const openrouterModel = model(fails(apiError(402, { error: { code: 402, message: 'Insufficient credits' } })))
    openrouter.model = openrouterModel
    store.rows = Array.from({ length: 5 }, (_, i) => row(i + 1))
    await readSubmissionImages('s1', { concurrency: 1 })
    expect(openrouterModel.doGenerateCalls).toHaveLength(1)
    expect(store.claimed).toEqual([row(1).id])
    expect(store.saved.get(row(1).id)).toEqual({ status: 'failed', error: 'quota_exceeded' })
    expect(store.saved.size).toBe(1)
  })

  it.each([401, 403, 404])('un %s lo abre al instante', async (status) => {
    const openrouterModel = model(fails(apiError(status)))
    openrouter.model = openrouterModel
    store.rows = Array.from({ length: 3 }, (_, i) => row(i + 1))
    await readSubmissionImages('s1', { concurrency: 1 })
    expect(openrouterModel.doGenerateCalls).toHaveLength(1)
    expect(store.claimed).toEqual([row(1).id])
  })

  it('3 timeouts seguidos lo abren; un éxito intermedio reinicia la cuenta', async () => {
    const outcomes = ['timeout', 'timeout', 'ok', 'timeout', 'timeout', 'timeout', 'never', 'never']
    let call = 0
    const openrouterModel = model(async () => {
      if (outcomes[call++] === 'ok') return reply
      throw new DOMException('timeout', 'TimeoutError')
    })
    openrouter.model = openrouterModel
    store.rows = Array.from({ length: 8 }, (_, i) => row(i + 1))
    await readSubmissionImages('s1', { concurrency: 1 })
    expect(openrouterModel.doGenerateCalls).toHaveLength(6)
    expect(store.claimed).toHaveLength(6)
    expect(store.saved.get(row(3).id)).toEqual({ status: 'ready', text: 'Oremos' })
  })

  it('una salida inválida no abre el cortacircuito', async () => {
    const bad = { ...reply, content: [{ type: 'text' as const, text: '{' }] }
    const openrouterModel = model(async () => bad)
    openrouter.model = openrouterModel
    store.rows = Array.from({ length: 4 }, (_, i) => row(i + 1))
    await readSubmissionImages('s1', { concurrency: 1 })
    expect(openrouterModel.doGenerateCalls).toHaveLength(4)
    expect([...store.saved.values()]).toEqual(Array(4).fill({ status: 'failed', error: 'invalid_output' }))
  })

  it('las lecturas ya en curso terminan aunque el cortacircuito se abra', async () => {
    let release!: () => void
    const slow = new Promise<void>(resolve => (release = resolve))
    let call = 0
    openrouter.model = model(async () => {
      // La primera lectura sigue en curso mientras la segunda abre el cortacircuito.
      if (call++ === 0) {
        await slow
        return reply
      }
      throw apiError(401)
    })
    store.rows = Array.from({ length: 4 }, (_, i) => row(i + 1))
    const run = readSubmissionImages('s1', { concurrency: 2 })
    await vi.waitFor(() => expect(store.saved.get(row(2).id)).toEqual({ status: 'failed', error: 'provider' }))
    release()
    await run
    expect(store.saved.get(row(1).id)).toEqual({ status: 'ready', text: 'Oremos' })
    expect(store.claimed).toEqual([row(1).id, row(2).id])
  })

  it('dos ejecuciones seguidas no comparten estado: la segunda vuelve a probar OpenRouter', async () => {
    const openrouterModel = model(fails(apiError(402)))
    openrouter.model = openrouterModel
    store.rows = [row(1), row(2)]
    await readSubmissionImages('s1', { concurrency: 1 })
    await readSubmissionImages('s2', { concurrency: 1 })
    expect(openrouterModel.doGenerateCalls).toHaveLength(2)
  })
})
