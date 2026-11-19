// Calendario de días de trabajo: lectura por rango en un solo lote sin N+1, detalle con el material resuelto, y las
// escrituras del administrador (crear, editar, estado, borrar) con sus guardas, sus 404/409 y sin días a medias.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { CALENDAR_MESSAGES, DEFAULT_AUDITORIUM } from '../../shared/constants/calendar'
import { authAs, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'
import { dayMaterialQueries, existingMaterialQueries, insertMaterialsQuery, materialCountSql, missingMaterials, toWorkDayMaterials } from '../../server/utils/work-day-materials'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const admin = authAs({ userId: 'u9', name: 'Pastor', role: 'admin' })
const UUID3 = '11111111-2222-4333-8444-555555555555'
const DAY2 = '22222222-2222-4333-8444-555555555555'

const dayRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID, title: 'Servicio dominical', workDate: '2026-11-22', kind: 'normal', status: 'not_started', auditorium: DEFAULT_AUDITORIUM, materialCount: 2, ...changes,
})
const detailRow = (changes: Record<string, unknown> = {}) => dayRow({ createdBy: 'u9', createdAt: created, updatedAt: created, authorName: 'Pastor', authorStatus: 'active', ...changes })
const slotRow = (changes: Record<string, unknown> = {}) => ({ id: 's1', workDayId: UUID, startTime: '09:00:00', endTime: '11:00:00', ...changes })
const memberRow = (changes: Record<string, unknown> = {}) => ({ workDayId: UUID, userId: 'u1', name: 'Ana', status: 'active', ...changes })

const body = (changes: Record<string, unknown> = {}) => ({
  title: 'Conferencia de jóvenes',
  date: '2026-11-21',
  kind: 'special',
  status: 'not_started',
  auditorium: DEFAULT_AUDITORIUM,
  slots: [{ start: '18:00', end: '20:00' }, { start: '09:00', end: '12:00' }],
  memberIds: ['u1', 'u2'],
  songCollectionIds: [UUID2],
  youtubePlaylistIds: [],
  folderIds: [UUID3],
  ...changes,
})

/** Respuestas de la comprobación previa: cuentas activas, el día (al editar), sus miembros y lo que existe del material. */
const checks = ({ active = ['u1', 'u2'], day = [] as unknown[], current = [] as string[], collections = [UUID2], playlists = [] as string[], folders = [UUID3] } = {}) => [
  active.map(id => ({ id })), day, current.map(id => ({ id })), collections.map(id => ({ id })), playlists.map(id => ({ id })), folders.map(id => ({ id })),
]
/** Respuestas del detalle que devuelven crear y editar. */
const detail = (row = detailRow()) => [[row], [slotRow()], [memberRow()], [], [], [], [], []]

describe('consultas', () => {
  it('el conteo de adjuntos es una subconsulta que no cuenta carpetas en la papelera y nombra el día exterior completo', async () => {
    const sql = sqlText(materialCountSql())
    expect(sql).toContain('SELECT count(*)::int FROM work_day_materials m')
    expect(sql).toContain('m.folder_id IS NULL OR f.deleted_at IS NULL')
    // Regresión: en la consulta por rango (sin join) un `"id"` a secas se resolvería contra `m.id` y el conteo sería 0.
    expect(sql).toContain('m.work_day_id = "work_days"."id"')
    const { listWorkDays } = await import('../../server/utils/work-days')
    const statements: string[] = []
    const builder = new QueryBuilder()
    installNitro([], { useDb: () => Object.assign(builder, { batch: async (queries: { toSQL: () => { sql: string } }[]) => (statements.push(...queries.map(q => q.toSQL().sql)), [[], [], []]) }) })
    await listWorkDays('2026-11-01', '2026-11-30')
    expect(statements).toHaveLength(3)
    expect(statements[0]).toContain('m.work_day_id = "work_days"."id"')
    expect(statements[0]).toContain('order by "work_days"."work_date" asc, "work_days"."id" asc')
    expect(statements[1]).toContain('"work_days"."work_date" >= $1')
  })

  it('las lecturas del material van agrupadas por tipo y ocultan las carpetas en la papelera', () => {
    installNitro([], { useDb: () => new QueryBuilder() })
    const [collections, playlists, folders, songs, videos] = dayMaterialQueries(UUID).map(query => query.toSQL().sql)
    expect(collections).toContain('inner join "song_collections"')
    // Con join, drizzle califica la columna exterior de cada conteo.
    expect(collections).toContain('i.collection_id = "song_collections"."id"')
    expect(playlists).toContain('i.playlist_id = "youtube_playlists"."id"')
    expect(folders).toContain('c.parent_id = "folders"."id"')
    expect(playlists).toContain('inner join "youtube_playlists"')
    expect(folders).toContain('"folders"."deleted_at" is null')
    expect(songs).toContain('inner join "songs"')
    expect(songs).not.toContain('lyrics')
    expect(videos).toContain('inner join "youtube_videos"')
    // Lo elegido se comprueba con una consulta por tipo; la de carpetas ignora las que están en la papelera.
    const existing = existingMaterialQueries({ songCollectionIds: [UUID], youtubePlaylistIds: [], folderIds: [UUID2] }).map(query => query.toSQL().sql)
    expect(existing).toHaveLength(3)
    expect(existing[2]).toContain('"folders"."deleted_at" is null')
  })

  it('missingMaterials: lo elegido que ya no existe', () => {
    const refs = { songCollectionIds: [UUID], youtubePlaylistIds: [UUID2], folderIds: [UUID3] }
    expect(missingMaterials(refs, [[{ id: UUID }], [{ id: UUID2 }], [{ id: UUID3 }]])).toEqual([])
    expect(missingMaterials(refs, [[{ id: UUID }], [], []])).toEqual([UUID2, UUID3])
  })

  it('insertMaterialsQuery: una sentencia con todos los adjuntos, o ninguna', () => {
    const fake = installNitro()
    expect(insertMaterialsQuery(UUID, { songCollectionIds: [], youtubePlaylistIds: [], folderIds: [] }, 'u9', created)).toBeNull()
    insertMaterialsQuery(UUID, { songCollectionIds: [UUID2], youtubePlaylistIds: [UUID3], folderIds: [DAY2] }, 'u9', created)
    expect(fake.calls.find(call => call.method === 'values')!.args[0]).toEqual([
      { workDayId: UUID, addedBy: 'u9', addedAt: created, songCollectionId: UUID2 },
      { workDayId: UUID, addedBy: 'u9', addedAt: created, youtubePlaylistId: UUID3 },
      { workDayId: UUID, addedBy: 'u9', addedAt: created, folderId: DAY2 },
    ])
  })

  it('toWorkDayMaterials: cada adjunto con sus elementos (hasta 50) y las carpetas sin elementos', () => {
    const songs = Array.from({ length: 60 }, (_, i) => ({ refId: UUID, id: `s${i}`, title: `Canción ${i}` }))
    const materials = toWorkDayMaterials(
      [{ refId: UUID, name: 'Domingo', itemCount: '60' }],
      [{ refId: UUID2, name: 'Entrada', itemCount: 1 }],
      [{ refId: UUID3, name: 'Fotos', itemCount: null }],
      [...songs, { refId: 'otra', id: 'x', title: 'Ajena' }],
      [{ refId: UUID2, id: 'okShortVid1', title: 'Video' }],
    )
    expect(materials.map(m => [m.type, m.refId, m.name, m.itemCount, m.items.length])).toEqual([
      ['song_collection', UUID, 'Domingo', 60, 50],
      ['youtube_playlist', UUID2, 'Entrada', 1, 1],
      ['folder', UUID3, 'Fotos', 0, 0],
    ])
    expect(materials[0]!.items[0]).toEqual({ id: 's0', title: 'Canción 0' })
    expect(materials[1]!.items).toEqual([{ id: 'okShortVid1', title: 'Video' }])
  })
})

describe('GET /api/calendario', () => {
  it('devuelve los días del rango con rangos, miembros y cantidad de adjuntos en un solo db.batch de 3 consultas', async () => {
    const fake = installNitro([
      [dayRow(), dayRow({ id: DAY2, title: 'Ensayo', workDate: '2026-11-25', kind: 'special', status: 'in_progress', materialCount: null })],
      [slotRow(), slotRow({ id: 's2', startTime: '18:00:00', endTime: '20:30:00' }), slotRow({ id: 's3', workDayId: DAY2 })],
      [memberRow(), memberRow({ userId: 'u2', name: null, status: 'disabled' })],
    ])
    const handler = await loadHandler('api/calendario/index.get.ts')
    const event = makeEvent({ url: '/api/calendario?from=2026-11-01&to=2026-11-30' })
    expect(await handler(event)).toEqual({
      items: [
        {
          id: UUID, title: 'Servicio dominical', date: '2026-11-22', kind: 'normal', status: 'not_started', auditorium: DEFAULT_AUDITORIUM,
          slots: [{ id: 's1', start: '09:00', end: '11:00' }, { id: 's2', start: '18:00', end: '20:30' }],
          members: [{ userId: 'u1', name: 'Ana', active: true }, { userId: 'u2', name: 'Usuario', active: false }],
          materialCount: 2,
        },
        {
          id: DAY2, title: 'Ensayo', date: '2026-11-25', kind: 'special', status: 'in_progress', auditorium: DEFAULT_AUDITORIUM,
          slots: [{ id: 's3', start: '09:00', end: '11:00' }], members: [], materialCount: 0,
        },
      ],
    })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect((fake.db.batch.mock.calls[0]![0] as unknown[]).length).toBe(3)
    await expectGuarded(handler, { url: '/api/calendario?from=2026-11-01&to=2026-11-30' })
  })

  it.each([
    ['sin fechas', '/api/calendario'],
    ['más de 62 días', '/api/calendario?from=2026-01-01&to=2026-12-31'],
    ['al revés', '/api/calendario?from=2026-11-30&to=2026-11-01'],
  ])('422 %s sin tocar la base', async (_, url) => {
    const fake = installNitro()
    const handler = await loadHandler('api/calendario/index.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url }))), 422)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('GET /api/calendario/:id', () => {
  it('trae el día con su autor y el material resuelto en un solo viaje', async () => {
    const fake = installNitro([
      [detailRow({ authorStatus: 'removed' })],
      [slotRow()],
      [memberRow()],
      [{ refId: UUID2, name: 'Domingo', itemCount: 1 }],
      [{ refId: UUID3, name: 'Entrada', itemCount: 2 }],
      [{ refId: DAY2, name: 'Fotos', itemCount: 4 }],
      [{ refId: UUID2, id: 'song-1', title: 'Canción' }],
      [{ refId: UUID3, id: 'okShortVid1', title: 'Video 1' }, { refId: UUID3, id: 'okShortVid2', title: 'Video 2' }],
    ])
    const handler = await loadHandler('api/calendario/[id]/index.get.ts')
    const event = makeEvent({ params: { id: UUID } })
    expect(await handler(event)).toEqual({
      id: UUID, title: 'Servicio dominical', date: '2026-11-22', kind: 'normal', status: 'not_started', auditorium: DEFAULT_AUDITORIUM,
      slots: [{ id: 's1', start: '09:00', end: '11:00' }],
      members: [{ userId: 'u1', name: 'Ana', active: true }],
      materialCount: 2,
      materials: [
        { type: 'song_collection', refId: UUID2, name: 'Domingo', itemCount: 1, items: [{ id: 'song-1', title: 'Canción' }] },
        { type: 'youtube_playlist', refId: UUID3, name: 'Entrada', itemCount: 2, items: [{ id: 'okShortVid1', title: 'Video 1' }, { id: 'okShortVid2', title: 'Video 2' }] },
        { type: 'folder', refId: DAY2, name: 'Fotos', itemCount: 4, items: [] },
      ],
      createdBy: { userId: 'u9', name: 'Pastor', active: false },
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
    })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    await expectGuarded(handler, { params: { id: UUID } })
  })

  it('404 si el día no existe o el id no es un uuid', async () => {
    installNitro([[], [], [], [], [], [], [], []])
    const handler = await loadHandler('api/calendario/[id]/index.get.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: UUID } }))), 404)
    expect(error.message).toBe(CALENDAR_MESSAGES.notFound)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: 'abc' } }))), 404)
  })
})

describe('POST /api/calendario', () => {
  it('solo administradores: editor 403, sin sesión 401', async () => {
    installNitro()
    const handler = await loadHandler('api/calendario/index.post.ts')
    await expectGuarded(handler, { body: body() }, 'admin')
  })

  it('crea el día, sus rangos ordenados, miembros y adjuntos en un solo db.batch (201)', async () => {
    vi.useFakeTimers({ now: created, toFake: ['Date'] })
    const fake = installNitro([...checks(), [], [], [], [], ...detail()])
    const handler = await loadHandler('api/calendario/index.post.ts')
    const event = makeEvent({ auth: admin, body: body({ title: '  Conferencia de jóvenes  ' }) })
    await handler(event)
    expect(event.node.res.statusCode).toBe(201)

    // Tres lotes: comprobación, escritura y lectura del detalle.
    expect(fake.db.batch).toHaveBeenCalledTimes(3)
    expect((fake.db.batch.mock.calls[1]![0] as unknown[]).length).toBe(4)
    const values = fake.calls.filter(call => call.method === 'values').map(call => call.args[0]) as Record<string, unknown>[]
    const id = (values[0] as { id: string }).id
    expect(values[0]).toEqual({
      id, title: 'Conferencia de jóvenes', workDate: '2026-11-21', kind: 'special', status: 'not_started', auditorium: DEFAULT_AUDITORIUM,
      createdBy: 'u9', createdAt: created, updatedAt: created,
    })
    expect(values[1]).toEqual([
      { workDayId: id, startTime: '09:00', endTime: '12:00' },
      { workDayId: id, startTime: '18:00', endTime: '20:00' },
    ])
    expect(values[2]).toEqual([{ workDayId: id, userId: 'u1' }, { workDayId: id, userId: 'u2' }])
    expect(values[3]).toEqual([
      { workDayId: id, addedBy: 'u9', addedAt: created, songCollectionId: UUID2 },
      { workDayId: id, addedBy: 'u9', addedAt: created, folderId: UUID3 },
    ])
  })

  it('sin miembros ni material el lote solo lleva el día y sus rangos; sin estado queda «Sin iniciar»', async () => {
    const fake = installNitro([...checks({ active: [], collections: [], folders: [] }), [], [], ...detail()])
    const handler = await loadHandler('api/calendario/index.post.ts')
    await handler(makeEvent({ auth: admin, body: body({ status: undefined, memberIds: [], songCollectionIds: [], folderIds: [] }) }))
    expect((fake.db.batch.mock.calls[1]![0] as unknown[]).length).toBe(2)
    expect(fake.calls.find(call => call.method === 'values')!.args[0]).toMatchObject({ status: 'not_started' })
  })

  it('422 sin tipo, aunque la fecha sea domingo: no se guarda nada por suposición', async () => {
    const fake = installNitro()
    const handler = await loadHandler('api/calendario/index.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ auth: admin, body: body({ date: '2026-11-22', kind: '' }) }))), 422)
    expect(error.data).toEqual({ errors: { kind: CALENDAR_MESSAGES.kindRequired } })
    expect(fake.calls).toHaveLength(0)
  })

  it('409 si una persona elegida ya no está activa; no se escribe nada', async () => {
    const fake = installNitro(checks({ active: ['u1'] }))
    const handler = await loadHandler('api/calendario/index.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ auth: admin, body: body() }))), 409)
    expect(error.message).toBe(CALENDAR_MESSAGES.memberUnavailable)
    expect(error.data).toEqual({ code: 'member_unavailable', ids: ['u2'] })
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect(fake.calls.some(call => call.method === 'insert')).toBe(false)
  })

  it('409 si parte del material ya no existe; no se escribe nada', async () => {
    const fake = installNitro(checks({ folders: [] }))
    const handler = await loadHandler('api/calendario/index.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ auth: admin, body: body() }))), 409)
    expect(error.message).toBe(CALENDAR_MESSAGES.materialUnavailable)
    expect(error.data).toEqual({ code: 'material_unavailable', ids: [UUID3] })
    expect(fake.calls.some(call => call.method === 'insert')).toBe(false)
  })

  it('si el material se borra justo antes de escribir, la clave foránea falla y responde 409; otros fallos se propagan', async () => {
    const fk = Object.assign(new Error('fk'), { cause: { code: '23503' } })
    installNitro([...checks(), fk])
    const handler = await loadHandler('api/calendario/index.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ auth: admin, body: body() }))), 409)
    expect(error.data).toEqual({ code: 'material_unavailable', ids: [] })

    installNitro([...checks(), Object.assign(new Error('fk'), { code: '23503' })])
    await expectStatus(Promise.resolve(handler(makeEvent({ auth: admin, body: body() }))), 409)

    installNitro([...checks(), new Error('sin conexión')])
    await expect(Promise.resolve(handler(makeEvent({ auth: admin, body: body() })))).rejects.toThrow('sin conexión')
  })
})

describe('PATCH /api/calendario/:id', () => {
  const options = (changes: Record<string, unknown> = {}) => ({ auth: admin, method: 'PATCH', params: { id: UUID }, body: body(changes) })

  it('solo administradores', async () => {
    installNitro()
    const handler = await loadHandler('api/calendario/[id]/index.patch.ts')
    await expectGuarded(handler, { method: 'PATCH', params: { id: UUID }, body: body() }, 'admin')
  })

  it('reemplaza datos, rangos, miembros y adjuntos en un solo db.batch', async () => {
    vi.useFakeTimers({ now: created, toFake: ['Date'] })
    const fake = installNitro([...checks({ day: [{ id: UUID }] }), [], [], [], [], [], [], [], ...detail()])
    const handler = await loadHandler('api/calendario/[id]/index.patch.ts')
    expect(await handler(makeEvent(options({ status: 'finished' })))).toMatchObject({ id: UUID })
    // Actualizar + 3 borrados + 3 inserciones.
    expect((fake.db.batch.mock.calls[1]![0] as unknown[]).length).toBe(7)
    expect(fake.calls.find(call => call.method === 'set')!.args[0]).toEqual({
      title: 'Conferencia de jóvenes', workDate: '2026-11-21', kind: 'special', status: 'finished', auditorium: DEFAULT_AUDITORIUM, updatedAt: created,
    })
    expect(fake.calls.filter(call => call.method === 'delete')).toHaveLength(3)
  })

  it('sin estado en el cuerpo conserva el que tenía', async () => {
    const fake = installNitro([...checks({ day: [{ id: UUID }] }), [], [], [], [], [], [], [], ...detail()])
    const handler = await loadHandler('api/calendario/[id]/index.patch.ts')
    await handler(makeEvent(options({ status: undefined })))
    expect(fake.calls.find(call => call.method === 'set')!.args[0]).not.toHaveProperty('status')
  })

  it('alguien ya asignado puede seguir aunque su cuenta se haya desactivado; alguien nuevo inactivo, no', async () => {
    installNitro([...checks({ active: ['u1'], day: [{ id: UUID }], current: ['u2'] }), [], [], [], [], [], [], [], ...detail()])
    const handler = await loadHandler('api/calendario/[id]/index.patch.ts')
    await expect(Promise.resolve(handler(makeEvent(options())))).resolves.toMatchObject({ id: UUID })

    installNitro(checks({ active: ['u1'], day: [{ id: UUID }], current: [] }))
    const error = await expectStatus(Promise.resolve(handler(makeEvent(options()))), 409)
    expect(error.data).toEqual({ code: 'member_unavailable', ids: ['u2'] })
  })

  it('404 si el día ya no existe, sin escribir; 422 con datos inválidos', async () => {
    const fake = installNitro(checks())
    const handler = await loadHandler('api/calendario/[id]/index.patch.ts')
    await expectStatus(Promise.resolve(handler(makeEvent(options()))), 404)
    expect(fake.calls.some(call => call.method === 'update')).toBe(false)
    await expectStatus(Promise.resolve(handler(makeEvent(options({ slots: [] })))), 422)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ ...options(), params: { id: 'x' } }))), 404)
  })
})

describe('PATCH /api/calendario/:id/estado', () => {
  it('cambia solo el estado', async () => {
    vi.useFakeTimers({ now: created, toFake: ['Date'] })
    const fake = installNitro([[{ id: UUID }]])
    const handler = await loadHandler('api/calendario/[id]/estado.patch.ts')
    expect(await handler(makeEvent({ auth: admin, method: 'PATCH', params: { id: UUID }, body: { status: 'in_progress' } }))).toEqual({ id: UUID, status: 'in_progress' })
    expect(fake.calls.find(call => call.method === 'set')!.args[0]).toEqual({ status: 'in_progress', updatedAt: created })
    await expectGuarded(handler, { method: 'PATCH', params: { id: UUID }, body: { status: 'in_progress' } }, 'admin')
  })

  it('422 con un estado desconocido y 404 si el día ya no existe', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/calendario/[id]/estado.patch.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ auth: admin, method: 'PATCH', params: { id: UUID }, body: { status: 'listo' } }))), 422)
    await expectStatus(Promise.resolve(handler(makeEvent({ auth: admin, method: 'PATCH', params: { id: UUID }, body: { status: 'finished' } }))), 404)
  })
})

describe('DELETE /api/calendario/:id', () => {
  it('borra el día (204); sus rangos, miembros y adjuntos se van por cascada', async () => {
    const fake = installNitro([[{ id: UUID }]])
    const handler = await loadHandler('api/calendario/[id]/index.delete.ts')
    const event = makeEvent({ auth: admin, method: 'DELETE', params: { id: UUID } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.filter(call => call.method === 'delete')).toHaveLength(1)
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID } }, 'admin')
  })

  it('404 si ya no existe', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/calendario/[id]/index.delete.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ auth: admin, method: 'DELETE', params: { id: UUID } }))), 404)
  })
})

describe('GET /api/calendario/miembros', () => {
  it('lista las cuentas activas con su rol, solo para administradores', async () => {
    installNitro([[{ id: 'u1', name: 'Ana', role: 'editor' }, { id: 'u9', name: 'Pastor', role: 'admin' }]])
    const handler = await loadHandler('api/calendario/miembros.get.ts')
    expect(await handler(makeEvent({ auth: admin }))).toEqual({
      items: [{ id: 'u1', name: 'Ana', role: 'editor' }, { id: 'u9', name: 'Pastor', role: 'admin' }],
    })
    await expectGuarded(handler, {}, 'admin')
  })
})
