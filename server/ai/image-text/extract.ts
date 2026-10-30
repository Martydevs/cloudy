// Lectura del texto de una imagen con el AI SDK (research A1): valida la entrada, hace una sola llamada a
// OpenRouter, valida la salida y nunca lanza. Sin BD ni storage.
import { generateText, Output } from 'ai'
import type { LanguageModel } from 'ai'
import type { ProviderBreaker } from '../breaker'
import { classifyProviderError } from '../errors'
import type { ClassifiedError, ProviderErrorCode } from '../errors'
import { resolveImageTextModel } from '../providers/openrouter'
import { IMAGE_EXTRACTION_INSTRUCTION, IMAGE_EXTRACTION_PROMPT } from './prompt'
import { imageTextOutputSchema, modelImageSchema } from './schemas'
import type { ModelImage } from './schemas'

/** Cada intento de la llamada. */
const ATTEMPT_TIMEOUT_MS = 30_000
/** Tope duro de toda la lectura, sumados los reintentos (FR-007). */
const HARD_CAP_MS = 45_000

export type ImageTextErrorCode = ProviderErrorCode | 'invalid_input'

export type ImageTextResult =
  | { status: 'ready', text: string }
  | { status: 'empty' }
  | { status: 'failed', error: ImageTextErrorCode }

export interface ExtractImageTextOptions {
  image: ModelImage
  /** Por defecto, el de `useRuntimeConfig()`; `null` (sin clave) no llama a nadie. */
  model?: LanguageModel | null
  /** Cortacircuito de una ejecución del pool de invitados (research A6). */
  breaker?: ProviderBreaker
  /** Presupuesto del llamador; se combina con el tope de 45 s. */
  abortSignal?: AbortSignal
  /** Reintentos de la llamada (por defecto 1). */
  maxRetries?: number
}

const CONTENT_FILTER: ClassifiedError = { code: 'provider', persistent: false }

export async function extractImageText(options: ExtractImageTextOptions): Promise<ImageTextResult> {
  const image = modelImageSchema.safeParse(options.image)
  if (!image.success) return { status: 'failed', error: 'invalid_input' }

  const { breaker } = options
  const model = options.model === undefined ? resolveImageTextModel(useRuntimeConfig()) : options.model
  if (!model || breaker?.isOpen()) return { status: 'failed', error: 'provider' }

  const cap = AbortSignal.timeout(HARD_CAP_MS)
  const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, cap]) : cap
  if (signal.aborted) return { status: 'failed', error: 'timeout' }

  let failure: ClassifiedError
  try {
    const result = await generateText({
      model,
      instructions: IMAGE_EXTRACTION_INSTRUCTION,
      output: Output.object({ schema: imageTextOutputSchema }),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: IMAGE_EXTRACTION_PROMPT },
          { type: 'file', mediaType: image.data.mediaType, data: image.data.data },
        ],
      }],
      timeout: ATTEMPT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? 1,
      abortSignal: signal,
    })
    if (result.finishReason === 'content-filter') {
      failure = CONTENT_FILTER
    }
    else {
      breaker?.recordSuccess()
      // Segunda pasada: el `refine` y el `trim` no los expresa el JSON Schema del proveedor (A3).
      const output = imageTextOutputSchema.safeParse(result.output)
      if (!output.success) return { status: 'failed', error: 'invalid_output' }
      return output.data.hasText ? { status: 'ready', text: output.data.text } : { status: 'empty' }
    }
  }
  catch (error) {
    // El presupuesto del llamador o el tope de 45 s.
    if (signal.aborted) return { status: 'failed', error: 'timeout' }
    failure = classifyProviderError(error)
  }

  // Una salida fuera del esquema no dice nada de la salud del proveedor.
  if (failure.code !== 'invalid_output') {
    // Saldo agotado o clave rechazada piden acción de un administrador: se registran como error.
    const log = failure.persistent ? console.error : console.warn
    log(`[image-text] openrouter failed (${failure.code})`)
    if (breaker?.recordFailure(failure.persistent)) log(`[image-text] breaker open (${failure.code})`)
  }
  return { status: 'failed', error: failure.code }
}
