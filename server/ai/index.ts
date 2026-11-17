// Única superficie pública de la capa de IA (research A10). Solo la importan las capas de aplicación de Peticiones como
// `#server/ai`: `server/utils/prayer-images.ts` (generar la imagen) y `server/utils/prayer-transcripts.ts` (leer la foto);
// los demás archivos de `server/ai/` no se importan desde fuera de la carpeta.
export { generatePrayerImage } from './prayer-image/generate'
export type { GeneratePrayerImageOptions, PrayerImageErrorCode, PrayerImageResult } from './prayer-image/generate'
export { transcribePrayerPhoto } from './prayer-transcript/transcribe'
export type { PrayerPhotoInput, PrayerTranscriptErrorCode, PrayerTranscriptResult, TranscribePrayerPhotoOptions } from './prayer-transcript/transcribe'
export { PRAYER_PHOTO_MEDIA_TYPES } from './prayer-transcript/schemas'
export { resolvePrayerImageModel, resolvePrayerTranscriptModel } from './providers/openrouter'
