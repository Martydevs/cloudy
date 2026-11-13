// Historial y colecciones de imágenes de Peticiones (feature 007, enmienda de historial): listado keyset sin repetir, ver y
// descargar por redirección firmada, eliminar solo autora o admin (fila y luego objeto), colecciones con conteo por
// subconsulta, creación atómica con imagen, agregar idempotente, quitar y permisos; y la limpieza de 30 días.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { authAs, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'
import { canManagePrayerImage, listPrayerImages, prayerImageColumns, prayerImageFilename, purgeExpiredPrayerImages, toPrayerGeneratedImage } from '../../server/utils/prayer-gallery'
import {
  canManagePrayerCollection,
  listPrayerCollectionsQuery,
  prayerCollectionColumns,
  prayerCollectionItemsQuery,
  toPrayerCollection,
} from '../../server/utils/prayer-collections'
import { encodeCursor } from '../../server/utils/pagination'

const s3 = vi.hoisted(() => ({
  putObject: vi.fn(async () => {}),
  deleteMany: vi.fn(async () => {}),
  presignGet: vi.fn(async () => 'https://bucket.test/signed'),
}))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

beforeEach(() => {
  s3.deleteMany.mockReset().mockResolvedValue(undefined)
  s3.presignGet.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const otherEditor = authAs({ userId: 'u2', name: 'Luis', role: 'editor' })
const admin = authAs({ userId: 'u9', name: 'Pastor', role: 'admin' })
const FILE = '00000000-0000-4000-8000-000000000001'

const imageRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID, storageKey: `pre/peticiones/${UUID}.png`, mediaType: 'image/png', fileIds: [FILE], createdBy: 'u1', createdAt: created,
  authorName: 'Ana', authorStatus: 'active', ...changes,
})
const collectionRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID, name: 'Domingo', createdBy: 'u1', createdAt: created, updatedAt: created, authorName: 'Ana', authorStatus: 'active', itemCount: 2, ...changes,
})

describe('prayer-gallery', () => {
  it('toPrayerGeneratedImage: URLs que no caducan, conteo y autor', () => {
    expect(toPrayerGeneratedImage(imageRow({ authorStatus: 'disabled', authorName: null }))).toEqual({
      id: UUID,
      previewUrl: `/api/peticiones/imagenes/${UUID}/content`,
      downloadUrl: `/api/peticiones/imagenes/${UUID}/content?download=1`,
      fileIds: [FILE],
      requestCount: 1,
      author: { userId: 'u1', name: 'Usuario', active: false },
      createdAt: created.toISOString(),
    })
  })

  it('prayerImageFilename: fecha UTC y 6 caracteres del id; un tipo raro cae en .png', () => {
    const late = new Date('2026-11-12T23:30:00.000-06:00')
    expect(prayerImageFilename({ id: UUID, mediaType: 'image/jpeg', createdAt: late })).toBe('peticiones-2026-11-13-3f2504.jpg')
    expect(prayerImageFilename({ id: UUID, mediaType: 'image/x', createdAt: created })).toBe('peticiones-2026-10-14-3f2504.png')
  })

  it('canManagePrayerImage: autora o admin', () => {
    expect(canManagePrayerImage({ userId: 'u1', role: 'editor' }, { createdBy: 'u1' })).toBe(true)
    expect(canManagePrayerImage({ userId: 'u2', role: 'editor' }, { createdBy: 'u1' })).toBe(false)
    expect(canManagePrayerImage({ userId: 'u9', role: 'admin' }, { createdBy: 'u1' })).toBe(true)
    expect(canManagePrayerImage({ userId: 'u3', role: null }, { createdBy: 'u1' })).toBe(false)
  })

  it('las columnas del historial traen el autor y nada que la tarjeta no use', () => {
    expect(Object.keys(prayerImageColumns)).toEqual(['id', 'storageKey', 'mediaType', 'fileIds', 'createdBy', 'createdAt', 'authorName', 'authorStatus'])
  })

  it('listPrayerImages: limit + 1 para saber si hay más; el cursor es la última fila y sigue con `<`', async () => {
    const rows = [imageRow(), imageRow({ id: UUID2, createdAt: new Date(created.getTime() - 1000) }), imageRow({ id: FILE })]
    const fake = installNitro([rows])
    const page = await listPrayerImages({ limit: 2 })
    expect(page.items.map(i => i.id)).toEqual([UUID, UUID2])
    expect(page.nextCursor).toBe(encodeCursor({ v: new Date(created.getTime() - 1000).toISOString(), id: UUID2 }))
    expect(fake.calls.find(c => c.method === 'limit')?.args[0]).toBe(3)
    expect(fake.calls.find(c => c.method === 'where')?.args[0]).toBeUndefined()

    const next = installNitro([[imageRow()]])
    const last = await listPrayerImages({ limit: 2, cursor: page.nextCursor! })
    expect(last.nextCursor).toBeNull()
    const where = sqlText(next.calls.find(c => c.method === 'where')?.args[0])
    expect(where).toContain('("prayer_images"."created_at", "prayer_images"."id") < ($1::timestamptz, $2::uuid)')
    expect(where).toContain(UUID2)
    const order = next.calls.find(c => c.method === 'orderBy')!.args.map(sqlText)
    expect(order).toEqual([expect.stringContaining('"prayer_images"."created_at" desc'), expect.stringContaining('"prayer_images"."id" desc')])
  })

  it('un cursor manipulado responde 422 sin consultar', async () => {
    const fake = installNitro()
    await expectStatus(listPrayerImages({ limit: 12, cursor: encodeCursor({ v: 'ayer', id: UUID }) }), 422)
    await expectStatus(listPrayerImages({ limit: 12, cursor: encodeCursor({ v: created.toISOString(), id: 'x' }) }), 422)
    expect(fake.calls.some(c => c.method === 'select')).toBe(false)
  })

  it('purgeExpiredPrayerImages: lotes de 500 de más de 30 días fuera de colecciones; filas y luego objetos', async () => {
    const batch = Array.from({ length: 500 }, (_, i) => ({ storageKey: `pre/peticiones/${i}.png` }))
    const fake = installNitro([batch, [{ storageKey: 'pre/peticiones/x.png' }]])
    expect(await purgeExpiredPrayerImages()).toBe(501)
    const where = sqlText(fake.calls.find(c => c.method === 'where')?.args[0])
    expect(where).toContain('make_interval(days => $1::int)')
    expect(where).toContain('[30,500]')
    expect(where).toContain('NOT EXISTS (SELECT 1 FROM prayer_image_collection_items i WHERE i.image_id = p.id)')
    expect(s3.deleteMany.mock.calls.map(c => (c as unknown as [string[]])[0].length)).toEqual([500, 1])
  })

  it('purgeExpiredPrayerImages: sin vencidas no borra objetos', async () => {
    installNitro([[]])
    expect(await purgeExpiredPrayerImages()).toBe(0)
    expect(s3.deleteMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/peticiones/imagenes', () => {
  it('página de 12 por defecto con no-store', async () => {
    const fake = installNitro([[imageRow()]])
    const handler = await loadHandler('api/peticiones/imagenes/index.get.ts')
    const event = makeEvent({ url: '/api/peticiones/imagenes' })
    expect(await handler(event)).toEqual({ items: [toPrayerGeneratedImage(imageRow())], nextCursor: null })
    expect(fake.calls.find(c => c.method === 'limit')?.args[0]).toBe(13)
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
    await expectGuarded(handler, { url: '/api/peticiones/imagenes' })
  })

  it.each(['limit=0', 'limit=49', 'limit=x', `cursor=${'a'.repeat(501)}`])('%s → 422 sin consultar', async (query) => {
    const fake = installNitro()
    const handler = await loadHandler('api/peticiones/imagenes/index.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: `/api/peticiones/imagenes?${query}` }))), 422)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('GET /api/peticiones/imagenes/:id/content', () => {
  it('302 a la URL firmada; con ?download=1 pide Content-Disposition con el nombre por fecha', async () => {
    installNitro([[imageRow()], [imageRow()]])
    const handler = await loadHandler('api/peticiones/imagenes/[id]/content.get.ts')
    const view = makeEvent({ url: `/api/peticiones/imagenes/${UUID}/content`, params: { id: UUID } })
    await handler(view)
    expect(view.node.res.statusCode).toBe(302)
    expect(view.node.res.getHeader('location')).toBe('https://bucket.test/signed')
    expect(view.node.res.getHeader('Cache-Control')).toBe('private, max-age=600')
    expect(s3.presignGet).toHaveBeenLastCalledWith(`pre/peticiones/${UUID}.png`, {})
    await handler(makeEvent({ url: `/api/peticiones/imagenes/${UUID}/content?download=1`, params: { id: UUID } }))
    expect(s3.presignGet).toHaveBeenLastCalledWith(`pre/peticiones/${UUID}.png`, { download: 'peticiones-2026-10-14-3f2504.png' })
  })

  it('404 si ya no existe o el id no es UUID; exige sesión de equipo', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/peticiones/imagenes/[id]/content.get.ts')
    expect((await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: UUID } }))), 404)).message).toBe('Esa imagen ya no está guardada.')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: 'x' } }))), 404)
    await expectGuarded(handler, { params: { id: UUID } })
  })
})

describe('DELETE /api/peticiones/imagenes/:id', () => {
  it('la autora la elimina: fila y luego objeto, 204', async () => {
    const fake = installNitro([[imageRow()], []])
    const handler = await loadHandler('api/peticiones/imagenes/[id]/index.delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { id: UUID } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.some(c => c.method === 'delete')).toBe(true)
    expect(s3.deleteMany).toHaveBeenCalledWith([`pre/peticiones/${UUID}.png`])
  })

  it('un admin elimina la ajena; si el objeto no se borra, se registra y la respuesta sigue siendo 204', async () => {
    s3.deleteMany.mockRejectedValue(new Error('bucket'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    installNitro([[imageRow()], []])
    const handler = await loadHandler('api/peticiones/imagenes/[id]/index.delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { id: UUID }, auth: admin })
    expect(await handler(event)).toBeNull()
    expect(error).toHaveBeenCalledWith('[prayer-image] object not deleted')
    error.mockRestore()
  })

  it('otra persona del equipo recibe 403 sin borrar nada; 404 si ya no existe', async () => {
    const fake = installNitro([[imageRow()]])
    const handler = await loadHandler('api/peticiones/imagenes/[id]/index.delete.ts')
    const forbidden = await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { id: UUID }, auth: otherEditor }))), 403)
    expect(forbidden.message).toBe('Solo quien la generó o un administrador puede eliminar esta imagen.')
    expect(fake.calls.some(c => c.method === 'delete')).toBe(false)
    expect(s3.deleteMany).not.toHaveBeenCalled()

    installNitro([[]])
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { id: UUID } }))), 404)
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID } })
  })
})

describe('prayer-collections', () => {
  it('el conteo es una subconsulta y el detalle une autor y quien agregó (sin N+1)', () => {
    installNitro([], { useDb: () => new QueryBuilder() })
    expect(sqlText(prayerCollectionColumns.itemCount)).toContain('SELECT count(*)::int FROM prayer_image_collection_items i WHERE i.collection_id')
    expect(listPrayerCollectionsQuery().toSQL().sql).toContain('order by "prayer_image_collections"."updated_at" desc')
    const items = prayerCollectionItemsQuery(UUID).toSQL().sql
    expect(items).toContain('left join "profiles" "author"')
    expect(items).toContain('left join "profiles" "adder"')
    expect(items).toContain('order by "prayer_image_collection_items"."added_at" asc')
  })

  it('canManagePrayerCollection: autor o admin; un conteo nulo se entrega como 0', () => {
    expect(canManagePrayerCollection({ userId: 'u1', role: 'editor' }, { createdBy: 'u1' })).toBe(true)
    expect(canManagePrayerCollection({ userId: 'u2', role: 'editor' }, { createdBy: 'u1' })).toBe(false)
    expect(canManagePrayerCollection({ userId: 'u9', role: 'admin' }, { createdBy: 'u1' })).toBe(true)
    expect(toPrayerCollection(collectionRow({ itemCount: null })).itemCount).toBe(0)
  })
})

describe('GET /api/peticiones/colecciones', () => {
  it('{ items } con autor y conteo, sin caché', async () => {
    installNitro([[collectionRow(), collectionRow({ id: UUID2, authorName: null, authorStatus: 'disabled', itemCount: '0' })]])
    const handler = await loadHandler('api/peticiones/colecciones/index.get.ts')
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

describe('POST /api/peticiones/colecciones', () => {
  it.each([[''], ['    '], ['a'.repeat(81)]])('422 con el nombre %j sin tocar la base', async (name) => {
    const fake = installNitro()
    const handler = await loadHandler('api/peticiones/colecciones/index.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ body: { name } }))), 422)
    expect(fake.calls).toHaveLength(0)
  })

  it('con imageId crea la colección y su elemento en un solo db.batch (201)', async () => {
    vi.useFakeTimers({ now: created, toFake: ['Date'] })
    const fake = installNitro([[{ id: UUID2 }], [], []])
    const handler = await loadHandler('api/peticiones/colecciones/index.post.ts')
    const event = makeEvent({ body: { name: '  Domingo  ', imageId: UUID2 } })
    const collection = await handler(event) as { id: string }
    expect(event.node.res.statusCode).toBe(201)
    expect(collection).toMatchObject({ name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 1, createdAt: created.toISOString() })
    expect((fake.db.batch.mock.calls[0]![0] as unknown[]).length).toBe(2)
    const values = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(values[0]).toMatchObject({ id: collection.id, name: 'Domingo', createdBy: 'u1' })
    expect(values[1]).toMatchObject({ collectionId: collection.id, imageId: UUID2, addedBy: 'u1' })
  })

  it('sin imageId crea una colección vacía', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/peticiones/colecciones/index.post.ts')
    expect(await handler(makeEvent({ body: { name: 'Ensayo' } }))).toMatchObject({ name: 'Ensayo', itemCount: 0 })
    expect((fake.db.batch.mock.calls[0]![0] as unknown[]).length).toBe(1)
  })

  it('una imagen que ya no existe → 404 y no se crea nada', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/peticiones/colecciones/index.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ body: { name: 'Domingo', imageId: UUID2 } }))), 404)
    expect(error.message).toBe('Esa imagen ya no está guardada.')
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
    await expectGuarded(handler, { body: { name: 'Domingo' } })
  })
})

describe('GET /api/peticiones/colecciones/:id', () => {
  it('la colección y sus imágenes en un solo viaje', async () => {
    const item = { ...imageRow(), addedAt: created, addedBy: 'u2', adderName: 'Luis', adderStatus: 'active' }
    const fake = installNitro([[collectionRow()], [item]])
    const handler = await loadHandler('api/peticiones/colecciones/[id]/index.get.ts')
    const event = makeEvent({ params: { id: UUID } })
    expect(await handler(event)).toEqual({
      ...toPrayerCollection(collectionRow()),
      items: [{ ...toPrayerGeneratedImage(imageRow()), addedAt: created.toISOString(), addedBy: { userId: 'u2', name: 'Luis', active: true } }],
    })
    expect(fake.db.batch).toHaveBeenCalledOnce()
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
  })

  it('404 si no existe', async () => {
    installNitro([[], []])
    const handler = await loadHandler('api/peticiones/colecciones/[id]/index.get.ts')
    expect((await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)).message).toBe('Esa colección ya no existe.')
    await expectGuarded(handler, { params: { id: UUID } })
  })
})

describe('PATCH y DELETE /api/peticiones/colecciones/:id', () => {
  it('renombrar: el autor, con el nombre recortado; la colección sube al inicio', async () => {
    const later = new Date('2026-11-12T10:00:00.000Z')
    const fake = installNitro([[collectionRow()], [{ updatedAt: later }]])
    const handler = await loadHandler('api/peticiones/colecciones/[id]/index.patch.ts')
    expect(await handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: ' Ensayo ' } }))).toMatchObject({ name: 'Ensayo', updatedAt: later.toISOString() })
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ name: 'Ensayo' })
  })

  it('renombrar: 403 a otro editor, 404 si se borró mientras tanto, 422 con nombre vacío', async () => {
    installNitro([[collectionRow()]])
    const handler = await loadHandler('api/peticiones/colecciones/[id]/index.patch.ts')
    const forbidden = await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: 'X' }, auth: otherEditor }))), 403)
    expect(forbidden.message).toBe('Solo quien la creó o un administrador puede cambiar esta colección.')
    installNitro([[collectionRow()], []])
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: 'X' } }))), 404)
    const fake = installNitro()
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: ' ' } }))), 422)
    expect(fake.calls).toHaveLength(0)
    await expectGuarded(handler, { method: 'PATCH', params: { id: UUID }, body: { name: 'X' } })
  })

  it('eliminar: un admin la ajena (204); otro editor 403 sin borrar', async () => {
    const fake = installNitro([[collectionRow()], []])
    const handler = await loadHandler('api/peticiones/colecciones/[id]/index.delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { id: UUID }, auth: admin })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.some(c => c.method === 'delete')).toBe(true)

    const other = installNitro([[collectionRow()]])
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'DELETE', params: { id: UUID }, auth: otherEditor }))), 403)
    expect(other.calls.some(c => c.method === 'delete')).toBe(false)
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID } })
  })
})

describe('elementos de una colección', () => {
  it('agregar: cualquier persona del equipo; nueva → added y la colección sube; repetida → added: false sin tocarla', async () => {
    const fake = installNitro([[{ id: UUID }], [{ id: UUID2 }], [{ imageId: UUID2 }], []])
    const handler = await loadHandler('api/peticiones/colecciones/[id]/items/index.post.ts')
    expect(await handler(makeEvent({ params: { id: UUID }, body: { imageId: UUID2 }, auth: otherEditor }))).toEqual({ added: true })
    expect(fake.calls.some(c => c.method === 'onConflictDoNothing')).toBe(true)
    expect(fake.calls.some(c => c.method === 'update')).toBe(true)

    const again = installNitro([[{ id: UUID }], [{ id: UUID2 }], []])
    expect(await handler(makeEvent({ params: { id: UUID }, body: { imageId: UUID2 } }))).toEqual({ added: false })
    expect(again.calls.some(c => c.method === 'update')).toBe(false)
  })

  it('agregar: 404 si la colección o la imagen ya no existen; 422 sin imageId', async () => {
    installNitro([[], [{ id: UUID2 }]])
    const handler = await loadHandler('api/peticiones/colecciones/[id]/items/index.post.ts')
    expect((await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { imageId: UUID2 } }))), 404)).message).toBe('Esa colección ya no existe.')
    installNitro([[{ id: UUID }], []])
    expect((await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { imageId: UUID2 } }))), 404)).message).toBe('Esa imagen ya no está guardada.')
    const fake = installNitro()
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: {} }))), 422)
    expect(fake.calls).toHaveLength(0)
    await expectGuarded(handler, { params: { id: UUID }, body: { imageId: UUID2 } })
  })

  it('quitar: idempotente (204); solo toca la colección si algo cambió', async () => {
    const fake = installNitro([[{ imageId: UUID2 }], []])
    const handler = await loadHandler('api/peticiones/colecciones/[id]/items/[imageId].delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { id: UUID, imageId: UUID2 } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.some(c => c.method === 'update')).toBe(true)

    const again = installNitro([[]])
    expect(await handler(makeEvent({ method: 'DELETE', params: { id: UUID, imageId: UUID2 } }))).toBeNull()
    expect(again.calls.some(c => c.method === 'update')).toBe(false)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { id: UUID, imageId: 'x' } }))), 404)
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID, imageId: UUID2 } })
  })
})
