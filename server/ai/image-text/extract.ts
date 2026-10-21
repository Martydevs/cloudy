// Lectura del texto de una imagen con el AI SDK (research A1, A11): valida la entrada, prueba los
// candidatos en orden (principal → respaldo), valida la salida y nunca lanza. Sin BD ni storage.
import { generateText, Output } from 'ai'
import type { ProviderBreaker } from '../breaker'
import { classifyProviderError } from '../errors'
import type { ClassifiedError, ProviderErrorCode } from '../errors'
import { resolveImageTextCandidates } from '../providers/candidates'
import type { ImageTextCandidate, ImageTextProvider } from '../providers/candidates'
import { IMAGE_EXTRACTION_INSTRUCTION, IMAGE_EXTRACTION_PROMPT } from './prompt'
import { imageTextOutputSchema, modelImageSchema } from './schemas'
import type { ModelImage } from './schemas'

/** Intento del principal cuando queda un respaldo: falla rápido y sin reintento. */
const PRIMARY_TIMEOUT_MS = 20_000
/** Intento del último candidato (o del único). */
const LAST_TIMEOUT_MS = 30_000
/** Tope duro de toda la lectura, sumados todos los intentos (FR-007). */
const HARD_CAP_MS = 45_000

export type ImageTextErrorCode = ProviderErrorCode | 'invalid_input'

export type ImageTextResult = (
  | { status: 'ready', text: string }
  | { status: 'empty' }
  | { status: 'failed', error: ImageTextErrorCode }
) & {
  /** Solo para tests y registro: no se persiste ni viaja al cliente. */
  usedProvider?: ImageTextProvider
}

export interface ExtractImageTextOptions {
  image: ModelImage
  /** Por defecto, los candidatos con clave de `useRuntimeConfig()`. */
  candidates?: ImageTextCandidate[]
  /** Cortacircuito de una ejecución del pool de invitados (research A6). */
  breaker?: ProviderBreaker
  /** Presupuesto del llamador; se combina con el tope de 45 s. */
  abortSignal?: AbortSignal
  /** Reintentos del último candidato (por defecto 1). */
  maxRetries?: number
}

const CONTENT_FILTER: ClassifiedError = { code: 'provider', fallback: true, persistent: false }

export async function extractImageText(options: ExtractImageTextOptions): Promise<ImageTextResult> {
  const image = modelImageSchema.safeParse(options.image)
  if (!image.success) return { status: 'failed', error: 'invalid_input' }

  const { breaker } = options
  const all = options.candidates ?? resolveImageTextCandidates(useRuntimeConfig())
  const candidates = breaker ? all.filter(c => !breaker.isOpen(c.provider)) : all
  if (candidates.length === 0) return { status: 'failed', error: 'provider' }

  const cap = AbortSignal.timeout(HARD_CAP_MS)
  const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, cap]) : cap

  let lastError: ImageTextErrorCode = 'provider'
  let quotaExceeded = false
  let usedProvider: ImageTextProvider | undefined

  for (const [index, candidate] of candidates.entries()) {
    const isLast = index === candidates.length - 1
    usedProvider = candidate.provider
    if (signal.aborted) return { status: 'failed', error: 'timeout', usedProvider }

    let failure: ClassifiedError
    try {
      const result = await generateText({
        model: candidate.model,
        providerOptions: candidate.providerOptions,
        instructions: IMAGE_EXTRACTION_INSTRUCTION,
        output: Output.object({ schema: imageTextOutputSchema }),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_EXTRACTION_PROMPT },
            {
              type: 'file',
              mediaType: image.data.mediaType,
              data: image.data.data,
              providerOptions: { openai: { imageDetail: 'high' } },
            },
          ],
        }],
        timeout: isLast ? LAST_TIMEOUT_MS : PRIMARY_TIMEOUT_MS,
        maxRetries: isLast ? options.maxRetries ?? 1 : 0,
        abortSignal: signal,
      })
      if (result.finishReason === 'content-filter') {
        failure = CONTENT_FILTER
      }
      else {
        breaker?.recordSuccess(candidate.provider)
        // Segunda pasada: el `refine` y el `trim` no los expresa el JSON Schema del proveedor (A3).
        const output = imageTextOutputSchema.safeParse(result.output)
        if (!output.success) return { status: 'failed', error: 'invalid_output', usedProvider }
        return output.data.hasText
          ? { status: 'ready', text: output.data.text, usedProvider }
          : { status: 'empty', usedProvider }
      }
    }
    catch (error) {
      // El presupuesto del llamador o el tope de 45 s: no queda tiempo para el respaldo.
      if (signal.aborted) return { status: 'failed', error: 'timeout', usedProvider }
      failure = classifyProviderError(error)
    }

    if (!failure.fallback) return { status: 'failed', error: failure.code, usedProvider }

    lastError = failure.code
    quotaExceeded ||= failure.code === 'quota_exceeded'
    if (breaker?.recordFailure(candidate.provider, failure.persistent)) {
      console.warn(`[image-text] breaker open ${candidate.provider} (${failure.code})`)
    }
    // Saldo agotado o clave rechazada piden acción de un administrador: se registran como error.
    const log = failure.persistent ? console.error : console.warn
    const next = candidates[index + 1]
    log(next
      ? `[image-text] fallback ${candidate.provider}→${next.provider} (${failure.code})`
      : `[image-text] ${candidate.provider} failed (${failure.code})`)
  }

  return { status: 'failed', error: quotaExceeded ? 'quota_exceeded' : lastError, usedProvider }
}
