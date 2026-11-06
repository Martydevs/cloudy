// T055 — Colecciones de canciones (feature 006, contracts/api.md § 7–13): conteo por subconsulta y autor, creación con canción en
// un solo lote, detalle sin letras, permisos de autor o admin, agregar sin duplicar y quitar idempotente.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { authAs, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'
import { canManageCollection, collectionColumns, collectionItemsQuery, listCollectionsQuery, toSongCollection } from '../../server/utils/song-collections'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const otherEditor = authAs({ userId: 'u2', name: 'Luis', role: 'editor' })
const admin = authAs({ userId: 'u9', name: 'Pastor', role: 'admin' })

const collectionRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID, name: 'Domingo', createdBy: 'u1', createdAt: created, updatedAt: created, authorName: 'Ana', authorStatus: 'active', itemCount: 2, ...changes,
})
const itemRow = { id: UUID2, title: 'Canción', artist: 'Banda', sourceUrl: 'https://letras.com/a/b', addedAt: created, addedBy: 'u2', adderName: 'Luis', adderStatus: 'disabled' }

describe('consultas', () => {
  it('el conteo es una subconsulta y ninguna lectura trae la letra', () => {
    // SQL real de drizzle (sin conexión) para afirmar sobre el texto de las consultas.
    installNitro([], { useDb: () => new QueryBuilder() })
    expect(sqlText(collectionColumns.itemCount)).toContain('SELECT count(*)::int FROM song_collection_items i WHERE i.collection_id')
    const list = listCollectionsQuery().toSQL().sql
    expect(list).not.toContain('lyrics')
    expect(list).toContain('order by "song_collections"."updated_at" desc')
    const items = collectionItemsQuery(UUID).toSQL().sql
    expect(items).not.toContain('lyrics')
    expect(items).toContain('order by "song_collection_items"."added_at" asc')
  })

  it('canManageCollection: autor o admin', () => {
    expect(canManageCollection({ userId: 'u1', role: 'editor' }, { createdBy: 'u1' })).toBe(true)
    expect(canManageCollection({ userId: 'u2', role: 'editor' }, { createdBy: 'u1' })).toBe(false)
    expect(canManageCollection({ userId: 'u9', role: 'admin' }, { createdBy: 'u1' })).toBe(true)
    expect(canManageCollection({ userId: 'u3', role: null }, { createdBy: 'u1' })).toBe(false)
  })

  it('toSongCollection: un conteo nulo de la base se entrega como 0', () => {
    expect(toSongCollection(collectionRow({ itemCount: null }) as Parameters<typeof toSongCollection>[0]).itemCount).toBe(0)
  })
})

describe('GET /api/songs/collections', () => {
  it('devuelve { items } con autor y conteo, sin caché; un autor desactivado sale inactivo', async () => {
    installNitro([[collectionRow(), collectionRow({ id: UUID2, authorName: null, authorStatus: 'disabled', itemCount: '0' })]])
    const handler = await loadHandler('api/songs/collections/index.get.ts')
    const event = makeEvent()
    expect(await handler(event)).toEqual({
      items: [
        { id: UUID, name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 2, createdAt: created.toISOString(), updatedAt: created.toISOString() },
        { id: UUID2, name: 'Domingo', author: { userId: 'u1', name: 'Usuario', active: false }, itemCount: 0, createdAt: created.toISOString(), updatedAt: created.toISOString() },
      ],
    })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
    await expectGuarded(handler)
  })
})

describe('POST /api/songs/collections', () => {
  it.each([[''], ['    '], ['a'.repeat(81)]])('422 con el nombre %j sin tocar la base', async (name) => {
    const fake = installNitro()
    const handler = await loadHandler('api/songs/collections/index.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ body: { name } }))), 422)
    expect(fake.calls).toHaveLength(0)
  })

  it('con songId crea la colección y su elemento en un solo db.batch (201)', async () => {
    vi.useFakeTimers({ now: created, toFake: ['Date'] })
    const fake = installNitro([[{ id: UUID2 }], [], []])
    const handler = await loadHandler('api/songs/collections/index.post.ts')
    const event = makeEvent({ body: { name: '  Domingo  ', songId: UUID2 } })
    const collection = await handler(event) as { id: string }
    expect(event.node.res.statusCode).toBe(201)
    expect(collection).toMatchObject({ name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 1, createdAt: created.toISOString() })
    expect((fake.db.batch.mock.calls[0]![0] as unknown[]).length).toBe(2)
    const values = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(values[0]).toMatchObject({ id: collection.id, name: 'Domingo', createdBy: 'u1' })
    expect(values[1]).toMatchObject({ collectionId: collection.id, songId: UUID2, addedBy: 'u1' })
  })

  it('sin songId crea una colección vacía; los nombres pueden repetirse', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/songs/collections/index.post.ts')
    expect(await handler(makeEvent({ body: { name: 'Domingo' } }))).toMatchObject({ name: 'Domingo', itemCount: 0 })
    expect((fake.db.batch.mock.calls[0]![0] as unknown[]).length).toBe(1)
    expect(fake.calls.some(c => c.method === 'select')).toBe(false)
  })

  it('songId inexistente → 404 sin crear nada', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/songs/collections/index.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ body: { name: 'Domingo', songId: UUID2 } }))), 404)
    expect(error.message).toBe('Esa canción ya no está guardada. Ábrela de nuevo e inténtalo otra vez.')
    expect(fake.db.batch).not.toHaveBeenCalled()
    await expectGuarded(handler, { body: { name: 'Domingo' } })
  })
})

describe('GET /api/songs/collections/:id', () => {
  it('detalle con sus canciones en un solo batch, sin letras', async () => {
    const fake = installNitro([[collectionRow()], [itemRow]])
    const handler = await loadHandler('api/songs/collections/[id]/index.get.ts')
    const event = makeEvent({ params: { id: UUID } })
    expect(await handler(event)).toMatchObject({
      id: UUID,
      name: 'Domingo',
      items: [{ id: UUID2, title: 'Canción', artist: 'Banda', sourceUrl: 'https://letras.com/a/b', addedAt: created.toISOString(), addedBy: { userId: 'u2', name: 'Luis', active: false } }],
    })
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('inexistente → 404; id sin forma → 404 sin consultar', async () => {
    const fake = installNitro([[], []])
    const handler = await loadHandler('api/songs/collections/[id]/index.get.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)
    expect(error.message).toBe('Esa colección ya no existe.')
    const before = fake.calls.length
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: 'x' } }))), 404)
    expect(fake.calls.length).toBe(before)
    await expectGuarded(handler, { params: { id: UUID } })
  })
})

describe('PATCH /api/songs/collections/:id', () => {
  it('el autor renombra', async () => {
    const later = new Date('2026-11-06T10:00:00.000Z')
    installNitro([[collectionRow()], [{ updatedAt: later }]])
    const handler = await loadHandler('api/songs/collections/[id]/index.patch.ts')
    expect(await handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: ' Ensayo ' } }))).toMatchObject({ name: 'Ensayo', updatedAt: later.toISOString() })
  })

  it('un admin renombra la ajena; un editor ajeno recibe 403 sin escribir', async () => {
    installNitro([[collectionRow()], [{ updatedAt: created }]])
    let handler = await loadHandler('api/songs/collections/[id]/index.patch.ts')
    expect(await handler(makeEvent({ auth: admin, method: 'PATCH', params: { id: UUID }, body: { name: 'Ensayo' } }))).toMatchObject({ name: 'Ensayo' })

    const fake = installNitro([[collectionRow()]])
    handler = await loadHandler('api/songs/collections/[id]/index.patch.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ auth: otherEditor, method: 'PATCH', params: { id: UUID }, body: { name: 'Ensayo' } }))), 403)
    expect(error.message).toBe('Solo quien la creó o un administrador puede cambiar esta colección.')
    expect(fake.calls.some(c => c.method === 'update')).toBe(false)
  })

  it('nombre inválido → 422; si desaparece al guardar → 404', async () => {
    installNitro([])
    let handler = await loadHandler('api/songs/collections/[id]/index.patch.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: '' } }))), 422)
    installNitro([[collectionRow()], []])
    handler = await loadHandler('api/songs/collections/[id]/index.patch.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: 'Ensayo' } }))), 404)
    await expectGuarded(handler, { method: 'PATCH', params: { id: UUID }, body: { name: 'Ensayo' } })
  })
})

describe('DELETE /api/songs/collections/:id', () => {
  it('el autor o un admin eliminan (204) sin tocar las canciones; un editor ajeno recibe 403', async () => {
    for (const auth of [authAs(), admin]) {
      const fake = installNitro([[collectionRow()], []])
      const handler = await loadHandler('api/songs/collections/[id]/index.delete.ts')
      const event = makeEvent({ auth, method: 'DELETE', params: { id: UUID } })
      expect(await handler(event)).toBeNull()
      expect(event.node.res.statusCode).toBe(204)
      const deletes = fake.calls.filter(c => c.method === 'delete')
      expect(deletes).toHaveLength(1)
      expect((deletes[0]!.args[0] as { [k: symbol]: unknown })).toBeDefined()
    }
    const fake = installNitro([[collectionRow()]])
    const handler = await loadHandler('api/songs/collections/[id]/index.delete.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ auth: otherEditor, method: 'DELETE', params: { id: UUID } }))), 403)
    expect(fake.calls.some(c => c.method === 'delete')).toBe(false)
  })

  it('inexistente → 404; exige sesión', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/songs/collections/[id]/index.delete.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'DELETE', params: { id: UUID } }))), 404)
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID } })
  })
})

describe('POST /api/songs/collections/:id/items', () => {
  it('agrega (added true) y sube la colección; repetida → added false sin duplicar ni subirla', async () => {
    let fake = installNitro([[{ id: UUID }], [{ id: UUID2 }], [{ songId: UUID2 }], []])
    let handler = await loadHandler('api/songs/collections/[id]/items/index.post.ts')
    expect(await handler(makeEvent({ auth: otherEditor, params: { id: UUID }, body: { songId: UUID2 } }))).toEqual({ added: true })
    expect(fake.calls.some(c => c.method === 'onConflictDoNothing')).toBe(true)
    expect(fake.calls.filter(c => c.method === 'update')).toHaveLength(1)

    fake = installNitro([[{ id: UUID }], [{ id: UUID2 }], []])
    handler = await loadHandler('api/songs/collections/[id]/items/index.post.ts')
    expect(await handler(makeEvent({ params: { id: UUID }, body: { songId: UUID2 } }))).toEqual({ added: false })
    expect(fake.calls.some(c => c.method === 'update')).toBe(false)
  })

  it('colección o canción inexistentes → 404; songId inválido → 422', async () => {
    installNitro([[], [{ id: UUID2 }]])
    let handler = await loadHandler('api/songs/collections/[id]/items/index.post.ts')
    expect((await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { songId: UUID2 } }))), 404)).message).toBe('Esa colección ya no existe.')
    installNitro([[{ id: UUID }], []])
    handler = await loadHandler('api/songs/collections/[id]/items/index.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { songId: UUID2 } }))), 404)
    installNitro([])
    handler = await loadHandler('api/songs/collections/[id]/items/index.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { songId: 'x' } }))), 422)
    await expectGuarded(handler, { params: { id: UUID }, body: { songId: UUID2 } })
  })
})

describe('DELETE /api/songs/collections/:id/items/:songId', () => {
  it('cualquier editor quita (204) y la colección sube solo si cambió', async () => {
    let fake = installNitro([[{ songId: UUID2 }], []])
    let handler = await loadHandler('api/songs/collections/[id]/items/[songId].delete.ts')
    const event = makeEvent({ auth: otherEditor, method: 'DELETE', params: { id: UUID, songId: UUID2 } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.filter(c => c.method === 'update')).toHaveLength(1)

    fake = installNitro([[]])
    handler = await loadHandler('api/songs/collections/[id]/items/[songId].delete.ts')
    await handler(makeEvent({ method: 'DELETE', params: { id: UUID, songId: UUID2 } }))
    expect(fake.calls.some(c => c.method === 'update')).toBe(false)
  })

  it('ids sin forma → 404 sin consultar; exige sesión', async () => {
    const fake = installNitro([])
    const handler = await loadHandler('api/songs/collections/[id]/items/[songId].delete.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { id: UUID, songId: 'x' } }))), 404)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { id: 'x', songId: UUID2 } }))), 404)
    expect(fake.calls).toHaveLength(0)
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID, songId: UUID2 } })
  })
})
