// T007 — Constantes y validadores compartidos de Canciones (feature 006, data-model.md § Validadores y § Constantes).
import { describe, expect, it } from 'vitest'
import {
  LYRICS_MAX_CHARS,
  LYRICS_MAX_LINES,
  SONG_ARTIST_MAX,
  SONG_COLLECTION_NAME_MAX,
  SONG_ERROR_CODES,
  SONG_ERROR_MESSAGES,
  SONG_FONT_COLOR,
  SONG_HISTORY_MAX_LIMIT,
  SONG_HISTORY_PAGE,
  SONG_PRESENTATION_TIMEOUT_MS,
  SONG_RECENT_LIMIT,
  SONG_SERVICE_MESSAGES,
  SONG_TITLE_MAX,
  SONG_URL_MESSAGES,
} from '../../shared/constants/songs'
import {
  songCollectionInput,
  songCollectionItemInput,
  songCollectionRename,
  songHistoryQuery,
  songUrlInput,
} from '../../shared/validation/songs'

const UUID = '0b6c2f1e-3a2b-4c5d-8e9f-001122334455'

describe('constantes', () => {
  it('límites del servicio y de la interfaz', () => {
    expect(LYRICS_MAX_LINES).toBe(300)
    expect(LYRICS_MAX_CHARS).toBe(500_000)
    expect(SONG_TITLE_MAX).toBe(200)
    expect(SONG_ARTIST_MAX).toBe(200)
    expect(SONG_COLLECTION_NAME_MAX).toBe(80)
    expect(SONG_HISTORY_PAGE).toBe(24)
    expect(SONG_HISTORY_MAX_LIMIT).toBe(48)
    expect(SONG_RECENT_LIMIT).toBe(12)
    expect(SONG_FONT_COLOR).toBe('FFFFFF')
    expect(SONG_PRESENTATION_TIMEOUT_MS).toBe(90_000)
  })

  it('cada código de error tiene un texto en español', () => {
    expect(SONG_ERROR_CODES).toEqual(['not_configured', 'misconfigured', 'quota', 'busy', 'crawl_failed', 'no_lyrics', 'lyrics_too_long', 'waking', 'invalid'])
    for (const code of SONG_ERROR_CODES) {
      expect(SONG_ERROR_MESSAGES[code], code).toMatch(/\S/)
      expect(SONG_ERROR_MESSAGES[code], code).not.toMatch(/\b(error|failed|not found)\b/i)
    }
    expect(SONG_ERROR_MESSAGES.no_lyrics).toBe('No encontramos una letra en ese enlace.')
    expect(SONG_ERROR_MESSAGES.crawl_failed).toBe('No pudimos leer la página de la canción. Intenta de nuevo en un momento.')
    expect(SONG_ERROR_MESSAGES.quota).toBe('Se agotó el crédito del servicio de rastreo. Avisa a un administrador.')
    expect(SONG_ERROR_MESSAGES.not_configured).toBe('El rastreo de letras no está configurado. Avisa a un administrador.')
    expect(SONG_ERROR_MESSAGES.lyrics_too_long).toBe('Eso no parece una canción: la letra pasa de 300 líneas.')
  })

  it('cada motivo de rechazo del enlace dice qué hacer', () => {
    expect(Object.keys(SONG_URL_MESSAGES).sort()).toEqual(['credentials', 'not_https', 'not_letras', 'not_song', 'not_url'])
    expect(SONG_URL_MESSAGES.not_https).toBe('Pega un enlace que empiece con https://, por ejemplo https://www.letras.com/artista/cancion/')
    expect(SONG_URL_MESSAGES.not_letras).toBe('Solo aceptamos enlaces de Letras.com (letras.com o www.letras.com).')
    expect(SONG_URL_MESSAGES.not_song).toBe('Ese enlace no es de una canción. Abre la canción en Letras.com y copia su enlace.')
    expect(SONG_URL_MESSAGES.credentials).toBe('Ese enlace no es válido. Cópialo de nuevo desde Letras.com.')
    expect(SONG_URL_MESSAGES.not_url).toMatch(/letras\.com/)
  })

  it('los textos del servicio de presentaciones', () => {
    expect(SONG_SERVICE_MESSAGES.noLyrics).toBe('La letra guardada no tiene contenido. Vuelve a obtenerla.')
    expect(SONG_SERVICE_MESSAGES.tooLong).toBe(SONG_ERROR_MESSAGES.lyrics_too_long)
    for (const text of Object.values(SONG_SERVICE_MESSAGES)) expect(text).toMatch(/\S/)
  })
})

describe('songUrlInput', () => {
  it('exige un texto de hasta 2048 caracteres', () => {
    expect(songUrlInput({ url: ' https://letras.com/a/b ' })).toEqual({ ok: true, data: { url: 'https://letras.com/a/b' } })
    expect(songUrlInput({})).toMatchObject({ ok: false })
    expect(songUrlInput({ url: 'x'.repeat(2049) })).toMatchObject({ ok: false })
  })
})

describe('songCollectionInput', () => {
  it('acepta un nombre recortado de 1–80 y una canción opcional', () => {
    expect(songCollectionInput({ name: '  Domingo  ' })).toEqual({ ok: true, data: { name: 'Domingo', songId: undefined } })
    expect(songCollectionInput({ name: 'a'.repeat(80), songId: UUID })).toEqual({ ok: true, data: { name: 'a'.repeat(80), songId: UUID } })
  })

  it('rechaza vacío, solo espacios, 81 caracteres y un songId que no es UUID', () => {
    expect(songCollectionInput({ name: '' })).toEqual({ ok: false, errors: { name: 'Este campo es obligatorio' } })
    expect(songCollectionInput({ name: '   ' })).toEqual({ ok: false, errors: { name: 'Este campo es obligatorio' } })
    expect(songCollectionInput({ name: 'a'.repeat(81) })).toEqual({ ok: false, errors: { name: 'Debe tener como máximo 80 caracteres' } })
    expect(songCollectionInput({ name: 'Domingo', songId: 'no' })).toEqual({ ok: false, errors: { songId: 'Identificador no válido' } })
  })
})

describe('songCollectionRename y songCollectionItemInput', () => {
  it('renombrar valida el nombre igual que crear', () => {
    expect(songCollectionRename({ name: ' Ensayo ' })).toEqual({ ok: true, data: { name: 'Ensayo' } })
    expect(songCollectionRename({ name: 'a'.repeat(81) })).toMatchObject({ ok: false })
  })

  it('agregar exige un UUID', () => {
    expect(songCollectionItemInput({ songId: UUID })).toEqual({ ok: true, data: { songId: UUID } })
    expect(songCollectionItemInput({})).toMatchObject({ ok: false })
    expect(songCollectionItemInput({ songId: 'x' })).toMatchObject({ ok: false })
  })
})

describe('songHistoryQuery', () => {
  it('limit 24 por defecto y entre 1 y 48', () => {
    expect(songHistoryQuery({})).toEqual({ ok: true, data: { limit: 24, cursor: undefined, exclude: undefined } })
    expect(songHistoryQuery({ limit: '1' })).toMatchObject({ ok: true, data: { limit: 1 } })
    expect(songHistoryQuery({ limit: '48' })).toMatchObject({ ok: true, data: { limit: 48 } })
    expect(songHistoryQuery({ limit: '0' })).toMatchObject({ ok: false })
    expect(songHistoryQuery({ limit: '49' })).toMatchObject({ ok: false })
  })

  it('cursor de hasta 500 caracteres y exclude UUID', () => {
    expect(songHistoryQuery({ cursor: 'c'.repeat(500), exclude: UUID })).toMatchObject({ ok: true, data: { cursor: 'c'.repeat(500), exclude: UUID } })
    expect(songHistoryQuery({ cursor: 'c'.repeat(501) })).toMatchObject({ ok: false })
    expect(songHistoryQuery({ exclude: 'no' })).toMatchObject({ ok: false })
  })
})
