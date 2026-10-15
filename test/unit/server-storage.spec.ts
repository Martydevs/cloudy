import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.fn()

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const original = await importOriginal<typeof import('@aws-sdk/client-s3')>()
  return {
    ...original,
    S3Client: class {
      send = send
    },
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: { input: Record<string, unknown> }, options: Record<string, unknown>) =>
    `https://s3.test/${String(command.input.Key)}?${new URLSearchParams({ expires: String(options.expiresIn) })}`),
}))

const { NotFound } = await import('@aws-sdk/client-s3')
const storage = await import('../../server/utils/storage')
const uploads = await import('../../server/utils/uploads')

beforeEach(() => {
  send.mockReset()
  vi.stubGlobal('useRuntimeConfig', () => ({
    awsEndpointUrlS3: 'https://s3.test',
    awsRegion: '',
    awsAccessKeyId: 'id',
    awsSecretAccessKey: 'secret',
    s3Bucket: 'bucket',
    storageKeyPrefix: 'e2e/run/',
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storage', () => {
  it('key antepone el prefijo del entorno', () => {
    expect(storage.key('files/a')).toBe('e2e/run/files/a')
    expect(uploads.thumbKeyFor('a')).toBe('e2e/run/thumbs/a.webp')
  })

  it('presignPut y presignGet firman con la expiración pedida', async () => {
    expect(await storage.presignPut('files/a', { contentType: 'image/jpeg', contentLength: 10 })).toBe('https://s3.test/files/a?expires=600')
    expect(await storage.presignGet('files/a', { download: 'foto dom.jpg' })).toBe('https://s3.test/files/a?expires=900')
    expect(await storage.presignGet('files/a')).toContain('files/a')
  })

  it('head devuelve tamaño o null si no existe', async () => {
    send.mockResolvedValueOnce({ ContentLength: 42, ContentType: 'image/jpeg' })
    expect(await storage.head('files/a')).toEqual({ size: 42, contentType: 'image/jpeg' })
    send.mockRejectedValueOnce(new NotFound({ message: 'no', $metadata: {} }))
    expect(await storage.head('files/b')).toBeNull()
    send.mockRejectedValueOnce(new Error('boom'))
    await expect(storage.head('files/c')).rejects.toThrow('boom')
  })

  it('readRange devuelve los bytes del rango', async () => {
    send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    expect(await storage.readRange('files/a')).toEqual(new Uint8Array([1, 2, 3]))
    send.mockResolvedValueOnce({})
    expect(await storage.readRange('files/a')).toEqual(new Uint8Array())
    expect(send.mock.calls[0]![0].input.Range).toBe('bytes=0-4095')
  })

  it('deleteMany agrupa de a 1000 y recurre al borrado individual si falla', async () => {
    send.mockResolvedValue({})
    await storage.deleteMany(Array.from({ length: 1500 }, (_, i) => `k${i}`).concat(['k1', '']))
    expect(send).toHaveBeenCalledTimes(2)

    send.mockReset()
    send.mockRejectedValueOnce(new Error('DeleteObjects no soportado')).mockResolvedValue({})
    await storage.deleteMany(['a', 'b'])
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('listPrefix recorre todas las páginas', async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'a' }, {}], IsTruncated: true, NextContinuationToken: 't' })
      .mockResolvedValueOnce({ Contents: [{ Key: 'b' }], IsTruncated: false })
    expect(await storage.listPrefix('e2e/')).toEqual(['a', 'b'])
  })
})

describe('subidas en curso', () => {
  it('getOwnUpload responde 404 si no es del usuario o ya terminó', async () => {
    const { fakeDb } = await import('./helpers/fake-db')
    const fake = fakeDb([[{ id: 'f1', storageKey: 'files/f1' }], []])
    vi.stubGlobal('useDb', () => fake.db)
    expect(await uploads.getOwnUpload('f1', 'u1')).toEqual({ id: 'f1', storageKey: 'files/f1' })
    await expect(uploads.getOwnUpload('f2', 'u1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('discardUpload borra objeto, miniatura y registro', async () => {
    const { fakeDb } = await import('./helpers/fake-db')
    const fake = fakeDb([[]])
    vi.stubGlobal('useDb', () => fake.db)
    send.mockResolvedValue({})
    await uploads.discardUpload({ id: 'f1', storageKey: 'e2e/run/files/f1' })
    const deleted = send.mock.calls[0]![0].input.Delete.Objects.map((o: { Key: string }) => o.Key)
    expect(deleted).toEqual(['e2e/run/files/f1', 'e2e/run/thumbs/f1.webp'])
    expect(fake.calls.some(c => c.method === 'delete')).toBe(true)
  })
})
