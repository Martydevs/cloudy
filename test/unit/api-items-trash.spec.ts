// Selección múltiple de Archivos: `POST /api/items/trash` envía varios archivos y carpetas a la papelera en un solo
// lote, salta lo que ya no está visible y registra la actividad de cada elemento (FR-011, FR-034).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authAs, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'
import { TRASH_BATCH_MAX } from '../../shared/validation/files'

afterEach(() => {
  vi.unstubAllGlobals()
})

const UUID3 = 'c0ffee00-1d2c-4e5f-8a9b-0c1d2e3f4a5b'
const UUID4 = 'deadbeef-1d2c-4e5f-8a9b-0c1d2e3f4a5b'
const uuidOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const handler = () => loadHandler<{ trashed: number, skipped: string[] }>('api/items/trash.post.ts')
const post = (body: unknown, auth = authAs()) => makeEvent({ method: 'POST', body, auth })

type Fake = ReturnType<typeof installNitro>
const sets = (fake: Fake) => fake.calls.filter(c => c.method === 'set').map(c => c.args[0])
const activity = (fake: Fake) => fake.calls.filter(c => c.method === 'values').map(c => c.args[0])
const selects = (fake: Fake) => fake.calls.filter(c => c.method === 'select').length
const batched = (fake: Fake) => (fake.db.batch.mock.calls[0]?.[0] ?? []) as unknown[]

describe('POST /api/items/trash', () => {
  it('envía archivos y carpetas a la papelera en un solo lote, con la actividad de cada uno', async () => {
    // Orden del doble: archivos visibles, carpetas visibles y el resultado de la sentencia de la carpeta.
    const fake = installNitro([
      [{ id: UUID, name: 'foto.jpg' }, { id: UUID2, name: 'audio.mp3' }],
      [{ id: UUID3, name: 'Domingo' }],
      { rows: [{ folders: 2, files: 5, logged: 1 }] },
    ])
    const run = await handler()
    const result = await run(post({ fileIds: [UUID, UUID2], folderIds: [UUID3] }))

    expect(result).toEqual({ trashed: 3, skipped: [] })
    // Dos consultas para toda la selección (sin N+1) y un solo lote: 2 archivos × (marcar + actividad) + 1 carpeta.
    expect(selects(fake)).toBe(2)
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect(batched(fake)).toHaveLength(5)

    // Cada archivo queda como raíz propia de la papelera, a nombre de quien lo eliminó.
    expect(sets(fake)).toEqual([
      expect.objectContaining({ deletedBy: 'u1', trashRootId: UUID, deletedAt: expect.any(Date) }),
      expect.objectContaining({ deletedBy: 'u1', trashRootId: UUID2, deletedAt: expect.any(Date) }),
    ])
    expect(activity(fake)).toEqual([
      expect.objectContaining({ actorId: 'u1', actorLabel: 'Ana', action: 'file.trash', targetType: 'file', targetId: UUID, targetLabel: 'foto.jpg' }),
      expect.objectContaining({ actorId: 'u1', actorLabel: 'Ana', action: 'file.trash', targetType: 'file', targetId: UUID2, targetLabel: 'audio.mp3' }),
    ])

    // La carpeta va con todo su contenido y su actividad en una sola sentencia (la misma del borrado individual).
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
    const folderSql = sqlText(fake.db.execute.mock.calls[0]![0])
    expect(folderSql).toContain('WITH RECURSIVE tree')
    expect(folderSql).toContain('\'folder.trash\'')
    expect(folderSql).toContain(UUID3)
    expect(folderSql).toContain('Domingo')
  })

  it('solo consulta lo visible: archivos listos y fuera de la papelera, carpetas fuera de la papelera', async () => {
    const fake = installNitro([[{ id: UUID, name: 'foto.jpg' }], [{ id: UUID3, name: 'Domingo' }], { rows: [] }])
    const run = await handler()
    await run(post({ fileIds: [UUID], folderIds: [UUID3] }))
    const [files, folders] = fake.calls.filter(c => c.method === 'where').map(c => sqlText(c.args[0]))
    expect(files).toMatch(/"files"\."id" in/)
    expect(files).toContain('"files"."deleted_at" is null')
    expect(files).toContain('"files"."upload_status" =')
    expect(files).toContain(UUID)
    expect(folders).toMatch(/"folders"\."id" in/)
    expect(folders).toContain('"folders"."deleted_at" is null')
    expect(folders).toContain(UUID3)
  })

  it('lo que ya no está visible se salta y se informa, sin fallar el resto', async () => {
    const fake = installNitro([[{ id: UUID, name: 'foto.jpg' }], []])
    const run = await handler()
    const result = await run(post({ fileIds: [UUID, UUID2], folderIds: [UUID3] }))
    expect(result).toEqual({ trashed: 1, skipped: [UUID2, UUID3] })
    expect(batched(fake)).toHaveLength(2)
    expect(sets(fake)).toHaveLength(1)
    expect(activity(fake)).toEqual([expect.objectContaining({ action: 'file.trash', targetId: UUID })])
    // Ninguna carpeta visible: no se ejecuta su sentencia ni se registra nada de ella.
    expect(fake.db.execute).not.toHaveBeenCalled()
  })

  it('si nada de la selección sigue visible no escribe nada y lo dice', async () => {
    const fake = installNitro([[], []])
    const run = await handler()
    expect(await run(post({ fileIds: [UUID], folderIds: [UUID3] }))).toEqual({ trashed: 0, skipped: [UUID, UUID3] })
    expect(fake.db.batch).not.toHaveBeenCalled()
    expect(fake.db.execute).not.toHaveBeenCalled()
    expect(activity(fake)).toEqual([])
  })

  it('los ids repetidos cuentan una vez; con un solo tipo solo se consulta ese', async () => {
    const onlyFiles = installNitro([[{ id: UUID, name: 'foto.jpg' }]])
    const run = await handler()
    expect(await run(post({ fileIds: [UUID, UUID, UUID.toUpperCase()] }))).toEqual({ trashed: 1, skipped: [] })
    expect(selects(onlyFiles)).toBe(1)
    expect(sets(onlyFiles)).toHaveLength(1)
    expect(batched(onlyFiles)).toHaveLength(2)

    const onlyFolders = installNitro([[{ id: UUID3, name: 'Domingo' }, { id: UUID4, name: 'Ensayo' }], { rows: [] }, { rows: [] }])
    const again = await handler()
    expect(await again(post({ folderIds: [UUID3, UUID4, UUID3] }))).toEqual({ trashed: 2, skipped: [] })
    expect(selects(onlyFolders)).toBe(1)
    expect(onlyFolders.db.execute).toHaveBeenCalledTimes(2)
    expect(batched(onlyFolders)).toHaveLength(2)
    expect(sets(onlyFolders)).toEqual([])
  })

  it.each([
    ['sin elementos', {}],
    ['listas vacías', { fileIds: [], folderIds: [] }],
    ['un id que no es uuid', { fileIds: ['f1'] }],
    ['una carpeta que no es uuid', { fileIds: [UUID], folderIds: ['root'] }],
    ['una lista que no es lista', { fileIds: UUID }],
    [`más de ${TRASH_BATCH_MAX} elementos`, { fileIds: Array.from({ length: 60 }, (_, i) => uuidOf(i)), folderIds: Array.from({ length: 41 }, (_, i) => uuidOf(100 + i)) }],
  ])('422 con %s, sin tocar la base', async (_, body) => {
    const fake = installNitro()
    const run = await handler()
    await expectStatus(Promise.resolve().then(() => run(post(body))), 422)
    expect(fake.calls).toEqual([])
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it(`acepta exactamente ${TRASH_BATCH_MAX} elementos`, async () => {
    const ids = Array.from({ length: TRASH_BATCH_MAX }, (_, i) => uuidOf(i))
    installNitro([ids.map(id => ({ id, name: `archivo-${id}` }))])
    const run = await handler()
    expect(await run(post({ fileIds: ids }))).toEqual({ trashed: TRASH_BATCH_MAX, skipped: [] })
  })

  it('exige sesión de equipo: sin sesión 401, cuenta pendiente o desactivada 403; editor y admin pueden', async () => {
    installNitro([[], []])
    const run = await handler()
    await expectGuarded(run, { method: 'POST', body: { fileIds: [UUID] } })
    for (const role of ['editor', 'admin'] as const) {
      installNitro([[{ id: UUID, name: 'foto.jpg' }]])
      const allowed = await handler()
      expect(await allowed(post({ fileIds: [UUID] }, authAs({ role })))).toEqual({ trashed: 1, skipped: [] })
    }
  })
})
