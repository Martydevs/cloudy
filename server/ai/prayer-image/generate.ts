// Generación de una imagen de peticiones con el AI SDK (feature 007, research D1; feature 008: el modelo lee las fotos):
// valida la entrada, hace una sola llamada a OpenRouter con la plantilla y las fotos de los invitados (URLs firmadas que
// OpenRouter descarga), toma la primera imagen de `result.files` y nunca lanza. Sin BD ni storage.
import type { LanguageModel } from 'ai'
import { generateText } from 'ai'
import { PRAYER_IMAGE_MAX_BYTES } from '#shared/constants/prayers'
import { classifyProviderError } from '../errors'
import { resolvePrayerImageModel } from '../providers/openrouter'
import { buildPrayerPrompt, photoLabel } from './prompt'
import type { PrayerImageErrorCode, PrayerPhotoInput } from './schemas'
import { prayerImageInputSchema } from './schemas'

export type { PrayerImageErrorCode, PrayerPhotoInput } from './schemas'

/** Cada intento de la llamada. */
const ATTEMPT_TIMEOUT_MS = 90_000
/** Tope duro de toda la generación, dentro del plazo de 120 s de la función. */
const HARD_CAP_MS = 105_000

export type PrayerImageResult =
  | { status: 'ready', mediaType: string, data: Uint8Array }
  | { status: 'failed', error: PrayerImageErrorCode }

export interface GeneratePrayerImageOptions {
  /** 1–4 fotos de peticiones (URL firmada https y formato), en el orden de la imagen. */
  photos: PrayerPhotoInput[]
  /** JPEG de la plantilla. */
  template: Uint8Array
  /** Por defecto, el de `useRuntimeConfig()`; `null` (sin clave) no llama a nadie. */
  model?: LanguageModel | null
  abortSignal?: AbortSignal
}

const fail = (error: PrayerImageErrorCode): PrayerImageResult => ({ status: 'failed', error })

export async function generatePrayerImage(options: GeneratePrayerImageOptions): Promise<PrayerImageResult> {
  const input = prayerImageInputSchema.safeParse({ photos: options.photos, template: options.template })
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
        // Instrucción, plantilla y cada foto precedida de su rótulo. Las fotos van como URL: el modelo de OpenRouter acepta
        // cualquier https (`resolvePrayerImageModel`), así que el AI SDK no las descarga y sus bytes no pasan por la función.
        content: [
          { type: 'text', text: buildPrayerPrompt(input.data.photos.length) },
          { type: 'file', mediaType: 'image/jpeg', data: input.data.template },
          ...input.data.photos.flatMap((photo, index) => [
            { type: 'text' as const, text: photoLabel(index + 1) },
            { type: 'file' as const, mediaType: photo.mediaType, data: new URL(photo.url) },
          ]),
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
    const { code, persistent } = classifyProviderError(error)
    // Clave revocada, sin permisos o preset inexistente: no es un fallo pasajero del servicio.
    return fail(persistent && code === 'provider' ? 'rejected' : code)
  }
}
