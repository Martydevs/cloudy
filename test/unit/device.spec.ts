// ¿Dispositivo Apple? (`shared/device.ts`): tabla de user agents reales. Solo filtra la copia de vista previa de las
// HEIC, así que un error aquí nunca bloquea una subida; aun así, cada familia de navegadores tiene su fila.
import { describe, expect, it } from 'vitest'
import { isApplePlatform } from '../../shared/device'

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  ipadMobile: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ en modo escritorio: idéntico a Safari de macOS.
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
}

describe('isApplePlatform', () => {
  it.each([
    ['iPhone · Safari', { userAgent: UA.iphoneSafari, platform: 'iPhone' }],
    ['iPhone · Chrome', { userAgent: UA.iphoneChrome, platform: 'iPhone' }],
    ['iPad · Safari móvil', { userAgent: UA.ipadMobile, platform: 'iPad' }],
    ['iPad · Safari en modo escritorio (MacIntel)', { userAgent: UA.ipadDesktop, platform: 'MacIntel' }],
    ['Mac · Safari', { userAgent: UA.macSafari, platform: 'MacIntel' }],
    ['Mac · Chrome con Client Hints', { userAgent: UA.macChrome, platform: 'MacIntel', uaDataPlatform: 'macOS' }],
    ['Mac · Firefox', { userAgent: UA.macFirefox, platform: 'MacIntel' }],
    ['solo el user agent (sin navigator.platform)', { userAgent: UA.iphoneSafari }],
    ['solo navigator.platform', { platform: 'iPad' }],
  ])('%s → Apple', (_, hints) => {
    expect(isApplePlatform(hints)).toBe(true)
  })

  it.each([
    ['Windows · Chrome', { userAgent: UA.windowsChrome, platform: 'Win32', uaDataPlatform: 'Windows' }],
    ['Windows · Edge', { userAgent: UA.windowsEdge, platform: 'Win32' }],
    ['Android · Chrome', { userAgent: UA.androidChrome, platform: 'Linux armv81', uaDataPlatform: 'Android' }],
    ['Android · Samsung Internet', { userAgent: UA.androidSamsung, platform: 'Linux aarch64' }],
    ['Linux · Firefox', { userAgent: UA.linuxFirefox, platform: 'Linux x86_64' }],
    ['sin pistas', {}],
  ])('%s → no Apple', (_, hints) => {
    expect(isApplePlatform(hints)).toBe(false)
  })

  it('Client Hints manda sobre el user agent (que Chromium congela)', () => {
    expect(isApplePlatform({ userAgent: UA.macChrome, platform: 'MacIntel', uaDataPlatform: 'Windows' })).toBe(false)
    expect(isApplePlatform({ userAgent: UA.windowsChrome, uaDataPlatform: 'iOS' })).toBe(true)
  })
})
