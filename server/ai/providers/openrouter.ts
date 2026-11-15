// Único proveedor de IA: OpenRouter con un preset por caso de uso (hoy solo la generación de las imágenes de
// peticiones) que decide el modelo y el enrutado. Sin clave no hay modelo y no se llama a nadie.
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import { wrapLanguageModel } from 'ai'
import type { RuntimeConfig } from 'nuxt/schema'

export const OPENROUTER_PRAY_REQUESTS_MODEL = '@preset/pray-requests-image-generation'

export function openrouterClient(config: RuntimeConfig) {
  return createOpenRouter({
    apiKey: config.openrouterApikey,
    // Vacío = API de OpenRouter; solo los e2e lo apuntan a un stub local.
    baseURL: config.openrouterBaseUrl || undefined,
  })
}

/**
 * URLs de imagen que el modelo recibe tal cual. `@openrouter/ai-sdk-provider` solo acepta las https que terminan en
 * `.jpg/.jpeg/.png/.gif/.webp` (antes de la query); con cualquier otra el AI SDK descargaría los bytes en la función y los
 * mandaría en base64. Las fotos de los invitados son URLs firmadas de claves sin extensión (`guest/<envío>/<uuid>`), así
 * que se aceptan todas las https y OpenRouter las descarga directo del bucket (feature 008).
 */
const PRAYER_IMAGE_URLS: Record<string, RegExp[]> = {
  'image/*': [/^data:image\/[a-zA-Z]+;base64,/, /^https:\/\/.+$/i],
}

/** Generación de imágenes de peticiones (feature 007): pide salida de imagen aunque el preset no la fije. */
export function resolvePrayerImageModel(config: RuntimeConfig): LanguageModel | null {
  if (!config.openrouterApikey.trim()) return null
  const model = openrouterClient(config)(OPENROUTER_PRAY_REQUESTS_MODEL, { extraBody: { modalities: ['image', 'text'] } })
  return wrapLanguageModel({
    model,
    middleware: { specificationVersion: 'v4', overrideSupportedUrls: () => PRAYER_IMAGE_URLS },
  })
}
