// Generación de una imagen de peticiones con el AI SDK (feature 007, research D1): valida la entrada, hace una sola llamada
// a OpenRouter con la plantilla y los textos, toma la primera imagen de `result.files` y nunca lanza. Sin BD ni storage.
import type { LanguageModel } from 'ai'
import { generateText } from 'ai'
import { PRAYER_IMAGE_MAX_BYTES } from '#shared/constants/prayers'
import { classifyProviderError } from '../errors'
import { resolvePrayerImageModel } from '../providers/openrouter'
import { buildPrayerPrompt } from './prompt'
import type { PrayerImageErrorCode } from './schemas'
import { prayerImageInputSchema } from './schemas'

export type { PrayerImageErrorCode } from './schemas'

/** Cada intento de la llamada. */
const ATTEMPT_TIMEOUT_MS = 90_000
/** Tope duro de toda la generación, dentro del plazo de 120 s de la función. */
const HARD_CAP_MS = 105_000

export type PrayerImageResult =
  | { status: 'ready', mediaType: string, data: Uint8Array }
  | { status: 'failed', error: PrayerImageErrorCode }

export interface GeneratePrayerImageOptions {
  /** 1–4 textos, en el orden de la imagen. */
  paragraphs: string[]
  /** JPEG de la plantilla. */
  template: Uint8Array
  /** Por defecto, el de `useRuntimeConfig()`; `null` (sin clave) no llama a nadie. */
  model?: LanguageModel | null
  abortSignal?: AbortSignal
}

const fail = (error: PrayerImageErrorCode): PrayerImageResult => ({ status: 'failed', error })

export async function generatePrayerImage(options: GeneratePrayerImageOptions): Promise<PrayerImageResult> {
  const input = prayerImageInputSchema.safeParse({ paragraphs: options.paragraphs, template: options.template })
  if (!input.success) return fail('invalid_input')

  const model = options.model === undefined ? resolvePrayerImageModel(useRuntimeConfig()) : options.model
  if (!model) return fail('provider')

  const cap = AbortSignal.timeout(HARD_CAP_MS)
  const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, cap]) : cap
  if (signal.aborted) return fail('timeout')

  try {
    const result = await generateText({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildPrayerPrompt(input.data.paragraphs) },
          { type: 'file', mediaType: 'image/jpeg', data: input.data.template },
        ],
      }],
      timeout: ATTEMPT_TIMEOUT_MS,
      maxRetries: 1,
      abortSignal: signal,
    })
    const image = result.files.find(file => file.mediaType.startsWith('image/'))
    if (!image) return fail('invalid_output')
    if (image.uint8Array.byteLength > PRAYER_IMAGE_MAX_BYTES) return fail('too_large')
    return { status: 'ready', mediaType: image.mediaType, data: image.uint8Array }
  }
  catch (error) {
    // El plazo del llamador o el tope de 105 s.
    if (signal.aborted) return fail('timeout')
    return fail(classifyProviderError(error).code)
  }
}
