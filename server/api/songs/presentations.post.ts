// Generar hasta 3 presentaciones en una sola petición (lote de `POST /api/lyrics/pptx/batch` en cloudy-api). Cuerpo
// `{ songIds }`. Cada canción se revisa aquí igual que en `[id]/pptx.post.ts` (existe, tiene letra, `lyricsWithinLimits`);
// solo las válidas van al servicio, que las genera de una en una. Éxito parcial: responde el `.zip` (solo los `.pptx`, sin
// el `manifest.json` del servicio) con las logradas y el resultado de cada canción, en el orden pedido, en la cabecera
// `X-Song-Presentations` (JSON con `encodeURIComponent`). Si ninguna sale, `422` con `data.items`. Como el `.pptx` suelto,
// el `.zip` pasa por aquí porque la clave no puede salir del servidor.
import { inArray } from 'drizzle-orm'
import { createError, setResponseHeader } from 'h3'
import type { SongPresentationBatchItem } from '#shared/types/api'
import type { SongPresentationItemError } from '#shared/constants/songs'
import { SONG_PRESENTATION_ZIP_NAME, SONG_SERVICE_MESSAGES, SONG_TITLE_MAX } from '#shared/constants/songs'
import { songPresentationBatchInput } from '#shared/validation/songs'
import { songs } from '../../db/schema'

const PRESENTATIONS_HEADER = 'X-Song-Presentations'

const failed = (songId: string, errorCode: SongPresentationItemError): SongPresentationBatchItem =>
  ({ songId, status: 'failed', filename: null, slideCount: null, arrangedBy: null, errorCode })

export default defineEventHandler(async (event): Promise<Buffer> => {
  requireRole(event, 'editor')
  const { songIds } = await readValid(event, songPresentationBatchInput)

  const rows = await useDb()
    .select({ id: songs.id, title: songs.title, lyrics: songs.lyrics })
    .from(songs)
    .where(inArray(songs.id, songIds))
  const byId = new Map(rows.map(row => [row.id, row]))

  // Revisión local: lo que no es una canción válida no gasta una llamada al servicio.
  const results: SongPresentationBatchItem[] = []
  const pending: { position: number, html: string, title: string }[] = []
  for (const songId of songIds) {
    const song = byId.get(songId)
    if (!song) {
      results.push(failed(songId, 'not_found'))
      continue
    }
    const stanzas = Array.isArray(song.lyrics) ? song.lyrics : []
    if (!lyricsWithinLimits(stanzas)) results.push(failed(songId, 'lyrics_too_long'))
    else if (countLines(stanzas) === 0) results.push(failed(songId, 'no_lyrics'))
    else {
      pending.push({ position: results.length, html: lyricsToHtml(stanzas), title: song.title.slice(0, SONG_TITLE_MAX) })
      results.push(failed(songId, 'invalid')) // se reemplaza con la respuesta del servicio
    }
  }

  let zip: Uint8Array | null = null
  if (pending.length > 0) {
    const batch = await createLyricsPptxBatch(pending)
    zip = batch.zip
    for (const item of batch.items) {
      const target = pending[item.index]
      if (!target) continue
      const songId = results[target.position]!.songId
      results[target.position] = item.status === 'done'
        ? { songId, status: 'done', filename: item.filename, slideCount: item.slideCount, arrangedBy: item.arrangedBy, errorCode: null }
        : failed(songId, item.errorCode ?? 'invalid')
    }
  }

  if (!zip || !results.some(item => item.status === 'done')) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Unprocessable Entity',
      message: SONG_SERVICE_MESSAGES.batchFailed,
      data: { code: 'presentations_failed', items: results },
    })
  }

  setResponseHeader(event, 'Content-Type', 'application/zip')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${SONG_PRESENTATION_ZIP_NAME}"`)
  setResponseHeader(event, PRESENTATIONS_HEADER, encodeURIComponent(JSON.stringify(results)))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return Buffer.from(zip)
})
