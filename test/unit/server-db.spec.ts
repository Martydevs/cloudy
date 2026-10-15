import { afterEach, describe, expect, it, vi } from 'vitest'
import { schema, useDb } from '../../server/utils/db'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useDb', () => {
  it('crea un único cliente con el esquema y sus relaciones', () => {
    // El driver HTTP no se conecta hasta la primera consulta: basta una URL con forma válida.
    const runtimeConfig = vi.fn(() => ({ databaseUrl: 'postgresql://user:pass@ep-test.neon.tech/db' }))
    vi.stubGlobal('useRuntimeConfig', runtimeConfig)
    const db = useDb()
    expect(useDb()).toBe(db)
    expect(runtimeConfig).toHaveBeenCalledTimes(1)

    // Las relaciones de Drizzle se resuelven al crear el cliente: se comprueban las principales.
    const relational = (db as unknown as { _: { schema: Record<string, { relations: Record<string, { referencedTableName: string }> }> } })._.schema
    expect(Object.keys(relational)).toEqual(expect.arrayContaining(['profiles', 'folders', 'files', 'comments', 'activityLog', 'guestSubmissions', 'guestSubmissionFiles']))
    expect(relational.files!.relations.folder!.referencedTableName).toBe('folders')
    expect(relational.folders!.relations.children!.referencedTableName).toBe('folders')
    expect(relational.comments!.relations.author!.referencedTableName).toBe('profiles')
    expect(relational.guestSubmissionFiles!.relations.submission!.referencedTableName).toBe('guest_submissions')
    expect(relational.activityLog!.relations.actor!.referencedTableName).toBe('profiles')
    expect(schema.profiles).toBeDefined()
  })
})
