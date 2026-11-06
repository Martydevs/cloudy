// Generar la presentación de una canción (contracts/api.md § 4, FR-012–FR-017). Sin cuerpo: la letra va siempre en blanco
// (research D12). El `.pptx` (decenas de KB) pasa por aquí porque la clave del servicio no puede salir del servidor: es la
// única excepción acotada a «no retransmitir binarios» (plan, Complexity Tracking). No se guarda en el bucket ni en la base.
import { setResponseHeader } from 'h3'
import { LYRICS_MAX_LINES, SONG_SERVICE_MESSAGES, SONG_TITLE_MAX } from '#shared/constants/songs'

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export default defineEventHandler(async (event): Promise<Buffer> => {
  requireRole(event, 'editor')
  const id = paramId(event)
  const song = await findSong(id)
  if (!song) throw songNotFound()

  const stanzas = Array.isArray(song.lyrics) ? song.lyrics : []
  // Sin llamar al servicio: más de 300 líneas no es una canción (FR-035).
  if (countLines(stanzas) > LYRICS_MAX_LINES) throw songError('lyrics_too_long')
  if (countLines(stanzas) === 0) throw songError('no_lyrics', SONG_SERVICE_MESSAGES.noLyrics, 422)

  const pptx = await createLyricsPptx({ html: lyricsToHtml(stanzas), title: song.title.slice(0, SONG_TITLE_MAX) })

  setResponseHeader(event, 'Content-Type', PPTX_TYPE)
  setResponseHeader(event, 'Content-Disposition', pptx.contentDisposition ?? presentationDisposition(song.title))
  if (pptx.slideCount !== null) setResponseHeader(event, 'X-Slide-Count', String(pptx.slideCount))
  if (pptx.arrangedBy) setResponseHeader(event, 'X-Lyrics-Arranged-By', pptx.arrangedBy)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return Buffer.from(pptx.bytes)
})
