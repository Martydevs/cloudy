// T042 — Reglas y consultas de las listas de YouTube (feature 005, data-model.md, research D11–D12).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addPlaylistItem,
  canManagePlaylist,
  getManagedPlaylist,
  listPlaylistsQuery,
  toYoutubePlaylist,
  toYoutubePlaylistItem,
  touchPlaylist,
} from '../../server/utils/youtube-playlists'
import { created, expectStatus, installNitro, sqlText, UUID } from './helpers/nitro'
import { playlistRow } from './helpers/youtube'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('consulta de la fila Listas', () => {
  it('una sola sentencia con conteo y hasta 4 miniaturas por subconsulta, ordenada por updated_at DESC', async () => {
    const fake = installNitro([[playlistRow()]])
    const rows = await listPlaylistsQuery()
    expect(rows).toHaveLength(1)
    expect(fake.calls.filter(c => c.method === 'select')).toHaveLength(1)
    const columns = fake.calls.find(c => c.method === 'select')!.args[0] as Record<string, unknown>
    expect(sqlText(columns.itemCount)).toContain('count(*)::int FROM youtube_playlist_items')
    const covers = sqlText(columns.covers)
    expect(covers).toContain('json_agg')
    expect(covers).toContain('ORDER BY i.added_at DESC LIMIT')
    expect(covers).toContain('4')
    const order = fake.calls.find(c => c.method === 'orderBy')!.args.map(sqlText)
    expect(order[0]).toContain('"updated_at" desc')
    expect(fake.calls.some(c => c.method === 'leftJoin')).toBe(true)
  })
})

describe('mapeo', () => {
  it('toYoutubePlaylist con autor activo o inactivo y conteo numérico', () => {
    expect(toYoutubePlaylist(playlistRow() as never)).toEqual({
      id: UUID,
      name: 'Domingo',
      author: { userId: 'u1', name: 'Ana', active: true },
      itemCount: 3,
      covers: ['https://i.ytimg.com/a.jpg', 'https://i.ytimg.com/b.jpg'],
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
    })
    expect(toYoutubePlaylist(playlistRow({ authorStatus: 'removed', authorName: null, itemCount: '7', covers: null }) as never))
      .toMatchObject({ author: { name: 'Usuario', active: false }, itemCount: 7, covers: [] })
    expect(toYoutubePlaylist(playlistRow({ covers: ['1', '2', '3', '4', '5', null] }) as never).covers).toEqual(['1', '2', '3', '4'])
  })

  it('toYoutubePlaylistItem con quién lo agregó', () => {
    expect(toYoutubePlaylistItem({
      videoId: 'okShortVid1', title: 'A', channel: null, durationSeconds: 10, thumbnailUrl: null,
      addedAt: created, addedBy: 'u2', adderName: 'Luis', adderStatus: 'disabled',
    })).toEqual({
      videoId: 'okShortVid1', title: 'A', channel: null, durationSeconds: 10, thumbnailUrl: null,
      addedAt: created.toISOString(), addedBy: { userId: 'u2', name: 'Luis', active: false },
    })
  })
})

describe('permisos', () => {
  it('canManagePlaylist: el autor y el admin sí; otro editor no', () => {
    expect(canManagePlaylist({ userId: 'u1', role: 'editor' }, { createdBy: 'u1' })).toBe(true)
    expect(canManagePlaylist({ userId: 'u9', role: 'admin' }, { createdBy: 'u1' })).toBe(true)
    expect(canManagePlaylist({ userId: 'u2', role: 'editor' }, { createdBy: 'u1' })).toBe(false)
    expect(canManagePlaylist({ userId: 'u2', role: null }, { createdBy: 'u1' })).toBe(false)
  })

  it('getManagedPlaylist: 404 si no existe, 403 con el texto para otro editor', async () => {
    installNitro([[], [playlistRow()], [playlistRow()]])
    await expectStatus(getManagedPlaylist(UUID, { userId: 'u1', role: 'editor' }), 404)
    const error = await expectStatus(getManagedPlaylist(UUID, { userId: 'u2', role: 'editor' }), 403)
    expect(error.message).toBe('Solo quien la creó o un administrador puede cambiar esta lista.')
    await expect(getManagedPlaylist(UUID, { userId: 'u9', role: 'admin' })).resolves.toMatchObject({ id: UUID })
  })
})

describe('agregar sin duplicar', () => {
  it('addPlaylistItem usa ON CONFLICT DO NOTHING RETURNING; touchPlaylist refresca updated_at', async () => {
    const fake = installNitro([[{ videoId: 'okShortVid1' }], [], []])
    expect(await addPlaylistItem(UUID, 'okShortVid1', 'u1')).toHaveLength(1)
    expect(await addPlaylistItem(UUID, 'okShortVid1', 'u1')).toHaveLength(0)
    expect(fake.calls.filter(c => c.method === 'onConflictDoNothing')).toHaveLength(2)
    expect(fake.calls.filter(c => c.method === 'returning')).toHaveLength(2)
    expect(fake.calls.find(c => c.method === 'values')!.args[0]).toEqual({ playlistId: UUID, videoId: 'okShortVid1', addedBy: 'u1' })
    await touchPlaylist(UUID)
    expect(Object.keys(fake.calls.find(c => c.method === 'set')!.args[0] as object)).toEqual(['updatedAt'])
  })
})
