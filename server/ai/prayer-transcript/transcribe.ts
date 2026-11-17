// Lectura de la foto de una petición con el AI SDK (revisión antes de generar): valida la entrada, hace una sola llamada a
// OpenRouter con la foto como URL firmada (OpenRouter la descarga: sus bytes no pasan por la función), pide una salida
// estructurada `{ hasText, text }` y nunca lanza. Sin BD ni storage.
import type { LanguageModel } from 'ai'
import { generateText, Output } from 'ai'
import { classifyProviderError } from '../errors'
import { resolvePrayerTranscriptModel } from '../providers/openrouter'
import { buildTranscriptPrompt } from './prompt'
import type { PrayerPhotoInput, PrayerTranscriptErrorCode } from './schemas'
import { prayerPhotoSchema, prayerTranscriptOutputSchema } from './schemas'

export type { PrayerPhotoInput, PrayerTranscriptErrorCode } from './schemas'

/** Cada intento de la llamada. */
const ATTEMPT_TIMEOUT_MS = 30_000
/** Tope duro de toda la lectura, con su reintento. */
const HARD_CAP_MS = 45_000

export type PrayerTranscriptResult =
  /** `hasText: false` ⇒ `text` vacío: la foto no tiene texto legible. */
  | { status: 'ready', hasText: boolean, text: string }
  | { status: 'failed', error: PrayerTranscriptErrorCode }

export interface TranscribePrayerPhotoOptions {
  /** URL firmada https de la foto y su formato. */
  photo: PrayerPhotoInput
  /** Por defecto, el de `useRuntimeConfig()`; `null` (sin clave) no llama a nadie. */
  model?: LanguageModel | null
  abortSignal?: AbortSignal
}

const fail = (error: PrayerTranscriptErrorCode): PrayerTranscriptResult => ({ status: 'failed', error })

export async function transcribePrayerPhoto(options: TranscribePrayerPhotoOptions): Promise<PrayerTranscriptResult> {
  const photo = prayerPhotoSchema.safeParse(options.photo)
  if (!photo.success) return fail('invalid_input')

  const model = options.model === undefined ? resolvePrayerTranscriptModel(useRuntimeConfig()) : options.model
  if (!model) return fail('provider')

  const cap = AbortSignal.timeout(HARD_CAP_MS)
  const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, cap]) : cap
  if (signal.aborted) return fail('timeout')

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: prayerTranscriptOutputSchema }),
      messages: [{
        role: 'user',
        // La foto va como URL: el modelo de OpenRouter acepta cualquier https (`resolvePrayerTranscriptModel`), así que el
        // AI SDK no la descarga.
        content: [
          { type: 'text', text: buildTranscriptPrompt() },
          { type: 'file', mediaType: photo.data.mediaType, data: new URL(photo.data.url) },
        ],
      }],
      timeout: ATTEMPT_TIMEOUT_MS,
      maxRetries: 1,
      abortSignal: signal,
    })
    const text = result.output.hasText ? result.output.text.trim() : ''
    return { status: 'ready', hasText: text !== '', text }
  }
  catch (error) {
    // El plazo del llamador o el tope de 45 s.
    if (signal.aborted) return fail('timeout')
    const { code, persistent } = classifyProviderError(error)
    // Clave revocada, sin permisos o preset inexistente: no es un fallo pasajero del servicio.
    return fail(persistent && code === 'provider' ? 'rejected' : code)
  }
}
