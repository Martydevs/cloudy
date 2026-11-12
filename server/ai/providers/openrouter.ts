// Único proveedor de IA: OpenRouter con un preset por caso de uso (lectura del texto de imágenes y generación de las
// imágenes de peticiones) que decide el modelo y el enrutado. Sin clave no hay modelo y no se llama a nadie.
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import type { RuntimeConfig } from 'nuxt/schema'

export const OPENROUTER_VISION_MODEL = '@preset/image-content-extraction'
export const OPENROUTER_PRAY_REQUESTS_MODEL = '@preset/pray-requests-image-generation'

export function openrouterClient(config: RuntimeConfig) {
  return createOpenRouter({
    apiKey: config.openrouterApikey,
    // Vacío = API de OpenRouter; solo los e2e lo apuntan a un stub local.
    baseURL: config.openrouterBaseUrl || undefined,
  })
}

export function resolveImageTextModel(config: RuntimeConfig): LanguageModel | null {
  if (!config.openrouterApikey.trim()) return null
  return openrouterClient(config)(OPENROUTER_VISION_MODEL)
}

/** Generación de imágenes de peticiones (feature 007): pide salida de imagen aunque el preset no la fije. */
export function resolvePrayerImageModel(config: RuntimeConfig): LanguageModel | null {
  if (!config.openrouterApikey.trim()) return null
  return openrouterClient(config)(OPENROUTER_PRAY_REQUESTS_MODEL, { extraBody: { modalities: ['image', 'text'] } })
}
