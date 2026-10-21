// Capa de persistencia del texto de imágenes (feature 002, research A5): reclamación atómica y escrituras
// condicionadas sobre `files` y `guest_submission_files`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimImageText,
  loadImageTextRow,
  markUnavailable,
  releaseImageText,
  saveImageTextResult,
  setTextSourceKey,
} from '../../server/utils/image-text-store'
import type { ImageTextTarget } from '../../server/utils/image-text-store'
import { installNitro, sqlText, UUID } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const FILE: ImageTextTarget = { table: 'files', id: UUID }
const GUEST: ImageTextTarget = { table: 'guest_submission_files', id: UUID }
const CLAIMED_AT = '2026-10-21 10:00:00.123456+00'

const rawRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID,
  extension: 'jpg',
  category: 'image',
  size_bytes: '8386',
  storage_key: `pre/files/${UUID}`,
  text_status: null,
  text_content: null,
  text_error: null,
  text_source_key: null,
  text_attempts: 0,
  text_started_at: null,
  text_read_at: null,
  text_edited_at: null,
  edited_by_name: null,
  ...changes,
})

/** SQL de la n-ésima llamada a `execute`. */
const executed = (fake: ReturnType<typeof installNitro>, n = 0) => sqlText(fake.db.execute.mock.calls[n]![0])

describe('loadImageTextRow', () => {
  it('lee la fila de files con el nombre de quien la corrigió', async () => {
    const fake = installNitro([{ rows: [rawRow({ text_status: 'ready', text_content: 'Hola', text_attempts: '2', text_read_at: '2026-10-21T10:00:00Z', text_edited_at: '2026-10-21T11:00:00Z', edited_by_name: 'Ana' })] }])
    const row = await loadImageTextRow(FILE)
    expect(row).toMatchObject({
      id: UUID, sizeBytes: 8386, textStatus: 'ready', textContent: 'Hola', textAttempts: 2, editedByName: 'Ana',
      textReadAt: new Date('2026-10-21T10:00:00Z'), textEditedAt: new Date('2026-10-21T11:00:00Z'), textStartedAt: null,
    })
    expect(executed(fake)).toMatch(/FROM "files" t WHERE t\.id = \$1/)
    expect(executed(fake)).toContain('text_edited_by')
  })

  it('en guest_submission_files no hay columnas de edición; sin fila → null', async () => {
    const fake = installNitro([{ rows: [] }])
    expect(await loadImageTextRow(GUEST)).toBeNull()
    expect(executed(fake)).toContain('FROM "guest_submission_files" t')
    expect(executed(fake)).toContain('NULL::text AS edited_by_name')
  })
})

describe('claimImageText', () => {
  it('reclama desde NULL o una lectura vencida (90 s), e incrementa los intentos', async () => {
    const fake = installNitro([{ rows: [{ ...rawRow({ text_status: 'reading' }), claimed_at: CLAIMED_AT }] }])
    const claimed = await claimImageText(FILE)
    expect(claimed).toMatchObject({ id: UUID, textStatus: 'reading', claimedAt: CLAIMED_AT })
    const query = executed(fake)
    expect(query).toContain(`SET text_status = 'reading', text_started_at = now(), text_attempts = t.text_attempts + 1`)
    expect(query).toContain('t.text_status IS NULL')
    expect(query).toContain(`t.text_status = 'reading' AND t.text_started_at < now() - make_interval(secs => $2)`)
    expect(query).toContain(`["${UUID}",90]`)
    expect(query).not.toContain(`IN ('failed', 'ready', 'empty')`)
    expect(query).toContain('t.text_started_at::text AS claimed_at')
  })

  it('con force también desde failed, ready y empty; volver a leer limpia la corrección', async () => {
    const fake = installNitro([{ rows: [] }])
    expect(await claimImageText(FILE, { force: true })).toBeNull()
    expect(executed(fake)).toContain(`OR t.text_status IN ('failed', 'ready', 'empty')`)
    expect(executed(fake)).toContain('text_edited_by = NULL, text_edited_at = NULL')
  })

  it('en guest_submission_files no toca columnas de edición', async () => {
    const fake = installNitro([{ rows: [] }])
    await claimImageText(GUEST)
    expect(executed(fake)).toContain('UPDATE "guest_submission_files" t')
    expect(executed(fake)).not.toContain('text_edited_by = NULL')
  })
})

describe('saveImageTextResult', () => {
  it('escribe solo si sigue en la misma reclamación; el texto solo en ready', async () => {
    const fake = installNitro([{ rows: [{ saved: 1 }] }])
    expect(await saveImageTextResult(FILE, CLAIMED_AT, { status: 'ready', text: 'Hola' })).toBe(true)
    const query = executed(fake)
    expect(query).toContain(`WHERE id = $4 AND text_status = 'reading' AND text_started_at = $5::timestamptz`)
    expect(query).toContain('"ready","Hola",null')
    expect(query).toContain(CLAIMED_AT)
    expect(query).not.toContain('approved')
  })

  it('un fallo guarda el código sin texto; una lectura pisada no escribe', async () => {
    const fake = installNitro([{ rows: [{ saved: 0 }] }])
    expect(await saveImageTextResult(FILE, CLAIMED_AT, { status: 'failed', error: 'timeout' })).toBe(false)
    expect(executed(fake)).toContain('"failed",null,"timeout"')
  })

  it('empty no guarda texto ni error', async () => {
    const fake = installNitro([{ rows: [] }])
    expect(await saveImageTextResult(FILE, CLAIMED_AT, { status: 'empty' })).toBe(false)
    expect(executed(fake)).toContain('"empty",null,null')
  })

  it('un archivo de invitado aprobado durante la lectura actualiza también files', async () => {
    const fake = installNitro([{ rows: [{ saved: 2 }] }])
    expect(await saveImageTextResult(GUEST, CLAIMED_AT, { status: 'ready', text: 'Hola' })).toBe(true)
    const query = executed(fake)
    expect(query).toContain('UPDATE "guest_submission_files"')
    expect(query).toContain('approved AS (')
    expect(query).toContain('UPDATE "files"')
  })
})

describe('markUnavailable, releaseImageText y setTextSourceKey', () => {
  it('unavailable limpia texto y error', async () => {
    const fake = installNitro([{ rows: [] }])
    await markUnavailable(FILE)
    expect(executed(fake)).toContain(`SET text_status = 'unavailable', text_content = NULL, text_error = NULL`)
  })

  it('devolver a pendiente resta el intento y se condiciona a la reclamación', async () => {
    const fake = installNitro([{ rows: [] }])
    await releaseImageText(GUEST, CLAIMED_AT)
    const query = executed(fake)
    expect(query).toContain('SET text_status = NULL, text_started_at = NULL, text_attempts = greatest(text_attempts - 1, 0)')
    expect(query).toContain(`text_status = 'reading' AND text_started_at = $2::timestamptz`)
  })

  it('guarda la clave de la copia JPEG', async () => {
    const fake = installNitro([{ rows: [] }])
    await setTextSourceKey(FILE, 'pre/textsrc/x.jpg')
    expect(executed(fake)).toContain('SET text_source_key = $1')
    expect(executed(fake)).toContain('pre/textsrc/x.jpg')
  })
})
