// T007 — Consulta de Peticiones (feature 007, research D3–D4, data-model § Consulta): solo envíos aprobados, imágenes
// listas fuera de la papelera, keyset por fecha de aprobación, búsqueda sin tildes y elegibilidad para generar.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeCursor } from '../../server/utils/pagination'
import { listPrayerRequests, loadEligibleRequests, normalizeSearch } from '../../server/utils/prayer-requests'
import type { PrayerRow } from '../../server/utils/prayer-requests'
import { created, expectStatus, installNitro, sqlText, UUID, UUID2 } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const minutes = (n: number) => new Date(created.getTime() - n * 60_000)

const row = (n: number, changes: Partial<PrayerRow> = {}): PrayerRow => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `tarjeta-${n}.jpg`,
  senderName: 'Ana',
  note: null,
  sentAt: minutes(n + 600),
  approvedAt: minutes(n),
  ...changes,
})

const whereOf = (fake: ReturnType<typeof installNitro>) => sqlText(fake.calls.find(c => c.method === 'where')!.args[0])
const orderOf = (fake: ReturnType<typeof installNitro>) => fake.calls.find(c => c.method === 'orderBy')!.args.map(sqlText).join(' ')

describe('normalizeSearch', () => {
  it('minúsculas sin tildes ni eñe, como translate(lower(…)) en SQL', () => {
    expect(normalizeSearch('Oración ÑANDÚ')).toBe('oracion nandu')
    expect(normalizeSearch('pingüino')).toBe('pinguino')
  })

  it('escapa comodines de LIKE y la barra invertida', () => {
    expect(normalizeSearch('50%_a\\b')).toBe('50\\%\\_a\\\\b')
  })
})

describe('listPrayerRequests', () => {
  it('filtra aprobados, imágenes listas fuera de la papelera, con una sola consulta y LIMIT 13', async () => {
    const fake = installNitro([[row(1)]])
    await listPrayerRequests({})
    const where = whereOf(fake)
    expect(where).toContain('"guest_submissions"."status" = $1')
    expect(where).toContain('"approved"')
    expect(where).toContain('"files"."category" = $2')
    expect(where).toContain('"image"')
    expect(where).toContain('"files"."upload_status" = $3')
    expect(where).toContain('"ready"')
    expect(where).toContain('"files"."deleted_at" IS NULL')
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(1)
    expect(fake.calls.find(c => c.method === 'innerJoin')).toBeTruthy()
    expect(fake.calls.find(c => c.method === 'limit')?.args[0]).toBe(13)
  })

  it('no selecciona columnas pesadas de files que la tarjeta no usa', async () => {
    const fake = installNitro([[]])
    await listPrayerRequests({})
    const columns = Object.keys(fake.calls.find(c => c.method === 'select')!.args[0] as object)
    for (const heavy of ['storageKey', 'thumbKey', 'sizeBytes', 'mimeType', 'textSourceKey', 'guestName']) expect(columns).not.toContain(heavy)
  })

  it('orden desc por defecto y asc a pedido, sobre (reviewed_at en ms, id)', async () => {
    let fake = installNitro([[]])
    await listPrayerRequests({})
    expect(orderOf(fake)).toBe('date_trunc(\'milliseconds\', "guest_submissions"."reviewed_at") desc [] "files"."id" desc []')
    fake = installNitro([[]])
    await listPrayerRequests({ dir: 'asc' })
    expect(orderOf(fake)).toBe('date_trunc(\'milliseconds\', "guest_submissions"."reviewed_at") asc [] "files"."id" asc []')
  })

  it('rango de aprobación: from inclusivo, to exclusivo', async () => {
    const fake = installNitro([[]])
    await listPrayerRequests({ from: '2026-11-07T06:00:00.000Z', to: '2026-11-08T06:00:00.000Z' })
    const where = whereOf(fake)
    expect(where).toMatch(/"guest_submissions"\."reviewed_at" >= \$\d+::timestamptz/)
    expect(where).toMatch(/"guest_submissions"\."reviewed_at" < \$\d+::timestamptz/)
    expect(where).toContain('2026-11-07T06:00:00.000Z')
    expect(where).toContain('2026-11-08T06:00:00.000Z')
  })

  it('búsqueda sin tildes sobre nombre y nota', async () => {
    const fake = installNitro([[]])
    await listPrayerRequests({ q: ' Oración 100% ' })
    const where = whereOf(fake)
    expect(where).toContain('translate(lower("guest_submissions"."sender_name" || \' \' || coalesce("guest_submissions"."note", \'\'))')
    expect(where).not.toContain('text_content')
    expect(where).toMatch(/LIKE \$\d+ ESCAPE '\\'/)
    expect(where).toContain('"áéíóúüñ","aeiouun"')
    expect(where).toContain('"%oracion 100\\\\%%"')
  })

  it('sin búsqueda ni fechas no agrega esas condiciones', async () => {
    const fake = installNitro([[]])
    await listPrayerRequests({ q: '   ' })
    const where = whereOf(fake)
    expect(where).not.toContain('translate')
    expect(where).not.toContain('>=')
  })

  it.each([['desc', '<'], ['asc', '>']] as const)('cursor con dir %s compara la tupla con %s', async (dir, op) => {
    const fake = installNitro([[]])
    await listPrayerRequests({ dir, cursor: encodeCursor({ v: created.toISOString(), id: UUID }) })
    const where = whereOf(fake)
    expect(where).toContain(`(date_trunc('milliseconds', "guest_submissions"."reviewed_at"), "files"."id") ${op} (`)
    expect(where).toContain(created.toISOString())
    expect(where).toContain(UUID)
  })

  it('cursor inválido → 422', async () => {
    installNitro([[]])
    await expectStatus(listPrayerRequests({ cursor: 'basura' }), 422)
  })

  it.each([
    ['fecha que no es fecha', { v: 'ayer', id: UUID }],
    ['id que no es UUID', { v: created.toISOString(), id: "x'); --" }],
  ])('cursor bien formado con %s → 422 sin consultar (no un 500 de Postgres)', async (_, data) => {
    const fake = installNitro([[]])
    await expectStatus(listPrayerRequests({ cursor: encodeCursor(data) }), 422)
    expect(fake.calls).toHaveLength(0)
  })

  it('con 13 filas devuelve 12 y el cursor de la duodécima', async () => {
    installNitro([Array.from({ length: 13 }, (_, i) => row(i))])
    const page = await listPrayerRequests({})
    expect(page.items).toHaveLength(12)
    expect(page.nextCursor).toBe(encodeCursor({ v: minutes(11).toISOString(), id: row(11).id }))
  })

  it.each([0, 1, 12])('con %i filas no hay siguiente página', async (n) => {
    installNitro([Array.from({ length: n }, (_, i) => row(i))])
    const page = await listPrayerRequests({})
    expect(page.items).toHaveLength(n)
    expect(page.nextCursor).toBeNull()
  })

  it('mapea la fila al DTO y la URL de vista previa, sin transcripción', async () => {
    installNitro([[row(1, { id: UUID, note: 'para el domingo' })]])
    const page = await listPrayerRequests({})
    expect(page.items[0]).toEqual({
      id: UUID,
      name: 'tarjeta-1.jpg',
      senderName: 'Ana',
      note: 'para el domingo',
      sentAt: minutes(601).toISOString(),
      approvedAt: minutes(1).toISOString(),
      previewUrl: `/api/files/${UUID}/content`,
    })
  })
})

describe('loadEligibleRequests', () => {
  it('aplica las condiciones del listado (ya no el texto) y ordena para las imágenes', async () => {
    const fake = installNitro([[row(1, { id: UUID })]])
    const result = await loadEligibleRequests([UUID2, UUID])
    const where = whereOf(fake)
    expect(where).toContain('"guest_submissions"."status" = $1')
    expect(where).toContain('"files"."deleted_at" IS NULL')
    expect(where).toMatch(/"files"\."id" in \(\$\d+, \$\d+\)/)
    expect(where).not.toContain('text_status')
    expect(where).not.toContain('text_content')
    expect(orderOf(fake)).toBe('"guest_submissions"."reviewed_at" asc [] "guest_submissions"."created_at" asc [] "files"."id" asc []')
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(1)
    expect(result.found.map(r => r.id)).toEqual([UUID])
    expect(result.missing).toEqual([UUID2])
  })

  it('sin ids no consulta', async () => {
    const fake = installNitro([])
    expect(await loadEligibleRequests([])).toEqual({ found: [], missing: [] })
    expect(fake.calls).toHaveLength(0)
  })
})
