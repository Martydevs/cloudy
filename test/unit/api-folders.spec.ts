import { afterEach, describe, expect, it, vi } from 'vitest'
import { created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, UUID, UUID2 } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const folder = (changes: Record<string, unknown> = {}) => ({
  id: UUID, parentId: null, name: 'Domingo', createdBy: 'u1', createdAt: created, updatedAt: created,
  deletedAt: null, deletedBy: null, trashRootId: null, ...changes,
})

const fileRow = (changes: Record<string, unknown> = {}) => ({
  id: 'f1', folderId: UUID, name: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 10,
  storageKey: 'files/f1', thumbKey: null, uploadStatus: 'ready', origin: 'team', uploadedBy: 'u1', guestName: null,
  submissionId: null, createdAt: created, updatedAt: created, deletedAt: null, deletedBy: null, trashRootId: null,
  uploaderName: 'Ana', commentCount: 0, ...changes,
})

describe('GET /api/folders/:id/children', () => {
  it('raíz: subcarpetas con su conteo, archivos y ruta', async () => {
    installNitro([[fileRow({ folderId: null, commentCount: 2 })], [{ folder: folder(), itemCount: 3 }]])
    const handler = await loadHandler('api/folders/[id]/children.get.ts')
    const result = await handler(makeEvent({ params: { id: 'root' } }))
    expect(result).toEqual({
      folder: null,
      breadcrumbs: [{ id: null, name: 'Archivos' }],
      folders: [expect.objectContaining({ id: UUID, name: 'Domingo', itemCount: 3 })],
      files: [expect.objectContaining({ id: 'f1', commentCount: 2 })],
      nextCursor: null,
    })
  })

  it('una carpeta incluye la carpeta y sus migas', async () => {
    installNitro([[folder()], [fileRow()], [], { rows: [{ id: UUID, name: 'Domingo', depth: 0 }] }])
    const handler = await loadHandler('api/folders/[id]/children.get.ts')
    const result = await handler(makeEvent({ params: { id: UUID }, url: '/api/x?sort=date&dir=desc' })) as { folder: { name: string }, breadcrumbs: unknown[] }
    expect(result.folder.name).toBe('Domingo')
    expect(result.breadcrumbs).toEqual([{ id: null, name: 'Archivos' }, { id: UUID, name: 'Domingo' }])
  })

  it('con filtro de tipo o cursor no repite las subcarpetas', async () => {
    const fake = installNitro([[fileRow()], [fileRow()]])
    const handler = await loadHandler('api/folders/[id]/children.get.ts')
    const filtered = await handler(makeEvent({ params: { id: 'root' }, url: '/api/x?type=image' })) as { folders: unknown[] }
    expect(filtered.folders).toEqual([])
    const cursor = Buffer.from(JSON.stringify({ v: 'foto.jpg', id: 'f1' })).toString('base64url')
    const page2 = await handler(makeEvent({ params: { id: 'root' }, url: `/api/x?cursor=${cursor}` })) as { folders: unknown[], breadcrumbs: unknown[] }
    expect(page2).toMatchObject({ folders: [], breadcrumbs: [] })
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(2)
  })

  it('404 para ids inválidos o carpetas en la papelera; 422 para filtros inválidos', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/folders/[id]/children.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: 'no-es-uuid' } }))), 404)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: UUID } }))), 404)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: 'root' }, url: '/api/x?sort=peso' }))), 422)
    await expectGuarded(handler, { params: { id: 'root' } })
  })
})

describe('GET /api/folders/tree', () => {
  it('lista las carpetas visibles', async () => {
    installNitro([[{ id: UUID, name: 'Domingo', parentId: null }]])
    const handler = await loadHandler('api/folders/tree.get.ts')
    expect(await handler(makeEvent())).toEqual([{ id: UUID, name: 'Domingo', parentId: null }])
    await expectGuarded(handler)
  })
})

describe('POST /api/folders', () => {
  it('crea la carpeta y registra la actividad en el mismo lote', async () => {
    const fake = installNitro([[], [folder({ name: 'Domingo' })], []])
    const handler = await loadHandler('api/folders/index.post.ts')
    const event = makeEvent({ body: { name: 'Domingo', parentId: null } })
    const result = await handler(event)
    expect(result).toMatchObject({ name: 'Domingo', itemCount: 0 })
    expect(event.node.res.statusCode).toBe(201)
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    const values = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(values[1]).toMatchObject({ action: 'folder.create', actorLabel: 'Ana' })
  })

  it('agrega sufijo si el nombre ya existe en la carpeta padre', async () => {
    const fake = installNitro([[folder({ id: UUID2 })], [{ name: 'Domingo' }], [folder({ name: 'Domingo (2)' })], []])
    const handler = await loadHandler('api/folders/index.post.ts')
    await handler(makeEvent({ body: { name: 'Domingo', parentId: UUID2 } }))
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({ name: 'Domingo (2)', parentId: UUID2 })
  })

  it('valida nombre y carpeta padre', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/folders/index.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ body: { name: 'a/b', parentId: null } }))), 422)
    expect(error.data).toEqual({ errors: { name: 'No uses los caracteres / \\ : * ? " < > |' } })
    await expectStatus(Promise.resolve(handler(makeEvent({ body: { name: 'Domingo', parentId: UUID } }))), 404)
    await expectGuarded(handler, { body: { name: 'Domingo', parentId: null } })
  })
})

describe('PATCH /api/folders/:id', () => {
  it('renombra y registra folder.rename con el nombre anterior', async () => {
    const fake = installNitro([[folder()], [], [folder({ name: 'Ensayo' })], []])
    const handler = await loadHandler('api/folders/[id].patch.ts')
    const result = await handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: 'Ensayo' } }))
    expect(result).toMatchObject({ name: 'Ensayo' })
    const activity = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(activity).toEqual([expect.objectContaining({ action: 'folder.rename', meta: { from: 'Domingo', to: 'Ensayo' } })])
  })

  it('mueve comprobando el destino y que no haya ciclo', async () => {
    const fake = installNitro([[folder()], [folder({ id: UUID2, name: 'Fotos' })], { rows: [] }, [], [folder({ parentId: UUID2 })], []])
    const handler = await loadHandler('api/folders/[id].patch.ts')
    await handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { parentId: UUID2 } }))
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
    const activity = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(activity).toEqual([expect.objectContaining({ action: 'folder.move', meta: { from: null, to: UUID2 } })])
  })

  it('mover a la raíz no consulta ciclos', async () => {
    const fake = installNitro([[folder({ parentId: UUID2 })], [], [folder()], []])
    const handler = await loadHandler('api/folders/[id].patch.ts')
    await handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { parentId: null } }))
    expect(fake.db.execute).not.toHaveBeenCalled()
  })

  it('409 si se mueve dentro de sí misma o de una subcarpeta', async () => {
    installNitro([[folder()], [folder()], [folder()], [folder({ id: UUID2 })], { rows: [{ hit: 1 }] }])
    const handler = await loadHandler('api/folders/[id].patch.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { parentId: UUID } }))), 409)
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { parentId: UUID2 } }))), 409)
  })

  it('exige algún cambio y rol', async () => {
    installNitro()
    const handler = await loadHandler('api/folders/[id].patch.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: {} }))), 422)
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: 'x' }, body: { name: 'a' } }))), 404)
    await expectGuarded(handler, { method: 'PATCH', params: { id: UUID }, body: { name: 'a' } })
  })
})

describe('DELETE /api/folders/:id y conteo', () => {
  it('envía la carpeta y su contenido a la papelera en una sola sentencia', async () => {
    const fake = installNitro([[folder()], { rows: [{ folders: 2, files: 5, logged: 1 }] }])
    const handler = await loadHandler('api/folders/[id].delete.ts')
    expect(await handler(makeEvent({ method: 'DELETE', params: { id: UUID } }))).toEqual({ trashedItems: 7 })
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
  })

  it('una carpeta ya borrada es 404', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/folders/[id].delete.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'DELETE', params: { id: UUID } }))), 404)
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID } })
  })

  it('el conteo devuelve los elementos que se enviarían a la papelera', async () => {
    installNitro([[folder()], { rows: [{ items: 4 }] }, [folder()], { rows: [] }])
    const handler = await loadHandler('api/folders/[id]/count.get.ts')
    expect(await handler(makeEvent({ params: { id: UUID } }))).toEqual({ items: 4 })
    expect(await handler(makeEvent({ params: { id: UUID } }))).toEqual({ items: 0 })
    await expectGuarded(handler, { params: { id: UUID } })
  })
})
