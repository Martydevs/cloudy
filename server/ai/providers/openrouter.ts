// Único proveedor de lectura de imágenes: OpenRouter con un preset que decide el modelo y el enrutado.
// Sin clave no hay modelo y no se llama a nadie.
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import type { RuntimeConfig } from 'nuxt/schema'

export const OPENROUTER_DEFAULT_MODEL = '@preset/image-content-extraction'

export function openrouterClient(config: RuntimeConfig) {
  return createOpenRouter({
    apiKey: config.openrouterApikey,
    // Vacío = API de OpenRouter; solo los e2e lo apuntan a un stub local.
    baseURL: config.openrouterBaseUrl || undefined,
  })
}

export function resolveImageTextModel(config: RuntimeConfig): LanguageModel | null {
  if (!config.openrouterApikey.trim()) return null
  return openrouterClient(config)(OPENROUTER_DEFAULT_MODEL)
}
