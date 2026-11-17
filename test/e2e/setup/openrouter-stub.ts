// Stub local de la API de chat completions de OpenRouter para los e2e. La app de pruebas lo usa vía
// `NUXT_OPENROUTER_BASE_URL`; los e2e nunca llaman a OpenRouter. Sirve los dos casos de uso de IA, ambos de Peticiones:
// - Lectura de la foto de una petición (revisión antes de generar): se reconoce por su preset, responde el JSON
//   `{ hasText, text }` que pide la salida estructurada y se registra en `transcript`.
// - Generación de la imagen (feature 007): se reconoce por su preset o por `modalities` con `image`, responde
//   `message.images` con un PNG y se registra en `prayer`, con los textos que llegaron y las fotos (ya ninguna).
// El stub no descarga las fotos: solo guarda sus URLs. Cualquier otra llamada es un error de la prueba (400).
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Preset de la generación (`OPENROUTER_PRAY_REQUESTS_MODEL`). */
export const PRAYER_PRESET = '@preset/pray-requests-image-generation'
/** Preset de la lectura (`OPENROUTER_PRAY_TRANSCRIPTION_MODEL`). */
export const TRANSCRIPT_PRESET = '@preset/pray-requests-transcription'

/**
 * Escenarios, fijados por prueba con `/__stub/mode` (`setStubMode`), para todas las llamadas o solo para las que contienen
 * `match` (ver `StubMode.match`). Los dos primeros valen para la lectura y la generación:
 * - `sin-credito`: 402 (→ `quota_exceeded`).
 * - `clave-rechazada`: 401 «User not found.», como responde OpenRouter con una clave borrada (→ `not_configured`).
 * Solo la generación:
 * - `sin-imagen`: responde sin `images` (→ `invalid_output`).
 * - `lento`: espera `prayerDelayMs` antes de responder.
 * - `falla-una-vez`: 500 en las **dos** primeras llamadas afectadas (el AI SDK reintenta una vez solo, `maxRetries: 1`),
 *   así la página ve el fallo; el **Reintentar** de la persona ya responde bien.
 * Solo la lectura:
 * - `sin-texto`: el modelo dice que la foto no tiene texto legible (`hasText: false`).
 * - `lectura-falla`: 500 siempre (→ `provider`, con «Reintentar»).
 */
export const PRAYER_SCENARIOS = ['sin-imagen', 'sin-credito', 'clave-rechazada', 'lento', 'falla-una-vez', 'sin-texto', 'lectura-falla'] as const
export type PrayerScenario = typeof PRAYER_SCENARIOS[number]
/** Llamadas que fallan con `falla-una-vez` antes de responder bien. */
const FAIL_ONCE_CALLS = 2

/** Una llamada de generación tal como llegó al stub. */
export interface PrayerCall {
  model: string | null
  modalities: string[]
  /** La primera imagen es un `data:image/jpeg` (la plantilla). */
  template: boolean
  /** Imágenes después de la plantilla: la generación ya no manda fotos de invitados, así que debe ir vacío. */
  photos: string[]
  /** El texto de cada petición (lo que va entre las marcas `<peticion>`), en el orden en que llegó. */
  texts: string[]
  /** Todo el texto del mensaje de usuario (para afirmar que no viajan nombres ni notas). */
  prompt: string
  /** Estado HTTP con el que respondió el stub. */
  status: number
}

/** Una llamada de lectura tal como llegó al stub. */
export interface TranscriptCall {
  model: string | null
  /** URL de la foto: https firmada (el stub no la descarga); `null` si no llegó ninguna imagen. */
  photo: string | null
  /** Imágenes del mensaje: debe ser una sola. */
  images: number
  /** Pidió salida estructurada (`response_format` con esquema JSON). */
  structured: boolean
  /** Todo el texto del mensaje de usuario (para afirmar que no viajan nombres ni notas). */
  prompt: string
  /** El texto que respondió el stub; `null` si falló o dijo que no hay texto. */
  text: string | null
  /** Estado HTTP con el que respondió el stub. */
  status: number
}

export interface StubMode {
  /** Retraso de una generación con `lento`. */
  prayerDelayMs: number
  /** Retraso de cada lectura (0 = responde al instante). */
  transcriptDelayMs: number
  /** Texto que «lee» el stub; `null` = «Texto leído N», con N el número de lectura desde el último reinicio. */
  transcriptText: string | null
  /** Escenario activo; `null` = responde bien. */
  scenario: PrayerScenario | null
  /**
   * Si está, el escenario solo afecta a las lecturas cuya foto tiene este texto en su URL (p. ej. parte de su clave) y a
   * las generaciones que lo llevan en alguno de sus textos.
   */
  match: string | null
}

const DEFAULT_MODE: StubMode = { prayerDelayMs: 4000, transcriptDelayMs: 0, transcriptText: null, scenario: null, match: null }

export interface StubCalls {
  /** Generaciones de imágenes de peticiones, en orden de llegada. */
  prayer: PrayerCall[]
  /** Lecturas de fotos de peticiones, en orden de llegada. */
  transcript: TranscriptCall[]
}

const emptyCalls = (): StubCalls => ({ prayer: [], transcript: [] })

interface ChatBody {
  model?: unknown
  modalities?: unknown
  response_format?: { type?: unknown } | null
  messages?: { content?: unknown }[]
}

const isTranscription = (body: ChatBody | null) => body?.model === TRANSCRIPT_PRESET

const isGeneration = (body: ChatBody | null) =>
  body?.model === PRAYER_PRESET || (Array.isArray(body?.modalities) && body.modalities.includes('image'))

/** Textos e imágenes del mensaje de usuario (contenido en texto plano o en partes), en orden. */
function partsOf(body: ChatBody): { texts: string[], imageUrls: string[] } {
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
  return { texts, imageUrls }
}

const TEXT_BLOCK_RE = /^<peticion>\n([\s\S]*)\n<\/peticion>$/

function prayerCallOf(body: ChatBody): Omit<PrayerCall, 'status'> {
  const { texts, imageUrls } = partsOf(body)
  const template = imageUrls[0]?.startsWith('data:image/jpeg') ?? false
  return {
    model: typeof body.model === 'string' ? body.model : null,
    modalities: Array.isArray(body.modalities) ? body.modalities.filter((m): m is string => typeof m === 'string') : [],
    template,
    photos: template ? imageUrls.slice(1) : imageUrls,
    texts: texts.flatMap(text => TEXT_BLOCK_RE.exec(text)?.[1] ?? []),
    prompt: texts.join('\n'),
  }
}

function transcriptCallOf(body: ChatBody): Omit<TranscriptCall, 'status' | 'text'> {
  const { texts, imageUrls } = partsOf(body)
  return {
    model: typeof body.model === 'string' ? body.model : null,
    photo: imageUrls[0] ?? null,
    images: imageUrls.length,
    structured: body.response_format?.type === 'json_schema',
    prompt: texts.join('\n'),
  }
}

function completion(model: unknown, message: Record<string, unknown>) {
  return {
    id: `gen-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof model === 'string' ? model : 'stub',
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 1290, total_tokens: 2290 },
  }
}

const imageCompletion = (model: unknown, image: string | null) => completion(model, image
  ? { content: '', images: [{ type: 'image_url', image_url: { url: image } }] }
  : { content: 'No pude generar la imagen.' })

const transcriptCompletion = (model: unknown, text: string | null) =>
  completion(model, { content: JSON.stringify({ hasText: text !== null, text: text ?? '' }) })

export async function startAiStub(): Promise<{ url: string, close: () => Promise<void> }> {
  const png = `data:image/png;base64,${readFileSync(new URL('../../fixtures/files/imagen.png', import.meta.url)).toString('base64')}`
  let mode: StubMode = { ...DEFAULT_MODE }
  let calls: StubCalls = emptyCalls()
  /** Llamadas afectadas por `falla-una-vez` desde que se fijó el modo. */
  let failed = 0

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    const noCredit = () => json(402, { error: { code: 402, message: 'Insufficient credits' } })
    const rejected = () => json(401, { error: { code: 401, message: 'User not found.' } })
    const broken = () => json(500, { error: { code: 500, message: 'stub failure' } })

    if (req.method === 'POST' && req.url === '/__stub/mode') {
      mode = { ...DEFAULT_MODE, ...(raw ? JSON.parse(raw) as Partial<StubMode> : {}) }
      failed = 0
      return json(200, mode)
    }
    if (req.method === 'POST' && req.url === '/__stub/reset') {
      mode = { ...DEFAULT_MODE }
      calls = emptyCalls()
      failed = 0
      return json(200, calls)
    }
    if (req.method === 'GET' && req.url === '/__stub/calls') return json(200, calls)

    if (req.method === 'POST' && req.url?.startsWith('/chat/completions')) {
      const body = raw ? JSON.parse(raw) as ChatBody : null
      const { match } = mode

      if (body && isTranscription(body)) {
        const call = transcriptCallOf(body)
        const affected = match === null || (call.photo?.includes(match) ?? false)
        const has = (scenario: PrayerScenario) => affected && mode.scenario === scenario
        const record = (status: number, text: string | null = null) => calls.transcript.push({ ...call, status, text })
        if (mode.transcriptDelayMs > 0) await new Promise(r => setTimeout(r, mode.transcriptDelayMs))
        if (has('sin-credito')) {
          record(402)
          return noCredit()
        }
        if (has('clave-rechazada')) {
          record(401)
          return rejected()
        }
        if (has('lectura-falla')) {
          record(500)
          return broken()
        }
        const text = has('sin-texto') ? null : mode.transcriptText ?? `Texto leído ${calls.transcript.length + 1}`
        record(200, text)
        return json(200, transcriptCompletion(body.model, text))
      }

      if (body && isGeneration(body)) {
        const call = prayerCallOf(body)
        const affected = match === null || call.texts.some(text => text.includes(match))
        const has = (scenario: PrayerScenario) => affected && mode.scenario === scenario
        const record = (status: number) => calls.prayer.push({ ...call, status })
        if (has('lento')) await new Promise(r => setTimeout(r, mode.prayerDelayMs))
        if (has('sin-credito')) {
          record(402)
          return noCredit()
        }
        if (has('clave-rechazada')) {
          record(401)
          return rejected()
        }
        if (has('falla-una-vez') && failed < FAIL_ONCE_CALLS) {
          failed++
          record(500)
          return broken()
        }
        record(200)
        return json(200, imageCompletion(body.model, has('sin-imagen') ? null : png))
      }

      // No hay otro caso de uso: cualquier otra llamada es un error de la prueba.
      return json(400, { error: { code: 400, message: 'unexpected call: neither a transcription nor a generation' } })
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
