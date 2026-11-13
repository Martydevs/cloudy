// T006 — Validadores de la página Peticiones (feature 007, data-model § Validación).
import { describe, expect, it } from 'vitest'
import {
  prayerCollectionInput,
  prayerCollectionItemInput,
  prayerCollectionRename,
  prayerHistoryQuery,
  prayerImageInput,
  prayersQuery,
} from '../../shared/validation/prayers'

const UUIDS = [
  '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  '9b2c1f0e-1d2c-4e5f-8a9b-0c1d2e3f4a5b',
  '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
  '6fa459ea-ee8a-3ca4-894e-db77e160355e',
  '886313e1-3b8a-5372-9b90-0c9aee199e5d',
]

describe('prayersQuery', () => {
  it('todo vacío → dir desc', () => {
    expect(prayersQuery({})).toEqual({ ok: true, data: { q: undefined, from: undefined, to: undefined, dir: 'desc', cursor: undefined } })
  })

  it('acepta búsqueda, rango, orden y cursor', () => {
    const res = prayersQuery({ q: '  oración  ', from: '2026-11-07T06:00:00.000Z', to: '2026-11-08T00:00:00-06:00', dir: 'asc', cursor: 'abc' })
    expect(res).toEqual({
      ok: true,
      data: { q: 'oración', from: '2026-11-07T06:00:00.000Z', to: '2026-11-08T06:00:00.000Z', dir: 'asc', cursor: 'abc' },
    })
  })

  it('q vacío o solo espacios = sin filtro; 100 caracteres pasan', () => {
    expect(prayersQuery({ q: '' })).toMatchObject({ ok: true, data: { q: undefined } })
    expect(prayersQuery({ q: '   ' })).toMatchObject({ ok: true, data: { q: '' } })
    expect(prayersQuery({ q: 'a'.repeat(100) }).ok).toBe(true)
  })

  it('solo from o solo to pasan', () => {
    expect(prayersQuery({ from: '2026-11-07T06:00:00.000Z' }).ok).toBe(true)
    expect(prayersQuery({ to: '2026-11-07T06:00:00.000Z' }).ok).toBe(true)
  })

  it.each([
    ['q de 101', { q: 'a'.repeat(101) }, 'q'],
    ['fecha sin zona', { from: '2026-11-07T06:00:00' }, 'from'],
    ['fecha sin hora', { to: '2026-11-07' }, 'to'],
    ['fecha imposible', { from: '2026-13-45T06:00:00Z' }, 'from'],
    ['texto', { from: 'ayer' }, 'from'],
    ['from = to', { from: '2026-11-07T06:00:00.000Z', to: '2026-11-07T06:00:00.000Z' }, 'to'],
    ['from > to', { from: '2026-11-08T06:00:00.000Z', to: '2026-11-07T06:00:00.000Z' }, 'to'],
    ['dir distinto', { dir: 'up' }, 'dir'],
    ['cursor de 501', { cursor: 'c'.repeat(501) }, 'cursor'],
  ])('%s → error en %s', (_, input, field) => {
    const res = prayersQuery(input)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(Object.keys(res.errors)).toContain(field)
  })
})

describe('prayerImageInput', () => {
  it.each([1, 2, 3, 4])('acepta %i ids distintos', (n) => {
    expect(prayerImageInput({ fileIds: UUIDS.slice(0, n) })).toEqual({ ok: true, data: { fileIds: UUIDS.slice(0, n) } })
  })

  it.each([
    ['vacío', []],
    ['5 ids', UUIDS],
    ['repetidos', [UUIDS[0], UUIDS[1], UUIDS[0]]],
    ['no-UUID', ['no-es-uuid']],
    ['sin lista', undefined],
    ['texto', 'abc'],
  ])('%s → error', (_, fileIds) => {
    const res = prayerImageInput({ fileIds })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.fileIds).toBeTruthy()
  })

  it('ids en mayúsculas se normalizan y cuentan como repetidos', () => {
    expect(prayerImageInput({ fileIds: [UUIDS[0], UUIDS[0]!.toUpperCase()] }).ok).toBe(false)
  })
})

describe('historial y colecciones de imágenes (enmienda de historial)', () => {
  it('prayerHistoryQuery: 12 por defecto, 1–48 y cursor opcional', () => {
    expect(prayerHistoryQuery({})).toEqual({ ok: true, data: { limit: 12, cursor: undefined } })
    expect(prayerHistoryQuery({ limit: '48', cursor: 'abc' })).toEqual({ ok: true, data: { limit: 48, cursor: 'abc' } })
    for (const limit of ['0', '49', 'x', '1.5']) expect(prayerHistoryQuery({ limit }).ok, limit).toBe(false)
    expect(prayerHistoryQuery({ cursor: 'a'.repeat(501) }).ok).toBe(false)
  })

  it('prayerCollectionInput: nombre recortado 1–80 e imageId opcional (UUID)', () => {
    expect(prayerCollectionInput({ name: '  Domingo  ' })).toEqual({ ok: true, data: { name: 'Domingo', imageId: undefined } })
    expect(prayerCollectionInput({ name: 'Domingo', imageId: UUIDS[0] })).toEqual({ ok: true, data: { name: 'Domingo', imageId: UUIDS[0] } })
    expect(prayerCollectionInput({ name: 'a'.repeat(80) }).ok).toBe(true)
    for (const name of ['', '   ', 'a'.repeat(81), 3]) expect(prayerCollectionInput({ name }).ok, String(name)).toBe(false)
    expect(prayerCollectionInput({ name: 'Domingo', imageId: 'x' }).ok).toBe(false)
  })

  it('prayerCollectionRename y prayerCollectionItemInput', () => {
    expect(prayerCollectionRename({ name: ' Ensayo ' })).toEqual({ ok: true, data: { name: 'Ensayo' } })
    expect(prayerCollectionRename({ name: '' }).ok).toBe(false)
    expect(prayerCollectionItemInput({ imageId: UUIDS[1] })).toEqual({ ok: true, data: { imageId: UUIDS[1] } })
    expect(prayerCollectionItemInput({}).ok).toBe(false)
    expect(prayerCollectionItemInput({ imageId: 'no' }).ok).toBe(false)
  })
})
