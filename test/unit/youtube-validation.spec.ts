// T005 — Constantes y validadores de la página YouTube (feature 005, contracts/api.md § Validadores).
import { describe, expect, it } from 'vitest'
import {
  BLOCK_REASON_MESSAGES,
  chunkVideoIds,
  isBlockReason,
  ITEM_ERROR_MESSAGES,
  itemErrorMessage,
  YOUTUBE_FORMATS,
  YOUTUBE_MAX_BATCH,
  youtubeFormatLabel,
} from '../../shared/constants/youtube'
import type { YoutubeBlockReason } from '../../shared/constants/youtube'
import {
  youtubeHistoryQuery,
  youtubeJobInput,
  youtubePlaylistInput,
  youtubePlaylistItemInput,
  youtubePlaylistRename,
  youtubeVideoId,
} from '../../shared/validation/youtube'

const id = (n: number) => `video${String(n).padStart(6, '0')}`

describe('constantes', () => {
  it('el tope de lote es exactamente 10', () => {
    expect(YOUTUBE_MAX_BATCH).toBe(10)
  })

  it('tres formatos con su etiqueta y extensión', () => {
    expect(YOUTUBE_FORMATS.map(f => [f.value, f.label, f.extension])).toEqual([
      ['mp4_720', 'Video 720p', 'mp4'],
      ['mp4_1080', 'Video 1080p', 'mp4'],
      ['mp3', 'Audio MP3', 'mp3'],
    ])
    expect(youtubeFormatLabel('mp3')).toBe('Audio MP3')
  })

  it.each([
    'private', 'unavailable', 'age_restricted', 'members_only', 'geo_restricted', 'live',
    'format_unavailable', 'bot_check', 'ffmpeg_missing', 'download_failed', 'cancelled', 'internal',
  ])('ITEM_ERROR_MESSAGES tiene texto para %s', (code) => {
    expect(ITEM_ERROR_MESSAGES[code]?.trim()).toBeTruthy()
    expect(itemErrorMessage(code)).toBe(ITEM_ERROR_MESSAGES[code])
  })

  it.each<YoutubeBlockReason>([
    'too_long', 'live', 'unknown_duration', 'private', 'unavailable', 'age_restricted', 'members_only', 'geo_restricted',
  ])('BLOCK_REASON_MESSAGES tiene texto para %s', (reason) => {
    expect(BLOCK_REASON_MESSAGES[reason].trim()).toBeTruthy()
    expect(isBlockReason(reason)).toBe(true)
    expect(itemErrorMessage(reason)).toBe(BLOCK_REASON_MESSAGES[reason])
  })

  it('un código desconocido usa el texto genérico', () => {
    expect(itemErrorMessage('lo_que_sea')).toBe(ITEM_ERROR_MESSAGES.internal)
    expect(itemErrorMessage(null)).toBe(ITEM_ERROR_MESSAGES.internal)
    expect(isBlockReason('bot_check')).toBe(false)
  })

  it('ningún texto está en inglés', () => {
    for (const text of [...Object.values(ITEM_ERROR_MESSAGES), ...Object.values(BLOCK_REASON_MESSAGES)]) {
      expect(text).not.toMatch(/\b(error|failed|video unavailable|private video)\b/i)
    }
  })
})

describe('chunkVideoIds', () => {
  it('parte 25 IDs en 10, 10 y 5 sin perder ni repetir', () => {
    const ids = Array.from({ length: 25 }, (_, i) => id(i))
    const chunks = chunkVideoIds(ids, 10)
    expect(chunks.map(c => c.length)).toEqual([10, 10, 5])
    expect(chunks.flat()).toEqual(ids)
  })

  it('vacío → sin lotes; exactamente 10 → un lote; por defecto usa el tope', () => {
    expect(chunkVideoIds([])).toEqual([])
    expect(chunkVideoIds(Array.from({ length: 10 }, (_, i) => id(i)))).toHaveLength(1)
    expect(chunkVideoIds(Array.from({ length: 11 }, (_, i) => id(i))).map(c => c.length)).toEqual([10, 1])
  })
})

describe('youtubeVideoId', () => {
  it('acepta 11 caracteres del patrón y rechaza el resto', () => {
    expect(youtubeVideoId()('dQw4w9WgXcQ')).toEqual({ ok: true, value: 'dQw4w9WgXcQ' })
    expect(youtubeVideoId()('a-b_c-d_e-f')).toMatchObject({ ok: true })
    for (const bad of ['dQw4w9WgXc', 'dQw4w9WgXcQQ', 'a b', 'dQw4w9WgX$Q', '', null, 11]) {
      expect(youtubeVideoId()(bad)).toMatchObject({ ok: false })
    }
  })
})

describe('youtubeJobInput', () => {
  it('acepta 1–10 IDs y quita repetidos conservando el orden', () => {
    expect(youtubeJobInput({ videoIds: [id(2), id(1), id(2)], format: 'mp3' }))
      .toEqual({ ok: true, data: { videoIds: [id(2), id(1)], format: 'mp3' } })
    expect(youtubeJobInput({ videoIds: Array.from({ length: 10 }, (_, i) => id(i)), format: 'mp4_1080' })).toMatchObject({ ok: true })
  })

  it('rechaza 0 IDs, 11 IDs, un ID inválido y un formato desconocido', () => {
    expect(youtubeJobInput({ videoIds: [], format: 'mp3' })).toMatchObject({ ok: false, errors: { videoIds: expect.any(String) } })
    expect(youtubeJobInput({ videoIds: Array.from({ length: 11 }, (_, i) => id(i)), format: 'mp3' })).toMatchObject({ ok: false, errors: { videoIds: expect.any(String) } })
    expect(youtubeJobInput({ videoIds: ['malo'], format: 'mp3' })).toMatchObject({ ok: false, errors: { videoIds: expect.any(String) } })
    expect(youtubeJobInput({ videoIds: [id(1)], format: 'webm' })).toMatchObject({ ok: false, errors: { format: 'Formato no válido' } })
    expect(youtubeJobInput({})).toMatchObject({ ok: false })
  })
})

describe('listas', () => {
  it('youtubePlaylistInput: nombre 1–80 recortado y videoId opcional válido', () => {
    expect(youtubePlaylistInput({ name: '  Domingo  ' })).toEqual({ ok: true, data: { name: 'Domingo', videoId: undefined } })
    expect(youtubePlaylistInput({ name: 'a'.repeat(80), videoId: 'dQw4w9WgXcQ' })).toMatchObject({ ok: true, data: { videoId: 'dQw4w9WgXcQ' } })
    expect(youtubePlaylistInput({ name: '' })).toEqual({ ok: false, errors: { name: 'Este campo es obligatorio' } })
    expect(youtubePlaylistInput({ name: '    ' })).toEqual({ ok: false, errors: { name: 'Este campo es obligatorio' } })
    expect(youtubePlaylistInput({ name: 'a'.repeat(81) })).toEqual({ ok: false, errors: { name: 'Debe tener como máximo 80 caracteres' } })
    expect(youtubePlaylistInput({ name: 'Ok', videoId: 'malo' })).toMatchObject({ ok: false, errors: { videoId: expect.any(String) } })
  })

  it('youtubePlaylistRename e items', () => {
    expect(youtubePlaylistRename({ name: ' Ensayo ' })).toEqual({ ok: true, data: { name: 'Ensayo' } })
    expect(youtubePlaylistRename({ name: '' })).toMatchObject({ ok: false })
    expect(youtubePlaylistRename({ name: 'x'.repeat(81) })).toMatchObject({ ok: false })
    expect(youtubePlaylistItemInput({ videoId: 'dQw4w9WgXcQ' })).toMatchObject({ ok: true })
    expect(youtubePlaylistItemInput({})).toMatchObject({ ok: false })
  })
})

describe('youtubeHistoryQuery', () => {
  it('limit 1–48 (24 por defecto) y cursor/exclude opcionales', () => {
    expect(youtubeHistoryQuery({})).toEqual({ ok: true, data: { limit: 24, cursor: undefined, exclude: undefined } })
    expect(youtubeHistoryQuery({ limit: '12', cursor: 'abc', exclude: 'dQw4w9WgXcQ' }))
      .toEqual({ ok: true, data: { limit: 12, cursor: 'abc', exclude: 'dQw4w9WgXcQ' } })
    expect(youtubeHistoryQuery({ limit: '48' })).toMatchObject({ ok: true, data: { limit: 48 } })
  })

  it('rechaza limit 0, 49 y no entero, y un exclude inválido', () => {
    expect(youtubeHistoryQuery({ limit: '0' })).toMatchObject({ ok: false, errors: { limit: expect.any(String) } })
    expect(youtubeHistoryQuery({ limit: '49' })).toMatchObject({ ok: false, errors: { limit: expect.any(String) } })
    expect(youtubeHistoryQuery({ limit: '2.5' })).toMatchObject({ ok: false })
    expect(youtubeHistoryQuery({ exclude: 'malo' })).toMatchObject({ ok: false, errors: { exclude: expect.any(String) } })
  })
})
