// Stub local de la API de chat completions de OpenRouter para los e2e. La app de pruebas lo usa vía
// `NUXT_OPENROUTER_BASE_URL`; los e2e nunca llaman a OpenRouter.
// Generación de imágenes de peticiones (feature 007, research D15): se reconoce por el preset o por `modalities` con
// `image`, responde `message.images` con un PNG y se registra en `prayer`. Es el único caso de uso de IA que queda.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Preset de la generación (`OPENROUTER_PRAY_REQUESTS_MODEL`). */
export const PRAYER_PRESET = '@preset/pray-requests-image-generation'

/**
 * Escenarios de la generación, por palabra clave en el texto de alguna petición:
 * - `sin-imagen`: responde sin `images` (→ `invalid_output`).
 * - `sin-credito`: 402 (→ `quota_exceeded`).
 * - `lento`: espera `prayerDelayMs` antes de responder.
 * - `falla-una-vez`: 500 en las **dos** primeras llamadas con ese texto (el AI SDK reintenta una vez solo, `maxRetries: 1`),
 *   así la página ve el fallo; el **Reintentar** de la persona ya responde bien.
 */
export const PRAYER_SCENARIOS = ['sin-imagen', 'sin-credito', 'lento', 'falla-una-vez'] as const
/** Llamadas que fallan con `falla-una-vez` antes de responder bien. */
const FAIL_ONCE_CALLS = 2

/** Una llamada de generación tal como llegó al stub. */
export interface PrayerCall {
  model: string | null
  modalities: string[]
  /** Llegó una parte `data:image/jpeg` (la plantilla). */
  template: boolean
  /** Etiquetas `<peticion …>` del prompt. */
  tags: number
  /** Texto de cada `<peticion>`, en orden. */
  texts: string[]
  /** Todo el texto del mensaje de usuario (para afirmar que no viajan nombres ni notas). */
  prompt: string
  /** Estado HTTP con el que respondió el stub. */
  status: number
}

export interface StubMode {
  /** Retraso de una generación con `lento`. */
  prayerDelayMs: number
}

const DEFAULT_MODE: StubMode = { prayerDelayMs: 4000 }

export interface StubCalls {
  /** Generaciones de imágenes de peticiones, en orden de llegada. */
  prayer: PrayerCall[]
}

const emptyCalls = (): StubCalls => ({ prayer: [] })

interface ChatBody {
  model?: unknown
  modalities?: unknown
  messages?: { content?: unknown }[]
}

const isGeneration = (body: ChatBody | null) =>
  body?.model === PRAYER_PRESET || (Array.isArray(body?.modalities) && body.modalities.includes('image'))

/** Texto e imágenes del mensaje de usuario (contenido en texto plano o en partes). */
function partsOf(body: ChatBody): { text: string, imageUrls: string[] } {
  const texts: string[] = []
  const imageUrls: string[] = []
  for (const message of body.messages ?? []) {
    const content = message.content
    if (typeof content === 'string') texts.push(content)
    else if (Array.isArray(content)) {
      for (const part of content as { type?: unknown, text?: unknown, image_url?: { url?: unknown } }[]) {
        if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
        if (part.type === 'image_url' && typeof part.image_url?.url === 'string') imageUrls.push(part.image_url.url)
      }
    }
  }
  return { text: texts.join('\n'), imageUrls }
}

function prayerCallOf(body: ChatBody): Omit<PrayerCall, 'status'> {
  const { text, imageUrls } = partsOf(body)
  const texts = [...text.matchAll(/<peticion\b[^>]*>([\s\S]*?)<\/peticion>/g)].map(match => match[1]!)
  return {
    model: typeof body.model === 'string' ? body.model : null,
    modalities: Array.isArray(body.modalities) ? body.modalities.filter((m): m is string => typeof m === 'string') : [],
    template: imageUrls.some(url => url.startsWith('data:image/jpeg')),
    tags: (text.match(/<peticion\b/g) ?? []).length,
    texts,
    prompt: text,
  }
}

function imageCompletion(model: unknown, image: string | null) {
  return {
    id: `gen-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof model === 'string' ? model : 'stub',
    choices: [{
      index: 0,
      message: image
        ? { role: 'assistant', content: '', images: [{ type: 'image_url', image_url: { url: image } }] }
        : { role: 'assistant', content: 'No pude generar la imagen.' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 1000, completion_tokens: 1290, total_tokens: 2290 },
  }
}

export async function startAiStub(): Promise<{ url: string, close: () => Promise<void> }> {
  const png = `data:image/png;base64,${readFileSync(new URL('../../fixtures/files/imagen.png', import.meta.url)).toString('base64')}`
  let mode: StubMode = { ...DEFAULT_MODE }
  let calls: StubCalls = emptyCalls()
  /** Llamadas vistas por prompt con `falla-una-vez`. */
  let failOnce = new Map<string, number>()

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    if (req.method === 'POST' && req.url === '/__stub/mode') {
      mode = { ...DEFAULT_MODE, ...(raw ? JSON.parse(raw) as Partial<StubMode> : {}) }
      return json(200, mode)
    }
    if (req.method === 'POST' && req.url === '/__stub/reset') {
      mode = { ...DEFAULT_MODE }
      calls = emptyCalls()
      failOnce = new Map()
      return json(200, calls)
    }
    if (req.method === 'GET' && req.url === '/__stub/calls') return json(200, calls)

    if (req.method === 'POST' && req.url?.startsWith('/chat/completions')) {
      const body = raw ? JSON.parse(raw) as ChatBody : null

      if (body && isGeneration(body)) {
        const call = prayerCallOf(body)
        const has = (keyword: typeof PRAYER_SCENARIOS[number]) => call.texts.some(text => text.includes(keyword))
        const record = (status: number) => calls.prayer.push({ ...call, status })
        if (has('lento')) await new Promise(r => setTimeout(r, mode.prayerDelayMs))
        if (has('sin-credito')) {
          record(402)
          return json(402, { error: { code: 402, message: 'Insufficient credits' } })
        }
        if (has('falla-una-vez')) {
          const seen = (failOnce.get(call.prompt) ?? 0) + 1
          failOnce.set(call.prompt, seen)
          if (seen <= FAIL_ONCE_CALLS) {
            record(500)
            return json(500, { error: { code: 500, message: 'stub failure' } })
          }
        }
        record(200)
        return json(200, imageCompletion(body.model, has('sin-imagen') ? null : png))
      }

      // Ya no hay otro caso de uso: cualquier otra llamada es un error de la prueba.
      return json(400, { error: { code: 400, message: 'unexpected non-generation call' } })
    }

    json(404, { error: { code: 404, message: 'not found' } })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}
