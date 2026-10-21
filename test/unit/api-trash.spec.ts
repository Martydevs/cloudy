// Papelera (FR-034–FR-036): listado de raíces, restaurar, purgar y vaciar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authAs, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'

const s3 = vi.hoisted(() => ({ deleteMany: vi.fn(async () => {}) }))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

const UUID3 = 'c0ffee00-1d2c-4e5f-8a9b-0c1d2e3f4a5b'
const DAY = 86_400_000

beforeEach(() => {
  s3.deleteMany.mockReset()
  s3.deleteMany.mockImplementation(async () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const activity = (fake: ReturnType<typeof installNitro>) =>
  fake.calls.filter(c => c.method === 'values').map(c => c.args[0])

describe('GET /api/trash', () => {
  it('lista solo raíces con ruta original, quién la eliminó, días restantes, contenido y tamaño', async () => {
    const recent = new Date().toISOString()
    const old = new Date(Date.now() - 25 * DAY)
    const fake = installNitro([
      { rows: [
        { kind: 'folder', id: UUID, name: 'Ensayo', parent_id: UUID2, deleted_at: recent, deleted_by_name: 'Ana', item_count: 4, bytes: '3072' },
        { kind: 'file', id: UUID3, name: 'foto.jpg', parent_id: null, deleted_at: old, deleted_by_name: null, item_count: 0, bytes: 1024 },
      ] },
      { rows: [{ start_id: UUID2, name: 'Domingo', depth: 1 }, { start_id: UUID2, name: 'Fotos', depth: 0 }] },
    ])
    const handler = await loadHandler('api/trash/index.get.ts')
    expect(await handler(makeEvent())).toEqual([
      { id: UUID, kind: 'folder', name: 'Ensayo', originalPath: ['Domingo', 'Fotos'], deletedBy: 'Ana', deletedAt: recent, daysLeft: 30, itemCount: 4, bytes: 3072 },
      { id: UUID3, kind: 'file', name: 'foto.jpg', originalPath: [], deletedBy: null, deletedAt: old.toISOString(), daysLeft: 5, itemCount: 0, bytes: 1024 },
    ])
    const listSql = sqlText(fake.db.execute.mock.calls[0]![0])
    expect(listSql).toContain('trash_root_id = f.id')
    expect(listSql).toContain('ORDER BY deleted_at DESC')
  })

  it('papelera vacía: no consulta rutas', async () => {
    const fake = installNitro([{ rows: [] }])
    const handler = await loadHandler('api/trash/index.get.ts')
    expect(await handler(makeEvent())).toEqual([])
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
  })

  it('exige sesión de equipo', async () => {
    installNitro()
    await expectGuarded(await loadHandler('api/trash/index.get.ts'))
  })
})

describe('POST /api/trash/:kind/:id/restore', () => {
  const restoreEvent = (kind = 'file', id = UUID) => makeEvent({ method: 'POST', params: { kind, id } })

  it('devuelve un archivo a su carpeta y registra file.restore', async () => {
    const fake = installNitro([
      [{ name: 'foto.jpg', parentId: UUID2 }], // raíz
      [{ deletedAt: null }], // carpeta original visible
      [], // nombres ocupados
      [], [], // lote: update + actividad
      { rows: [{ start_id: UUID2, name: 'Domingo', depth: 0 }] },
    ])
    const handler = await loadHandler('api/trash/[kind]/[id]/restore.post.ts')
    expect(await handler(restoreEvent())).toEqual({ name: 'foto.jpg', restoredTo: { folderId: UUID2, path: ['Domingo'] }, movedToRoot: false })
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({
      deletedAt: null, deletedBy: null, trashRootId: null, name: 'foto.jpg', folderId: UUID2,
    })
    // Restaurar conserva el texto leído (feature 002): no toca las columnas text_*.
    expect(Object.keys(fake.calls.find(c => c.method === 'set')!.args[0] as object).some(k => k.startsWith('text'))).toBe(false)
    expect(activity(fake)).toEqual([expect.objectContaining({ action: 'file.restore', targetId: UUID, meta: null })])
  })

  it('si la carpeta original sigue en la papelera, lo deja en la raíz y con sufijo si el nombre choca', async () => {
    const fake = installNitro([
      [{ name: 'foto.jpg', parentId: UUID2 }],
      [{ deletedAt: created }],
      [{ name: 'foto.jpg' }],
      [], [],
    ])
    const handler = await loadHandler('api/trash/[kind]/[id]/restore.post.ts')
    expect(await handler(restoreEvent())).toEqual({ name: 'foto (2).jpg', restoredTo: { folderId: null, path: [] }, movedToRoot: true })
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ name: 'foto (2).jpg', folderId: null })
    expect(activity(fake)).toEqual([expect.objectContaining({
      action: 'file.restore', targetLabel: 'foto (2).jpg', meta: { movedToRoot: true, from: 'foto.jpg', to: 'foto (2).jpg' },
    })])
    // Sin carpeta destino no hay ruta que consultar.
    expect(fake.db.execute).not.toHaveBeenCalled()
  })

  it('un padre inexistente también lleva a la raíz', async () => {
    installNitro([[{ name: 'foto.jpg', parentId: UUID2 }], [], [], [], []])
    const handler = await loadHandler('api/trash/[kind]/[id]/restore.post.ts')
    expect(await handler(restoreEvent())).toMatchObject({ movedToRoot: true, restoredTo: { folderId: null } })
  })

  it('reintenta con otro nombre si choca con el índice único', async () => {
    const conflict = Object.assign(new Error('duplicate key'), { code: '23505' })
    const fake = installNitro([
      [{ name: 'foto.jpg', parentId: null }],
      [], conflict, [], // primer intento: nombres libres, el update choca
      [{ name: 'foto.jpg' }], [], [], // segundo intento
    ])
    const handler = await loadHandler('api/trash/[kind]/[id]/restore.post.ts')
    expect(await handler(restoreEvent())).toEqual({ name: 'foto (2).jpg', restoredTo: { folderId: null, path: [] }, movedToRoot: false })
    expect(fake.db.batch).toHaveBeenCalledTimes(2)
  })

  it('una carpeta vuelve con todo su contenido: limpia las filas de su raíz y renombra solo la raíz', async () => {
    const fake = installNitro([
      [{ name: 'Ensayo', parentId: null }],
      [],
      [], [], [], [], // lote: subcarpetas, archivos, raíz, actividad
    ])
    const handler = await loadHandler('api/trash/[kind]/[id]/restore.post.ts')
    expect(await handler(restoreEvent('folder'))).toEqual({ name: 'Ensayo', restoredTo: { folderId: null, path: [] }, movedToRoot: false })
    const sets = fake.calls.filter(c => c.method === 'set').map(c => c.args[0])
    expect(sets).toHaveLength(3)
    expect(sets[0]).toEqual({ deletedAt: null, deletedBy: null, trashRootId: null })
    expect(sets[1]).toEqual({ deletedAt: null, deletedBy: null, trashRootId: null })
    expect(sets[2]).toMatchObject({ name: 'Ensayo', parentId: null, trashRootId: null })
    const wheres = fake.calls.filter(c => c.method === 'where').map(c => sqlText(c.args[0]))
    expect(wheres.some(w => w.includes('"trash_root_id" = $1') && w.includes('"id" <> $2'))).toBe(true)
    expect(activity(fake)).toEqual([expect.objectContaining({ action: 'folder.restore', targetType: 'folder' })])
  })

  it('404 si no es una raíz de la papelera, el tipo no existe o el id no es válido', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/trash/[kind]/[id]/restore.post.ts')
    const error = await expectStatus(Promise.resolve().then(() => handler(restoreEvent())), 404)
    expect(error.message).toBe('El elemento ya no está en la papelera')
    await expectStatus(Promise.resolve().then(() => handler(restoreEvent('otro'))), 404)
    await expectStatus(Promise.resolve().then(() => handler(restoreEvent('file', 'x'))), 404)
  })

  it('exige sesión de equipo', async () => {
    installNitro()
    await expectGuarded(await loadHandler('api/trash/[kind]/[id]/restore.post.ts'), { method: 'POST', params: { kind: 'file', id: UUID } })
  })
})

describe('DELETE /api/trash/:kind/:id', () => {
  const purgeEvent = (kind = 'folder') => makeEvent({ method: 'DELETE', params: { kind, id: UUID } })

  it('borra filas del subárbol completo y luego sus objetos; registra folder.purge', async () => {
    const fake = installNitro([
      [{ name: 'Ensayo', parentId: null }],
      { rows: [
        { purged: 1, id: UUID2, storage_key: `pre/files/${UUID2}`, thumb_key: `pre/thumbs/${UUID2}.webp` },
        { purged: 1, id: UUID3, storage_key: `pre/files/${UUID3}`, thumb_key: null, text_source_key: `pre/textsrc/${UUID3}.jpg` },
      ] },
      [],
    ])
    const handler = await loadHandler('api/trash/[kind]/[id].delete.ts')
    const event = purgeEvent()
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)

    const purgeSql = sqlText(fake.db.execute.mock.calls[0]![0])
    // Todo el subárbol (incluidos archivos enviados antes por separado) y solo raíces vigentes.
    expect(purgeSql).toContain('WITH RECURSIVE')
    expect(purgeSql).toContain('folder_id IN (SELECT id FROM tree)')
    expect(purgeSql).toContain('trash_root_id = id')
    expect(purgeSql).toContain('RETURNING id, storage_key, thumb_key, text_source_key')
    expect(s3.deleteMany).toHaveBeenCalledTimes(1)
    expect(new Set(s3.deleteMany.mock.calls[0]![0])).toEqual(new Set([
      '', `pre/files/${UUID2}`, `pre/thumbs/${UUID2}.webp`, `pre/files/${UUID3}`, `pre/thumbs/${UUID3}.webp`, `pre/textsrc/${UUID3}.jpg`,
    ]))
    expect(activity(fake)).toEqual([expect.objectContaining({ action: 'folder.purge', targetType: 'folder', targetId: UUID, targetLabel: 'Ensayo' })])
  })

  it('un archivo registra file.purge aunque el bucket falle (las filas ya no existen)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    s3.deleteMany.mockRejectedValueOnce(new Error('bucket caído'))
    const fake = installNitro([
      [{ name: 'foto.jpg', parentId: null }],
      { rows: [{ purged: 1, id: UUID, storage_key: `pre/files/${UUID}`, thumb_key: null }] },
      [],
    ])
    const handler = await loadHandler('api/trash/[kind]/[id].delete.ts')
    await handler(purgeEvent('file'))
    expect(consoleError).toHaveBeenCalledOnce()
    expect(activity(fake)).toEqual([expect.objectContaining({ action: 'file.purge', targetType: 'file' })])
  })

  it('si otra petición ya lo purgó o restauró, no borra objetos ni registra nada', async () => {
    const fake = installNitro([
      [{ name: 'foto.jpg', parentId: null }],
      { rows: [{ purged: 0, id: null, storage_key: null, thumb_key: null }] },
    ])
    const handler = await loadHandler('api/trash/[kind]/[id].delete.ts')
    await handler(purgeEvent('file'))
    expect(s3.deleteMany).not.toHaveBeenCalled()
    expect(activity(fake)).toEqual([])
  })

  it('404 si no está en la papelera; exige sesión de equipo', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/trash/[kind]/[id].delete.ts')
    await expectStatus(Promise.resolve().then(() => handler(purgeEvent())), 404)
    await expectGuarded(handler, { method: 'DELETE', params: { kind: 'folder', id: UUID } })
  })
})

describe('DELETE /api/trash', () => {
  const asAdmin = () => makeEvent({ method: 'DELETE', url: '/api/trash', auth: authAs({ role: 'admin' }) })

  it('vacía la papelera y registra trash.empty con el número de elementos', async () => {
    const fake = installNitro([
      { rows: [{ id: UUID }, { id: UUID2 }] },
      { rows: [{ purged: 2, id: null, storage_key: null, thumb_key: null }] },
      [],
    ])
    const handler = await loadHandler('api/trash/index.delete.ts')
    expect(await handler(asAdmin())).toEqual({ purged: 2 })
    expect(activity(fake)).toEqual([expect.objectContaining({ action: 'trash.empty', meta: { items: 2 } })])
  })

  it('recorre lotes de 500 y se detiene si un lote no avanza', async () => {
    const batch = { rows: Array.from({ length: 500 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}` })) }
    const fake = installNitro([
      batch, { rows: [{ purged: 500, id: null }] },
      batch, { rows: [{ purged: 0, id: null }] },
      [],
    ])
    const handler = await loadHandler('api/trash/index.delete.ts')
    expect(await handler(asAdmin())).toEqual({ purged: 500 })
    expect(fake.db.execute).toHaveBeenCalledTimes(4)
  })

  it('sin nada que purgar no registra actividad', async () => {
    const fake = installNitro([{ rows: [] }])
    const handler = await loadHandler('api/trash/index.delete.ts')
    expect(await handler(asAdmin())).toEqual({ purged: 0 })
    expect(activity(fake)).toEqual([])
  })

  it('solo administradores', async () => {
    const fake = installNitro()
    const handler = await loadHandler('api/trash/index.delete.ts')
    await expectGuarded(handler, { method: 'DELETE', url: '/api/trash' }, 'admin')
    expect(fake.db.execute).not.toHaveBeenCalled()
  })
})

describe('purge()', () => {
  it('sin ids no consulta', async () => {
    const fake = installNitro()
    const { purge } = await import('../../server/utils/trash')
    expect(await purge([])).toBe(0)
    expect(fake.db.execute).not.toHaveBeenCalled()
  })
})
