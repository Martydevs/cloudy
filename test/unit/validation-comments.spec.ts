// T142 — Reglas de los comentarios (US8), compartidas por el formulario y los endpoints.
import { describe, expect, it } from 'vitest'
import { COMMENT_MAX_LENGTH, commentInput, commentsQuery } from '../../shared/validation/comments'
import { isoSince } from '../../shared/validation/core'

describe('commentInput', () => {
  it('rechaza el texto vacío o solo con espacios', () => {
    expect(commentInput({ body: '' })).toEqual({ ok: false, errors: { body: 'Este campo es obligatorio' } })
    expect(commentInput({ body: '   \n ' })).toEqual({ ok: false, errors: { body: 'Este campo es obligatorio' } })
    expect(commentInput({}).ok).toBe(false)
  })

  it('acepta 2 000 caracteres y rechaza 2 001', () => {
    expect(COMMENT_MAX_LENGTH).toBe(2000)
    expect(commentInput({ body: 'a'.repeat(2000) })).toEqual({ ok: true, data: { body: 'a'.repeat(2000) } })
    expect(commentInput({ body: 'a'.repeat(2001) })).toEqual({ ok: false, errors: { body: 'Debe tener como máximo 2000 caracteres' } })
  })

  it('cuenta los caracteres después de recortar', () => {
    expect(commentInput({ body: `  ${'a'.repeat(2000)}  ` })).toEqual({ ok: true, data: { body: 'a'.repeat(2000) } })
  })
})

describe('commentsQuery / isoSince', () => {
  it('since es opcional', () => {
    expect(commentsQuery({})).toEqual({ ok: true, data: { since: undefined } })
    expect(commentsQuery({ since: '' })).toEqual({ ok: true, data: { since: undefined } })
  })

  it('acepta una fecha ISO en UTC', () => {
    const since = '2026-10-14T10:00:00.123Z'
    expect(commentsQuery({ since })).toEqual({ ok: true, data: { since } })
  })

  it('rechaza formatos y fechas imposibles', () => {
    expect(commentsQuery({ since: 'ayer' })).toEqual({ ok: false, errors: { since: 'Fecha no válida' } })
    expect(isoSince()('2026-10-14T99:99:99Z')).toEqual({ ok: false, error: 'Fecha no válida' })
    expect(isoSince()(`2026-10-14T10:00:00.${'1'.repeat(40)}Z`).ok).toBe(false)
  })
})
