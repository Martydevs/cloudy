// Única superficie pública de la capa de IA (research A10). Solo la importan las capas de aplicación
// `server/utils/image-text.ts` (lectura del texto) y `server/utils/prayer-images.ts` (imágenes de peticiones, feature 007)
// como `#server/ai`; los demás archivos de `server/ai/` no se importan desde fuera de la carpeta.
export { createProviderBreaker } from './breaker'
export { extractImageText } from './image-text/extract'
export type { ExtractImageTextOptions, ImageTextErrorCode, ImageTextResult } from './image-text/extract'
export { imageSourceSchema } from './image-text/schemas'
export type { ModelImage } from './image-text/schemas'
export { generatePrayerImage } from './prayer-image/generate'
export type { GeneratePrayerImageOptions, PrayerImageErrorCode, PrayerImageResult } from './prayer-image/generate'
export { resolveImageTextModel, resolvePrayerImageModel } from './providers/openrouter'
export type { ProviderBreaker } from './breaker'
