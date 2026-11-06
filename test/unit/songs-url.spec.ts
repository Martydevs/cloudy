// T006 — Lectura del enlace pegado en Canciones (feature 006, research D6): normalización y motivo exacto de cada rechazo.
import { describe, expect, it } from 'vitest'
import { parseLetrasUrl } from '../../shared/validation/songs'

const NORMALIZED = { ok: true, url: 'https://letras.com/musiko/de-buenas-part-josh-gamez', artist: 'musiko', slug: 'de-buenas-part-josh-gamez' }

describe('parseLetrasUrl acepta y normaliza', () => {
  it.each([
    'https://www.letras.com/musiko/de-buenas-part-josh-gamez/',
    'https://letras.com/musiko/de-buenas-part-josh-gamez/',
    'https://www.letras.com/musiko/de-buenas-part-josh-gamez',
    'https://www.letras.com/musiko/de-buenas-part-josh-gamez/?utm_source=x',
    'https://www.letras.com/musiko/de-buenas-part-josh-gamez/#letra',
    '  https://www.letras.com/musiko/de-buenas-part-josh-gamez/  ',
    'https://WWW.Letras.com/Musiko/De-Buenas-Part-Josh-Gamez/',
    'https://letras.com:443/musiko/de-buenas-part-josh-gamez/',
  ])('%s', (url) => {
    expect(parseLetrasUrl(url)).toEqual(NORMALIZED)
  })

  it('acepta segmentos con números (canciones sin nombre amigable)', () => {
    expect(parseLetrasUrl('https://www.letras.com/musiko/2291817/')).toEqual({ ok: true, url: 'https://letras.com/musiko/2291817', artist: 'musiko', slug: '2291817' })
  })
})

describe('parseLetrasUrl rechaza con el motivo exacto', () => {
  it.each([
    ['', 'not_url'],
    ['   ', 'not_url'],
    ['hola', 'not_url'],
    ['letra de de buenas', 'not_url'],
    ['https://', 'not_url'],
    ['ftp://letras.com/a/b/', 'not_url'],
    ['javascript:alert(1)', 'not_url'],
    ['http://www.letras.com/a/b/', 'not_https'],
    ['www.letras.com/a/b/', 'not_https'],
    ['https://example.com/a/b', 'not_letras'],
    ['https://letras.com.otro.test/a/b/', 'not_letras'],
    ['https://evil-letras.com/a/b', 'not_letras'],
    ['https://letras.com@otro.test/a/b/', 'not_letras'],
    ['https://letras.com:8443/a/b/', 'not_letras'],
    ['https://user:pass@letras.com/a/b/', 'credentials'],
    ['https://user@www.letras.com/a/b/', 'credentials'],
    ['https://www.letras.com/', 'not_song'],
    ['https://www.letras.com/musiko/', 'not_song'],
    ['https://www.letras.com/a/b/c/', 'not_song'],
    ['https://www.letras.com/a_b/c/', 'not_song'],
    ['https://www.letras.com/a/b%20c/', 'not_song'],
  ] as const)('%s → %s', (url, reason) => {
    expect(parseLetrasUrl(url)).toEqual({ ok: false, reason })
  })

  it('un valor que no es texto no es un enlace', () => {
    expect(parseLetrasUrl(undefined)).toEqual({ ok: false, reason: 'not_url' })
    expect(parseLetrasUrl(42)).toEqual({ ok: false, reason: 'not_url' })
  })
})
