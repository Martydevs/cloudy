// Única superficie pública de la capa de IA (research A10). Solo la importa la capa de aplicación
// `server/utils/prayer-images.ts` (imágenes de peticiones, feature 007) como `#server/ai`; los demás archivos de
// `server/ai/` no se importan desde fuera de la carpeta.
export { generatePrayerImage } from './prayer-image/generate'
export type { GeneratePrayerImageOptions, PrayerImageErrorCode, PrayerImageResult } from './prayer-image/generate'
export { resolvePrayerImageModel } from './providers/openrouter'
