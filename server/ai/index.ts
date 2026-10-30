// Única superficie pública de la capa de IA (research A10). Solo la importa `server/utils/image-text.ts`
// como `#server/ai`; los demás archivos de `server/ai/` no se importan desde fuera de la carpeta.
export { createProviderBreaker } from './breaker'
export { extractImageText } from './image-text/extract'
export type { ExtractImageTextOptions, ImageTextErrorCode, ImageTextResult } from './image-text/extract'
export { imageSourceSchema } from './image-text/schemas'
export type { ModelImage } from './image-text/schemas'
export { resolveImageTextModel } from './providers/openrouter'
export type { ProviderBreaker } from './breaker'
