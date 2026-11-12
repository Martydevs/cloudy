// Stub local de la API de chat completions de OpenRouter para los e2e (feature 002, research A9). La app de
// pruebas lo usa vía `NUXT_OPENROUTER_BASE_URL`; los e2e nunca llaman a OpenRouter.
// Lectura de texto (feature 002): distingue las imágenes por sus bytes, que llegan tal como están en `test/fixtures/files/`.
// Generación de imágenes de peticiones (feature 007, research D15): se reconoce **antes** que la lectura (el preset o
// `modalities` con `image`), responde `message.images` con un PNG y se registra aparte (`prayer`), sin sumar a `total`.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Texto que el stub "lee" en las notas (y en cualquier imagen que no reconoce). */
export const NOTE_TEXT = 'Oremos por la familia Méndez\nGracias por el campamento'

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

/** Imágenes sin texto: el stub responde `hasText: false`. */
const EMPTY_FIXTURES = ['paisaje.jpg']
const KNOWN_FIXTURES = ['nota.jpg', 'nota.png', 'paisaje.jpg', 'foto.jpg', 'imagen.png']

export interface StubMode {
  /** Responde 500 a toda imagen (solo lectura de texto). */
  fail: boolean
  /** Retraso de cada respuesta, para observar "Leyendo texto…" (solo lectura de texto). */
  delayMs: number
  /** Retraso de una generación con `lento`. */
  prayerDelayMs: number
}

const DEFAULT_MODE: StubMode = { fail: false, delayMs: 0, prayerDelayMs: 4000 }

export interface StubCalls {
  /** Lecturas de texto (las generaciones no cuentan). */
  total: number
  /** Llamadas por fixture (`other` si no es ninguno conocido). */
  byImage: Record<string, number>
  /** Generaciones de imágenes de peticiones, en orden de llegada. */
  prayer: PrayerCall[]
}

const emptyCalls = (): StubCalls => ({ total: 0, byImage: {}, prayer: [] })

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

const hash = (data: Buffer | Uint8Array) => createHash('sha256').update(data).digest('hex')

function fixtureHashes(): Map<string, string> {
  const byHash = new Map<string, string>()
  for (const name of KNOWN_FIXTURES) {
    const path = new URL(`../../fixtures/files/${name}`, import.meta.url)
    if (existsSync(path)) byHash.set(hash(readFileSync(path)), name)
  }
  return byHash
}

/** La primera imagen del cuerpo de `POST /chat/completions` (`data:<mime>;base64,<bytes>`). */
function imageOf(body: unknown): Buffer | null {
  const text = JSON.stringify(body)
  const match = /data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/.exec(text)
  return match ? Buffer.from(match[1]!, 'base64') : null
}

function chatCompletion(model: unknown, output: { hasText: boolean, text: string }) {
  return {
    id: `gen-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof model === 'string' ? model : 'stub',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: JSON.stringify(output) },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  }
}

export async function startAiStub(): Promise<{ url: string, close: () => Promise<void> }> {
  const byHash = fixtureHashes()
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

      const image = imageOf(body)
      const name = image ? byHash.get(hash(image)) ?? 'other' : 'none'
      calls.total++
      calls.byImage[name] = (calls.byImage[name] ?? 0) + 1
      if (mode.delayMs > 0) await new Promise(r => setTimeout(r, mode.delayMs))
      if (mode.fail) return json(500, { error: { code: 500, message: 'stub failure' } })
      const empty = EMPTY_FIXTURES.includes(name)
      return json(200, chatCompletion(body?.model, empty ? { hasText: false, text: '' } : { hasText: true, text: NOTE_TEXT }))
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
