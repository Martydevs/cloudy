// T043 — Endpoints de listas de YouTube (feature 005, contracts/api.md § Listas): validación, creación con video en un
// solo lote, detalle, permisos de autor o admin, agregar sin duplicar y quitar idempotente.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authAs, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, UUID } from './helpers/nitro'
import { playlistRow } from './helpers/youtube'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const otherEditor = authAs({ userId: 'u2', name: 'Luis', role: 'editor' })
const admin = authAs({ userId: 'u9', name: 'Pastor', role: 'admin' })
const storedVideo = { videoId: 'okShortVid1', title: 'Alabanza', channel: null, durationSeconds: 60, thumbnailUrl: 'https://i.ytimg.com/a.jpg' }

describe('GET /api/youtube/playlists', () => {
  it('devuelve { items } sin caché', async () => {
    installNitro([[playlistRow()]])
    const handler = await loadHandler('api/youtube/playlists/index.get.ts')
    const event = makeEvent()
    expect(await handler(event)).toEqual({ items: [expect.objectContaining({ id: UUID, name: 'Domingo', itemCount: 3 })] })
    expect(event.node.res.getHeader('Cache-Control')).toBe('no-store')
    await expectGuarded(handler)
  })
})

describe('POST /api/youtube/playlists', () => {
  it.each([[''], ['    '], ['a'.repeat(81)]])('422 con el nombre %j', async (name) => {
    const fake = installNitro()
    const handler = await loadHandler('api/youtube/playlists/index.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ body: { name } }))), 422)
    expect(fake.calls).toHaveLength(0)
  })

  it('con videoId crea la lista y su elemento en un solo db.batch y responde 201', async () => {
    vi.useFakeTimers({ now: created, toFake: ['Date'] })
    const fake = installNitro([[storedVideo], [], []])
    const handler = await loadHandler('api/youtube/playlists/index.post.ts')
    const event = makeEvent({ body: { name: '  Domingo  ', videoId: 'okShortVid1' } })
    const playlist = await handler(event) as { id: string }
    expect(event.node.res.statusCode).toBe(201)
    expect(playlist).toMatchObject({
      name: 'Domingo',
      author: { userId: 'u1', name: 'Ana', active: true },
      itemCount: 1,
      covers: ['https://i.ytimg.com/a.jpg'],
      createdAt: created.toISOString(),
    })
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect((fake.db.batch.mock.calls[0]![0] as unknown[]).length).toBe(2)
    const values = fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
    expect(values[0]).toMatchObject({ id: playlist.id, name: 'Domingo', createdBy: 'u1' })
    expect(values[1]).toMatchObject({ playlistId: playlist.id, videoId: 'okShortVid1', addedBy: 'u1' })
  })

  it('sin videoId crea una lista vacía', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/youtube/playlists/index.post.ts')
    expect(await handler(makeEvent({ body: { name: 'Ensayo' } }))).toMatchObject({ itemCount: 0, covers: [] })
    expect((fake.db.batch.mock.calls[0]![0] as unknown[]).length).toBe(1)
  })

  it('404 sin crear nada si el video no está guardado', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/youtube/playlists/index.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ body: { name: 'Domingo', videoId: 'okShortVid1' } }))), 404)
    expect(fake.db.batch).not.toHaveBeenCalled()
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
    await expectGuarded(handler, { body: { name: 'Domingo' } })
  })
})

describe('GET /api/youtube/playlists/:id', () => {
  it('detalle con items por added_at DESC y addedBy, en un solo batch', async () => {
    const item = { ...storedVideo, addedAt: created, addedBy: 'u2', adderName: 'Luis', adderStatus: 'active' }
    const fake = installNitro([[playlistRow()], [item]])
    const handler = await loadHandler('api/youtube/playlists/[id]/index.get.ts')
    const detail = await handler(makeEvent({ params: { id: UUID } })) as { items: unknown[] }
    expect(detail).toMatchObject({ id: UUID, name: 'Domingo' })
    expect(detail.items).toEqual([{ ...storedVideo, addedAt: created.toISOString(), addedBy: { userId: 'u2', name: 'Luis', active: true } }])
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
  })

  it('404 si no es uuid o no existe', async () => {
    installNitro([[], []])
    const handler = await loadHandler('api/youtube/playlists/[id]/index.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ params: { id: 'x' } }))), 404)
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)
    await expectGuarded(handler, { params: { id: UUID } })
  })
})

describe('PATCH /api/youtube/playlists/:id', () => {
  it('el autor renombra y se refresca updated_at', async () => {
    const later = new Date('2026-10-15T10:00:00.000Z')
    const fake = installNitro([[playlistRow()], [{ updatedAt: later }]])
    const handler = await loadHandler('api/youtube/playlists/[id]/index.patch.ts')
    expect(await handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: ' Ensayo ' } })))
      .toMatchObject({ name: 'Ensayo', updatedAt: later.toISOString() })
    expect(fake.calls.find(c => c.method === 'set')!.args[0]).toMatchObject({ name: 'Ensayo' })
  })

  it('el admin renombra una lista ajena; otro editor recibe 403 con el texto', async () => {
    installNitro([[playlistRow()], [{ updatedAt: created }], [playlistRow()]])
    const handler = await loadHandler('api/youtube/playlists/[id]/index.patch.ts')
    await expect(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: 'Nuevo' }, auth: admin }))).resolves.toMatchObject({ name: 'Nuevo' })
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: 'Nuevo' }, auth: otherEditor }))), 403)
    expect(error.message).toBe('Solo quien la creó o un administrador puede cambiar esta lista.')
  })

  it('422 con un nombre inválido y 404 si desaparece', async () => {
    installNitro([[playlistRow()], []])
    const handler = await loadHandler('api/youtube/playlists/[id]/index.patch.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: '' } }))), 422)
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: 'Ok' } }))), 404)
    await expectGuarded(handler, { method: 'PATCH', params: { id: UUID }, body: { name: 'Ok' } })
  })
})

describe('DELETE /api/youtube/playlists/:id', () => {
  it('204 para el autor o el admin; 403 para otro editor sin borrar nada', async () => {
    const fake = installNitro([[playlistRow()], [], [playlistRow()], [], [playlistRow()]])
    const handler = await loadHandler('api/youtube/playlists/[id]/index.delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { id: UUID } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(await handler(makeEvent({ method: 'DELETE', params: { id: UUID }, auth: admin }))).toBeNull()
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'DELETE', params: { id: UUID }, auth: otherEditor }))), 403)
    expect(fake.calls.filter(c => c.method === 'delete')).toHaveLength(2)
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID } })
  })
})

describe('POST /api/youtube/playlists/:id/items', () => {
  it('{ added: true } y refresca la lista; { added: false } si ya estaba, sin refrescar', async () => {
    const fake = installNitro([
      [{ id: UUID }], [{ videoId: 'okShortVid1' }], [{ videoId: 'okShortVid1' }], [],
      [{ id: UUID }], [{ videoId: 'okShortVid1' }], [],
    ])
    const handler = await loadHandler('api/youtube/playlists/[id]/items/index.post.ts')
    expect(await handler(makeEvent({ params: { id: UUID }, body: { videoId: 'okShortVid1' }, auth: otherEditor }))).toEqual({ added: true })
    expect(fake.calls.filter(c => c.method === 'update')).toHaveLength(1)
    expect(await handler(makeEvent({ params: { id: UUID }, body: { videoId: 'okShortVid1' } }))).toEqual({ added: false })
    expect(fake.calls.filter(c => c.method === 'update')).toHaveLength(1)
  })

  it('404 si la lista o el video no existen; 422 con un ID inválido', async () => {
    installNitro([[], [{ videoId: 'okShortVid1' }], [{ id: UUID }], []])
    const handler = await loadHandler('api/youtube/playlists/[id]/items/index.post.ts')
    const missingList = await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { videoId: 'okShortVid1' } }))), 404)
    expect(missingList.message).toBe('Esa lista ya no existe.')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { videoId: 'okShortVid1' } }))), 404)
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { videoId: 'x' } }))), 422)
    await expectGuarded(handler, { params: { id: UUID }, body: { videoId: 'okShortVid1' } })
  })
})

describe('DELETE /api/youtube/playlists/:id/items/:videoId', () => {
  it('204 idempotente; refresca la lista solo si quitó algo', async () => {
    const fake = installNitro([[{ videoId: 'okShortVid1' }], [], []])
    const handler = await loadHandler('api/youtube/playlists/[id]/items/[videoId].delete.ts')
    const params = { id: UUID, videoId: 'okShortVid1' }
    expect(await handler(makeEvent({ method: 'DELETE', params, auth: otherEditor }))).toBeNull()
    expect(await handler(makeEvent({ method: 'DELETE', params }))).toBeNull()
    expect(fake.calls.filter(c => c.method === 'update')).toHaveLength(1)
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ method: 'DELETE', params: { id: UUID, videoId: 'x' } }))), 404)
    await expectGuarded(handler, { method: 'DELETE', params })
  })
})
