// ¿El navegador corre en un dispositivo Apple (iPhone, iPad, iPod, Mac)? Función pura sobre las pistas de
// `navigator` para probarla con una tabla de user agents reales; `app/utils/device.ts` la llama con el navegador.
// Solo sirve de filtro rápido para la conversión HEIC → JPEG (`app/utils/heic-to-jpeg.ts`): una respuesta
// equivocada nunca bloquea una subida, como mucho sube la HEIC sin convertir.

export interface DeviceHints {
  userAgent?: string
  /** `navigator.platform` (obsoleto pero aún presente en todos los navegadores). */
  platform?: string
  /** `navigator.userAgentData.platform` (Chromium): `macOS`, `iOS`, `Windows`, `Android`… */
  uaDataPlatform?: string
}

const APPLE_UA = /iPhone|iPad|iPod|Macintosh|Mac OS X/
const APPLE_PLATFORM = /^(iPhone|iPad|iPod|MacIntel|MacPPC|Mac68K|Macintosh)/

/**
 * iPadOS 13+ en modo escritorio se presenta como un Mac (`MacIntel`, UA de Macintosh): para esta pregunta da igual,
 * los dos son Apple, así que no hace falta mirar `maxTouchPoints` para distinguirlos.
 */
export function isApplePlatform({ userAgent = '', platform = '', uaDataPlatform = '' }: DeviceHints): boolean {
  // Client Hints, cuando existen, son la fuente más fiable (el UA de Chromium se congela).
  if (uaDataPlatform) return /^(macOS|iOS)$/i.test(uaDataPlatform)
  return APPLE_PLATFORM.test(platform) || APPLE_UA.test(userAgent)
}
