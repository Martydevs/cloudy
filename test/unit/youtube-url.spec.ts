// T004 — Lectura del enlace pegado (feature 005, research D13): formatos aceptados y motivo exacto de cada rechazo.
import { describe, expect, it } from 'vitest'
import { parseYoutubeUrl } from '../../shared/validation/youtube'

const ID = 'dQw4w9WgXcQ'

describe('parseYoutubeUrl acepta', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=30s&list=PLabc123&si=x`,
    `https://youtube.com/watch?feature=share&v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://youtube-nocookie.com/embed/${ID}`,
    `https://youtu.be/${ID}?t=5`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `https://www.youtube.com/v/${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
    `youtube.com/watch?v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `  https://youtu.be/${ID}  `,
    `\nhttps://youtu.be/${ID}\t`,
  ])('%s', (text) => {
    expect(parseYoutubeUrl(text)).toEqual({ ok: true, videoId: ID })
  })

  it('devuelve solo el ID aunque traiga tiempo, lista y rastreo', () => {
    expect(parseYoutubeUrl(`https://youtube.com/watch?v=${ID}&t=30s&list=PL123&si=x&feature=youtu.be`)).toEqual({ ok: true, videoId: ID })
  })
})

describe('parseYoutubeUrl rechaza', () => {
  it.each<[unknown, string]>([
    ['', 'not_url'],
    ['   ', 'not_url'],
    ['hola', 'not_url'],
    ['hola mundo', 'not_url'],
    [ID, 'not_url'],
    [null, 'not_url'],
    [42, 'not_url'],
    ['ftp://youtube.com/watch?v=dQw4w9WgXcQ', 'not_url'],
    ['javascript:alert(1)', 'not_url'],
    ['https://vimeo.com/123', 'not_youtube'],
    ['https://evil-youtube.com/watch?v=dQw4w9WgXcQ', 'not_youtube'],
    ['https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ', 'not_youtube'],
    ['https://notyoutu.be/dQw4w9WgXcQ', 'not_youtube'],
    ['https://www.youtube.com/playlist?list=PLabc123', 'playlist'],
    ['https://www.youtube.com/@canal', 'channel'],
    ['https://www.youtube.com/channel/UCabcdefghijklmnop', 'channel'],
    ['https://www.youtube.com/c/canal', 'channel'],
    ['https://www.youtube.com/user/canal', 'channel'],
    ['https://www.youtube.com/watch', 'no_video'],
    ['https://www.youtube.com/watch?list=PLabc123', 'no_video'],
    ['https://www.youtube.com/', 'no_video'],
    ['https://www.youtube.com/feed/trending', 'no_video'],
    ['https://youtu.be/', 'no_video'],
    ['https://www.youtube.com/shorts/', 'no_video'],
    ['https://youtu.be/abc', 'bad_id'],
    [`https://youtu.be/${ID}X`, 'bad_id'],
    [`https://www.youtube.com/watch?v=${ID}X`, 'bad_id'],
    ['https://www.youtube.com/watch?v=dQw4w9WgX$Q', 'bad_id'],
  ])('%j → %s', (text, reason) => {
    expect(parseYoutubeUrl(text)).toEqual({ ok: false, reason })
  })
})
