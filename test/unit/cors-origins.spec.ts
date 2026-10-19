import { describe, expect, it } from 'vitest'
import { corsOrigins, isAllowedOrigin, LOCAL_ORIGINS, parseExtraOrigins } from '../../scripts/cors-origins'

describe('isAllowedOrigin', () => {
  it('acepta https y http://localhost con o sin puerto, sin ruta', () => {
    for (const origin of ['https://cloudy.example.org', 'https://cloudy-git-main.vercel.app:8443', 'http://localhost', 'http://localhost:3000']) {
      expect(isAllowedOrigin(origin), origin).toBe(true)
    }
  })

  it('rechaza http remoto, rutas, consultas, barras finales y basura', () => {
    for (const value of ['http://cloudy.example.org', 'https://cloudy.example.org/', 'https://cloudy.example.org/enviar', 'https://cloudy.example.org?x=1', 'cloudy.example.org', 'ftp://localhost', 'https://', '']) {
      expect(isAllowedOrigin(value), value).toBe(false)
    }
  })
})

describe('parseExtraOrigins', () => {
  it('separa por comas, recorta e ignora entradas vacías', () => {
    expect(parseExtraOrigins(' https://a.example , https://b.example,, ')).toEqual(['https://a.example', 'https://b.example'])
    expect(parseExtraOrigins(undefined)).toEqual([])
    expect(parseExtraOrigins('')).toEqual([])
  })

  it('falla con la entrada inválida exacta', () => {
    expect(() => parseExtraOrigins('https://a.example, https://b.example/ruta')).toThrow('«https://b.example/ruta» no es un origen válido')
  })
})

describe('corsOrigins', () => {
  it('en producción: sitio y extras, sin locales y sin repetidos', () => {
    expect(corsOrigins({ appEnv: 'production', siteUrl: 'https://cloudy.example.org', extra: 'https://preview.example.org,https://cloudy.example.org' }))
      .toEqual(['https://cloudy.example.org', 'https://preview.example.org'])
  })

  it('fuera de producción agrega los puertos locales y tolera un sitio vacío', () => {
    expect(corsOrigins({ appEnv: 'development', siteUrl: 'http://localhost:3000' })).toEqual([...LOCAL_ORIGINS])
    expect(corsOrigins({ appEnv: 'test', siteUrl: '', extra: '' })).toEqual([...LOCAL_ORIGINS])
  })
})
