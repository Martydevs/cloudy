// Resolver un enlace de Letras.com (contracts/api.md § 1, FR-005–FR-009): guardada → la abre sin rastrear; nueva → rastrea,
// lee la letra, comprueba los límites y la guarda. Un fallo no escribe nada.
import { createError, setResponseHeader, setResponseStatus } from 'h3'
import type { SongFetchResult } from '#shared/types/api'
import { SONG_URL_MESSAGES } from '#shared/constants/songs'
import { parseLetrasUrl, songUrlInput } from '#shared/validation/songs'

export default defineEventHandler(async (event): Promise<SongFetchResult> => {
  const { profile } = requireRole(event, 'editor')
  const { url: raw } = await readValid(event, songUrlInput)
  // El servidor es el filtro real (SSRF): solo enlaces de canción de Letras.com llegan al rastreador.
  const link = parseLetrasUrl(raw)
  if (!link.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: SONG_URL_MESSAGES[link.reason], data: { reason: link.reason } })
  }
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const stored = await markSongViewed({ url: link.url }, profile)
  if (stored) return { song: toSongDetail(stored), crawled: false }

  const content = readCrawledSong(await crawlLetras(link.url), link.url)
  const row = await saveCrawledSong(link.url, content, profile)
  setResponseStatus(event, 201)
  return { song: toSongDetail(row), crawled: true }
})
