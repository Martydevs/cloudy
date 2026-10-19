import { afterEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { folders } from '../../server/db/schema'
import {
  assertNoCycle,
  buildBreadcrumbs,
  folderItemCountSql,
  folderPaths,
  getVisibleFolder,
  retryOnUniqueViolation,
  takenNames,
  toFileItem,
  toFolderItem,
} from '../../server/utils/files'
import { commentCountSql, decodeCursor, encodeCursor, filesKeyset, PAGE_SIZE } from '../../server/utils/pagination'
import { getVisibleFile } from '../../server/utils/file-access'
import { fakeDb } from './helpers/fake-db'

const created = new Date('2026-10-14T10:00:00.000Z')
const fileRow = {
  id: 'f1',
  folderId: null,
  name: 'foto.jpg',
  extension: 'jpg',
  mimeType: 'image/jpeg',
  category: 'image' as const,
  sizeBytes: 2048,
  storageKey: 'files/f1',
  thumbKey: 'thumbs/f1.webp',
  uploadStatus: 'ready' as const,
  origin: 'team' as const,
  uploadedBy: 'u1',
  guestName: null,
  submissionId: null,
  createdAt: created,
  updatedAt: created,
  deletedAt: null,
  deletedBy: null,
  trashRootId: null,
  uploaderName: 'Ana',
}

function useFakeDb(results: unknown[]) {
  const fake = fakeDb(results)
  vi.stubGlobal('useDb', () => fake.db)
  return fake
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapeos', () => {
  it('toFileItem', () => {
    expect(toFileItem(fileRow, { commentCount: 2 })).toEqual({
      id: 'f1',
      folderId: null,
      name: 'foto.jpg',
      extension: 'jpg',
      mimeType: 'image/jpeg',
      category: 'image',
      sizeBytes: 2048,
      hasThumbnail: true,
      origin: 'team',
      uploadedBy: { id: 'u1', name: 'Ana' },
      guestName: null,
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
      commentCount: 2,
    })
    expect(toFileItem({ ...fileRow, uploadedBy: null, origin: 'guest', guestName: 'Luis', thumbKey: null }).uploadedBy).toBeNull()
    expect(toFileItem({ ...fileRow, uploaderName: null }).uploadedBy).toEqual({ id: 'u1', name: 'Usuario' })
  })

  it('toFolderItem', () => {
    const folder = { id: 'd1', parentId: null, name: 'Domingo', createdBy: 'u1', createdAt: created, updatedAt: created, deletedAt: null, deletedBy: null, trashRootId: null }
    expect(toFolderItem(folder)).not.toHaveProperty('itemCount')
    expect(toFolderItem(folder, 3).itemCount).toBe(3)
  })
})

describe('consultas de carpetas', () => {
  it('takenNames devuelve los nombres que podrían chocar', async () => {
    useFakeDb([[{ name: 'foto.jpg' }, { name: 'foto (2).jpg' }], [{ name: 'Domingo' }]])
    expect(await takenNames('file', null, 'foto.jpg')).toEqual(new Set(['foto.jpg', 'foto (2).jpg']))
    expect(await takenNames('folder', 'd1', 'Domingo', 'd2')).toEqual(new Set(['Domingo']))
  })

  it('getVisibleFolder responde 404 si no existe', async () => {
    useFakeDb([[{ id: 'd1' }], []])
    expect(await getVisibleFolder('d1')).toEqual({ id: 'd1' })
    await expect(getVisibleFolder('x')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('buildBreadcrumbs empieza siempre en la raíz', async () => {
    const fake = useFakeDb([{ rows: [{ id: 'a', name: 'Domingo', depth: 1 }, { id: 'b', name: 'Fotos', depth: 0 }] }])
    expect(await buildBreadcrumbs(null)).toEqual([{ id: null, name: 'Archivos' }])
    expect(await buildBreadcrumbs('b')).toEqual([
      { id: null, name: 'Archivos' },
      { id: 'a', name: 'Domingo' },
      { id: 'b', name: 'Fotos' },
    ])
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
  })

  it('folderPaths agrupa la ruta de cada carpeta en una sola consulta', async () => {
    const fake = useFakeDb([{ rows: [
      { start_id: 'b', name: 'Domingo', depth: 1 },
      { start_id: 'b', name: 'Fotos', depth: 0 },
      { start_id: 'a', name: 'Domingo', depth: 0 },
    ] }])
    expect(await folderPaths([])).toEqual(new Map())
    const paths = await folderPaths(['b', 'a', null, 'b'])
    expect(paths.get('b')).toEqual(['Domingo', 'Fotos'])
    expect(paths.get('a')).toEqual(['Domingo'])
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
  })

  it('assertNoCycle', async () => {
    useFakeDb([{ rows: [] }, { rows: [{ hit: 1 }] }])
    await expect(assertNoCycle('a', null)).resolves.toBeUndefined()
    await expect(assertNoCycle('a', 'a')).rejects.toMatchObject({ statusCode: 409 })
    await expect(assertNoCycle('a', 'b')).resolves.toBeUndefined()
    await expect(assertNoCycle('a', 'c')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('getVisibleFile responde 404 si está en la papelera o no existe', async () => {
    useFakeDb([[fileRow], []])
    expect((await getVisibleFile('f1')).name).toBe('foto.jpg')
    await expect(getVisibleFile('x')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('retryOnUniqueViolation', () => {
  it('reintenta ante 23505 y luego se rinde', async () => {
    const unique = Object.assign(new Error('dup'), { code: '23505' })
    const fn = vi.fn().mockRejectedValueOnce(unique).mockResolvedValueOnce('ok')
    expect(await retryOnUniqueViolation(fn)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)

    const always = vi.fn().mockRejectedValue({ cause: { code: '23505' } })
    await expect(retryOnUniqueViolation(always, 2)).rejects.toEqual({ cause: { code: '23505' } })
    expect(always).toHaveBeenCalledTimes(2)
  })

  it('no reintenta otros errores', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('otro'))
    await expect(retryOnUniqueViolation(fn)).rejects.toThrow('otro')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('paginación por cursor', () => {
  it('codifica y decodifica', () => {
    const cursor = encodeCursor({ v: 'foto.jpg', id: 'f1' })
    expect(decodeCursor(cursor)).toEqual({ v: 'foto.jpg', id: 'f1' })
    expect(decodeCursor(undefined)).toBeNull()
  })

  it('un cursor inválido es 422', () => {
    expect(() => decodeCursor('no-es-base64-json')).toThrow()
    expect(() => decodeCursor(Buffer.from('{"v":1}').toString('base64url'))).toThrow()
    try {
      decodeCursor('x')
    }
    catch (error) {
      expect(error).toMatchObject({ statusCode: 422 })
    }
  })

  it('filesKeyset arma el orden y el siguiente cursor', () => {
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `f${i}`, name: `Foto ${i}.jpg`, sizeBytes: i, createdAt: created }))
    const byName = filesKeyset('name', 'asc', undefined)
    expect(byName.where).toBeUndefined()
    expect(byName.orderBy).toHaveLength(2)
    expect(decodeCursor(byName.nextCursor(rows)!)).toEqual({ v: `foto ${PAGE_SIZE - 1}.jpg`, id: `f${PAGE_SIZE - 1}` })
    expect(byName.nextCursor(rows.slice(1))).toBeNull()

    expect(decodeCursor(filesKeyset('size', 'desc', undefined).nextCursor(rows)!)!.v).toBe(String(PAGE_SIZE - 1))
    expect(decodeCursor(filesKeyset('date', 'desc', undefined).nextCursor(rows)!)!.v).toBe(created.toISOString())

    const after = filesKeyset('date', 'desc', encodeCursor({ v: created.toISOString(), id: 'f1' }))
    expect(after.where).toBeDefined()
    expect(filesKeyset('size', 'asc', encodeCursor({ v: '10', id: 'f1' })).where).toBeDefined()
    expect(filesKeyset('name', 'asc', encodeCursor({ v: 'a', id: 'f1' })).where).toBeDefined()
    expect(commentCountSql()).toBeDefined()
  })
})

// T162, defecto 1: las tarjetas de carpeta decían «0 elementos» siempre. En la selección de una
// consulta sin join drizzle imprime `${folders.id}` como `"id"` y la subconsulta lo resolvía contra
// su propia tabla. Se comprueba el SQL real que genera el select (sqlText() no pasa por ese camino).
describe('folderItemCountSql', () => {
  it('referencia la carpeta exterior con el nombre calificado dentro de un select sin join', () => {
    const db = drizzle(neon('postgres://usuario:clave@localhost/cloudy'))
    const { sql } = db.select({ folder: folders, itemCount: folderItemCountSql() }).from(folders).toSQL()
    expect(sql).toMatch(/c\.parent_id = "folders"\."id"/)
    expect(sql).toMatch(/f\.folder_id = "folders"\."id"/)
    expect(sql).not.toMatch(/= "id"/)
  })
})
