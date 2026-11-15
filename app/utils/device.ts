// Lectura de `navigator` para `isApplePlatform` (`shared/device.ts`). Solo en el navegador, al subir: en SSR responde false.
import { isApplePlatform } from '#shared/device'

export function isAppleDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return isApplePlatform({ userAgent: nav.userAgent, platform: nav.platform, uaDataPlatform: nav.userAgentData?.platform })
}
