// Orden fijo de proveedores para leer imágenes: OpenAI principal y Gemini de respaldo (research A11).
// Un proveedor sin clave se omite sin llamarlo.
import type { JSONValue, LanguageModel } from 'ai'
import type { RuntimeConfig } from 'nuxt/schema'
import { googleClient, GEMINI_DEFAULT_MODEL } from './google'
import { openaiClient, OPENAI_DEFAULT_MODEL } from './openai'

export type ImageTextProvider = 'openai' | 'google'

export interface ImageTextCandidate {
  provider: ImageTextProvider
  model: LanguageModel
  /** Opciones de la llamada propias del proveedor (p. ej. la resolución de imagen de Gemini). */
  providerOptions?: Record<string, Record<string, JSONValue>>
}

export function resolveImageTextCandidates(config: RuntimeConfig): ImageTextCandidate[] {
  const candidates: ImageTextCandidate[] = []
  if (config.openaiApikey.trim()) {
    candidates.push({ provider: 'openai', model: openaiClient(config)(OPENAI_DEFAULT_MODEL) })
  }
  if (config.googleApikey.trim()) {
    candidates.push({
      provider: 'google',
      model: googleClient(config)(GEMINI_DEFAULT_MODEL),
      providerOptions: { google: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } },
    })
  }
  return candidates
}
