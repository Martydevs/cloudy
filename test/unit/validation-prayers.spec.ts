// T006 — Validadores de la página Peticiones (feature 007, data-model § Validación).
import { describe, expect, it } from 'vitest'
import {
  checkPrayerPhoto,
  manualPrayerInput,
  PRAYER_PHOTO_ACCEPT,
  prayerCollectionInput,
  prayerCollectionItemInput,
  prayerCollectionRename,
  prayerHistoryQuery,
  prayerImageInput,
  prayerTranscriptIdsQuery,
  prayerTranscriptReadInput,
  prayerTranscriptSaveInput,
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
    const fileIds = UUIDS.slice(0, n)
    expect(prayerImageInput({ fileIds })).toEqual({ ok: true, data: { fileIds } })
  })

  it('normaliza los ids a minúsculas', () => {
    expect(prayerImageInput({ fileIds: [UUIDS[0]!.toUpperCase()] })).toEqual({ ok: true, data: { fileIds: [UUIDS[0]] } })
  })

  it.each([
    ['vacío', []],
    ['5 ids', UUIDS],
    ['repetidos', [UUIDS[0], UUIDS[1], UUIDS[0]]],
    ['no-UUID', ['no-es-uuid']],
    ['sin lista', undefined],
    ['texto suelto', 'abc'],
    ['la forma vieja con texto', [{ fileId: UUIDS[0], text: 'Oremos por Ana' }]],
  ])('%s → error', (_, fileIds) => {
    const res = prayerImageInput({ fileIds })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.fileIds).toBeTruthy()
  })

  it('el mensaje de repetidos es claro', () => {
    const res = prayerImageInput({ fileIds: [UUIDS[0], UUIDS[0]] })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.fileIds).toBe('No repitas peticiones en la misma imagen')
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

describe('transcripciones (revisión antes de generar)', () => {
  it('prayerTranscriptIdsQuery: 1–40 ids distintos separados por comas', () => {
    expect(prayerTranscriptIdsQuery({ ids: `${UUIDS[0]},${UUIDS[1]!.toUpperCase()}` })).toEqual({ ok: true, data: { ids: [UUIDS[0], UUIDS[1]] } })
    expect(prayerTranscriptIdsQuery({})).toEqual({ ok: false, errors: { ids: 'Agrega al menos 1 peticiones' } })
    expect(prayerTranscriptIdsQuery({ ids: '' })).toEqual({ ok: false, errors: { ids: 'Agrega al menos 1 peticiones' } })
    expect(prayerTranscriptIdsQuery({ ids: `${UUIDS[0]},x` })).toEqual({ ok: false, errors: { ids: '2: Identificador no válido' } })
    expect(prayerTranscriptIdsQuery({ ids: `${UUIDS[0]},${UUIDS[0]}` })).toEqual({ ok: false, errors: { ids: 'No repitas peticiones' } })
    const many = Array.from({ length: 41 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(prayerTranscriptIdsQuery({ ids: many.slice(0, 40).join(',') }).ok).toBe(true)
    expect(prayerTranscriptIdsQuery({ ids: many.join(',') })).toEqual({ ok: false, errors: { ids: 'Puedes agregar como máximo 40 peticiones' } })
    expect(prayerTranscriptIdsQuery({ ids: [UUIDS[0]] }).ok).toBe(false)
  })

  it('prayerTranscriptReadInput: force es opcional y falso por defecto', () => {
    expect(prayerTranscriptReadInput({})).toEqual({ ok: true, data: { force: false } })
    expect(prayerTranscriptReadInput(undefined)).toEqual({ ok: true, data: { force: false } })
    expect(prayerTranscriptReadInput({ force: true })).toEqual({ ok: true, data: { force: true } })
    expect(prayerTranscriptReadInput({ force: 'sí' })).toEqual({ ok: false, errors: { force: 'Debe ser verdadero o falso' } })
  })

  it('prayerTranscriptSaveInput: recorta los bordes, conserva los saltos de línea y admite un borrador vacío', () => {
    expect(prayerTranscriptSaveInput({ text: '  Por mi familia\ny mi trabajo \n', verified: true }))
      .toEqual({ ok: true, data: { text: 'Por mi familia\ny mi trabajo', verified: true } })
    expect(prayerTranscriptSaveInput({ text: '', verified: false })).toEqual({ ok: true, data: { text: '', verified: false } })
    expect(prayerTranscriptSaveInput({ text: 'a'.repeat(1000), verified: true }).ok).toBe(true)
  })

  it('prayerTranscriptSaveInput: cada error con su mensaje', () => {
    expect(prayerTranscriptSaveInput({ text: '   ', verified: true }))
      .toEqual({ ok: false, errors: { text: 'Escribe el texto de la petición para marcarla como verificada' } })
    expect(prayerTranscriptSaveInput({ text: 'a'.repeat(1001), verified: false }))
      .toEqual({ ok: false, errors: { text: 'Debe tener como máximo 1000 caracteres' } })
    expect(prayerTranscriptSaveInput({ text: 3, verified: true })).toEqual({ ok: false, errors: { text: 'Este campo es obligatorio' } })
    expect(prayerTranscriptSaveInput({ text: 'Hola' })).toEqual({ ok: false, errors: { verified: 'Debe ser verdadero o falso' } })
  })
})

describe('alta manual («Agregar petición»)', () => {
  const photo = { name: 'peticion.jpg', size: 1000, mimeType: 'image/jpeg' }

  it('manualPrayerInput: nota opcional y 1–20 archivos; el nombre del cuerpo no forma parte de los datos', () => {
    expect(manualPrayerInput({ senderName: 'Otra persona', note: ' En papel ', files: [photo] }))
      .toEqual({ ok: true, data: { note: 'En papel', files: [photo] } })
    expect(manualPrayerInput({ files: [photo] })).toEqual({ ok: true, data: { note: undefined, files: [photo] } })
    expect(manualPrayerInput({ files: [] })).toEqual({ ok: false, errors: { files: 'Agrega al menos 1 archivos' } })
    expect(manualPrayerInput({ files: Array.from({ length: 21 }, () => photo) }).ok).toBe(false)
    expect(manualPrayerInput({ note: 'x'.repeat(501), files: [photo] })).toEqual({ ok: false, errors: { note: 'Debe tener como máximo 500 caracteres' } })
  })

  it('checkPrayerPhoto: las reglas de cualquier subida y, además, solo imágenes', () => {
    for (const name of ['a.jpg', 'a.JPEG', 'a.png', 'a.webp', 'a.gif', 'a.heic']) {
      expect(checkPrayerPhoto({ name, size: 10, type: '' }), name).toBeNull()
    }
    expect(checkPrayerPhoto({ name: 'hoja.pdf', size: 10, type: 'application/pdf' })).toEqual({ code: 415, message: '«hoja.pdf»: solo se aceptan imágenes' })
    expect(checkPrayerPhoto({ name: 'nota.mp3', size: 10, type: 'audio/mpeg' })?.code).toBe(415)
    // Lo que ya rechaza cualquier subida conserva su mensaje.
    expect(checkPrayerPhoto({ name: 'setup.exe', size: 10, type: '' })).toEqual({ code: 415, message: '«setup.exe»: formato no admitido' })
    expect(checkPrayerPhoto({ name: 'a.jpg', size: 200 * 1024 * 1024, type: 'image/jpeg' })?.code).toBe(413)
  })

  it('PRAYER_PHOTO_ACCEPT lista solo extensiones de imagen', () => {
    expect(PRAYER_PHOTO_ACCEPT).toBe('.jpg,.jpeg,.png,.webp,.gif,.heic')
  })
})
