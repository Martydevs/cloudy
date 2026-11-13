// T006 — Validadores de la página Peticiones (feature 007, data-model § Validación).
import { describe, expect, it } from 'vitest'
import { PRAYER_TEXT_MAX_LENGTH } from '../../shared/constants/prayers'
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
  const entry = (fileId: string | undefined, text = 'Oremos por Ana') => ({ fileId, text })

  it.each([1, 2, 3, 4])('acepta %i peticiones distintas con su texto', (n) => {
    const requests = UUIDS.slice(0, n).map(id => entry(id))
    expect(prayerImageInput({ requests })).toEqual({ ok: true, data: { requests } })
  })

  it('recorta el texto', () => {
    const res = prayerImageInput({ requests: [entry(UUIDS[0], '  Oremos por Ana  ')] })
    expect(res).toEqual({ ok: true, data: { requests: [entry(UUIDS[0])] } })
  })

  it('acepta el texto más largo permitido', () => {
    expect(prayerImageInput({ requests: [entry(UUIDS[0], 'a'.repeat(PRAYER_TEXT_MAX_LENGTH))] }).ok).toBe(true)
  })

  it.each([
    ['vacío', []],
    ['5 peticiones', UUIDS.map(id => ({ fileId: id, text: 'x' }))],
    ['repetidos', [{ fileId: UUIDS[0], text: 'x' }, { fileId: UUIDS[1], text: 'x' }, { fileId: UUIDS[0], text: 'x' }]],
    ['no-UUID', [{ fileId: 'no-es-uuid', text: 'x' }]],
    ['sin lista', undefined],
    ['texto suelto', 'abc'],
    ['sin texto', [{ fileId: UUIDS[0] }]],
    ['texto vacío', [{ fileId: UUIDS[0], text: '   ' }]],
    ['texto demasiado largo', [{ fileId: UUIDS[0], text: 'a'.repeat(PRAYER_TEXT_MAX_LENGTH + 1) }]],
    ['entrada que no es objeto', ['abc']],
  ])('%s → error', (_, requests) => {
    const res = prayerImageInput({ requests })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.requests).toBeTruthy()
  })

  it('ids en mayúsculas se normalizan y cuentan como repetidos', () => {
    const requests = [entry(UUIDS[0]), entry(UUIDS[0]!.toUpperCase())]
    expect(prayerImageInput({ requests }).ok).toBe(false)
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
