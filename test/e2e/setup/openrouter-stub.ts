// Stub local de la API de chat completions de OpenRouter para los e2e (feature 002, research A9). La app de
// pruebas lo usa vía `NUXT_OPENROUTER_BASE_URL`; los e2e nunca llaman a OpenRouter.
// Distingue las imágenes por sus bytes: llegan tal como están en `test/fixtures/files/`.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Texto que el stub "lee" en las notas (y en cualquier imagen que no reconoce). */
export const NOTE_TEXT = 'Oremos por la familia Méndez\nGracias por el campamento'

/** Imágenes sin texto: el stub responde `hasText: false`. */
const EMPTY_FIXTURES = ['paisaje.jpg']
const KNOWN_FIXTURES = ['nota.jpg', 'nota.png', 'paisaje.jpg', 'foto.jpg', 'imagen.png']

export interface StubMode {
  /** Responde 500 a toda imagen. */
  fail: boolean
  /** Retraso de cada respuesta, para observar "Leyendo texto…". */
  delayMs: number
}

export interface StubCalls {
  total: number
  /** Llamadas por fixture (`other` si no es ninguno conocido). */
  byImage: Record<string, number>
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
  let mode: StubMode = { fail: false, delayMs: 0 }
  let calls: StubCalls = { total: 0, byImage: {} }

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    if (req.method === 'POST' && req.url === '/__stub/mode') {
      mode = { fail: false, delayMs: 0, ...(raw ? JSON.parse(raw) as Partial<StubMode> : {}) }
      return json(200, mode)
    }
    if (req.method === 'POST' && req.url === '/__stub/reset') {
      mode = { fail: false, delayMs: 0 }
      calls = { total: 0, byImage: {} }
      return json(200, calls)
    }
    if (req.method === 'GET' && req.url === '/__stub/calls') return json(200, calls)

    if (req.method === 'POST' && req.url?.startsWith('/chat/completions')) {
      const body = raw ? JSON.parse(raw) as { model?: unknown } : null
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
