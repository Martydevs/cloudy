import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backgroundTasks, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'

const s3 = vi.hoisted(() => ({
  presignPut: vi.fn(async (key: string) => `https://s3.test/put/${key}`),
  presignGet: vi.fn(async (key: string, opts: { download?: string } = {}) => `https://s3.test/get/${key}${opts.download ? `?dl=${opts.download}` : ''}`),
  head: vi.fn(),
  readRange: vi.fn(),
  deleteMany: vi.fn(async () => {}),
}))

vi.mock('../../server/utils/storage', () => ({
  key: (path: string) => `pre/${path}`,
  listPrefix: vi.fn(),
  ...s3,
}))

const JPEG = new Uint8Array(readFileSync(new URL('../fixtures/files/foto.jpg', import.meta.url))).subarray(0, 4096)
const FAKE = new Uint8Array(readFileSync(new URL('../fixtures/files/falso.jpg', import.meta.url)))

beforeEach(() => {
  for (const fn of Object.values(s3)) fn.mockClear()
  s3.head.mockReset()
  s3.readRange.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const fileRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID, folderId: null, name: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 8386,
  storageKey: `pre/files/${UUID}`, thumbKey: null, uploadStatus: 'ready', origin: 'team', uploadedBy: 'u1', guestName: null,
  submissionId: null, createdAt: created, updatedAt: created, deletedAt: null, deletedBy: null, trashRootId: null,
  uploaderName: 'Ana', commentCount: 1, ...changes,
})
const folder = { id: UUID2, parentId: null, name: 'Fotos', createdBy: 'u1', createdAt: created, updatedAt: created, deletedAt: null, deletedBy: null, trashRootId: null }

describe('POST /api/uploads', () => {
  const body = { folderId: null, name: 'foto.jpg', size: 8386, mimeType: 'image/jpeg', withThumbnail: true }

  it('reserva el registro y firma el archivo y la miniatura', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/uploads/index.post.ts')
    const event = makeEvent({ body })
    const ticket = await handler(event) as { fileId: string, uploadUrl: string, thumbUploadUrl: string, headers: Record<string, string> }
    expect(event.node.res.statusCode).toBe(201)
    expect(ticket.uploadUrl).toBe(`https://s3.test/put/pre/files/${ticket.fileId}`)
    expect(ticket.thumbUploadUrl).toBe(`https://s3.test/put/pre/thumbs/${ticket.fileId}.webp`)
    expect(ticket.headers).toEqual({ 'content-type': 'image/jpeg' })
    expect(s3.presignPut).toHaveBeenCalledWith(`pre/files/${ticket.fileId}`, { contentType: 'image/jpeg', contentLength: 8386 })
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({
      uploadStatus: 'uploading', origin: 'team', uploadedBy: 'u1', category: 'image', extension: 'jpg',
    })
  })

  it('sin miniatura, con carpeta destino y nombre saneado; MIME desconocido usa el canónico', async () => {
    const fake = installNitro([[folder], []])
    const handler = await loadHandler('api/uploads/index.post.ts')
    const ticket = await handler(makeEvent({ body: { ...body, folderId: UUID2, name: 'Ensayo: coro.mp3', mimeType: '', withThumbnail: false } })) as Record<string, unknown>
    expect(ticket).not.toHaveProperty('thumbUploadUrl')
    expect(ticket.headers).toEqual({ 'content-type': 'audio/mpeg' })
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({ name: 'Ensayo- coro.mp3', folderId: UUID2 })
  })

  it('413 por tamaño, 415 por formato y 422 por datos inválidos antes de reservar nada', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/uploads/index.post.ts')
    const big = await expectStatus(Promise.resolve(handler(makeEvent({ body: { ...body, name: 'culto.mp4', mimeType: 'video/mp4', size: 120 * 1024 * 1024 } }))), 413)
    expect(big.message).toBe('«culto.mp4» supera 100 MB')
    await expectStatus(Promise.resolve(handler(makeEvent({ body: { ...body, name: 'setup.exe' } }))), 415)
    await expectStatus(Promise.resolve(handler(makeEvent({ body: { ...body, size: 0 } }))), 422)
    await expectStatus(Promise.resolve(handler(makeEvent({ body: 'no-json' }))), 415)
    await expectStatus(Promise.resolve(handler(makeEvent({ body: { ...body, folderId: UUID2 } }))), 404)
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
    expect(s3.presignPut).not.toHaveBeenCalled()
    await expectGuarded(handler, { body })
  })
})

describe('POST /api/uploads/:fileId/complete', () => {
  const uploading = () => fileRow({ uploadStatus: 'uploading' })

  it('verifica tamaño y firma, registra la miniatura, aplica sufijo y publica', async () => {
    s3.head.mockResolvedValueOnce({ size: 8386 }).mockResolvedValueOnce({ size: 2000 })
    s3.readRange.mockResolvedValueOnce(JPEG)
    const fake = installNitro([[uploading()], [{ name: 'foto.jpg' }], [fileRow({ name: 'foto (2).jpg', thumbKey: `pre/thumbs/${UUID}.webp` })], []])
    const handler = await loadHandler('api/uploads/[fileId]/complete.post.ts')
    const file = await handler(makeEvent({ params: { fileId: UUID } }))
    expect(file).toMatchObject({ name: 'foto (2).jpg', hasThumbnail: true, uploadedBy: { id: 'u1', name: 'Ana' } })
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ name: 'foto (2).jpg', uploadStatus: 'ready', thumbKey: `pre/thumbs/${UUID}.webp` })
    expect(fake.calls.filter(c => c.method === 'values').map(c => c.args[0])).toEqual([
      expect.objectContaining({ action: 'file.upload', meta: { size: 8386 } }),
    ])
    expect(s3.deleteMany).not.toHaveBeenCalled()
  })

  it('una miniatura demasiado grande se descarta sin afectar al archivo', async () => {
    s3.head.mockResolvedValueOnce({ size: 8386 }).mockResolvedValueOnce({ size: 5_000_000 })
    s3.readRange.mockResolvedValueOnce(JPEG)
    const fake = installNitro([[uploading()], [], [fileRow()], []])
    const handler = await loadHandler('api/uploads/[fileId]/complete.post.ts')
    await handler(makeEvent({ params: { fileId: UUID } }))
    expect(s3.deleteMany).toHaveBeenCalledWith([`pre/thumbs/${UUID}.webp`])
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ thumbKey: null })
  })

  it('si el objeto no llegó responde 422 y conserva la reserva para reintentar', async () => {
    s3.head.mockResolvedValueOnce(null)
    const fake = installNitro([[uploading()]])
    const handler = await loadHandler('api/uploads/[fileId]/complete.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ params: { fileId: UUID } }))), 422)
    expect(error.message).toBe('No recibimos el archivo. Vuelve a subirlo.')
    expect(fake.calls.some(c => c.method === 'delete')).toBe(false)
  })

  it('tamaño distinto: borra objeto, miniatura y registro (sin huérfanos)', async () => {
    s3.head.mockResolvedValueOnce({ size: 10 })
    const fake = installNitro([[uploading()], []])
    const handler = await loadHandler('api/uploads/[fileId]/complete.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { fileId: UUID } }))), 422)
    expect(s3.deleteMany).toHaveBeenCalledWith([`pre/files/${UUID}`, `pre/thumbs/${UUID}.webp`, `pre/textsrc/${UUID}.jpg`])
    expect(fake.calls.some(c => c.method === 'delete')).toBe(true)
  })

  it('firma binaria falsa: 422 con mensaje claro y limpieza completa', async () => {
    s3.head.mockResolvedValueOnce({ size: 8386 })
    s3.readRange.mockResolvedValueOnce(FAKE)
    const fake = installNitro([[uploading()], []])
    const handler = await loadHandler('api/uploads/[fileId]/complete.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ params: { fileId: UUID } }))), 422)
    expect(error.message).toBe('El contenido no corresponde al tipo de archivo')
    expect(s3.deleteMany).toHaveBeenCalledTimes(1)
    expect(fake.calls.some(c => c.method === 'delete')).toBe(true)
  })

  it('404 si la subida no es del usuario o ya terminó', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/uploads/[fileId]/complete.post.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { fileId: UUID } }))), 404)
    await expectGuarded(handler, { params: { fileId: UUID } })
  })
})

describe('DELETE /api/uploads/:fileId', () => {
  it('cancela la subida: borra objetos y registro y responde 204', async () => {
    const fake = installNitro([[fileRow({ uploadStatus: 'uploading' })], []])
    const handler = await loadHandler('api/uploads/[fileId].delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { fileId: UUID } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(s3.deleteMany).toHaveBeenCalledWith([`pre/files/${UUID}`, `pre/thumbs/${UUID}.webp`, `pre/textsrc/${UUID}.jpg`])
    expect(fake.calls.some(c => c.method === 'delete')).toBe(true)
    await expectGuarded(handler, { method: 'DELETE', params: { fileId: UUID } })
  })
})

describe('texto de las imágenes al subir (feature 002)', () => {
  const heicBody = { folderId: null, name: 'IMG_0001.heic', size: 3_000_000, mimeType: 'image/heic', withTextSource: true }

  it('POST /api/uploads firma la copia JPEG solo para una HEIC apta', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/uploads/index.post.ts')
    const ticket = await handler(makeEvent({ body: heicBody })) as { fileId: string, textSourceUploadUrl?: string }
    expect(ticket.textSourceUploadUrl).toBe(`https://s3.test/put/pre/textsrc/${ticket.fileId}.jpg`)
    expect(s3.presignPut).toHaveBeenCalledWith(`pre/textsrc/${ticket.fileId}.jpg`, { contentType: 'image/jpeg' })

    for (const body of [
      { ...heicBody, name: 'foto.jpg', mimeType: 'image/jpeg' },
      { ...heicBody, size: 6_000_000 },
      { ...heicBody, withTextSource: false },
    ]) {
      installNitro([[]])
      const other = await handler(makeEvent({ body })) as { textSourceUploadUrl?: string }
      expect(other.textSourceUploadUrl).toBeUndefined()
    }
  })

  const completeWith = async (row: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
    const readFileImage = vi.fn(async () => {})
    const checkTextSourceCopy = vi.fn(async () => true)
    installNitro([[fileRow({ uploadStatus: 'uploading', ...row })], [], [fileRow(row)], []], { readFileImage, checkTextSourceCopy, ...overrides })
    const handler = await loadHandler('api/uploads/[fileId]/complete.post.ts')
    const file = await handler(makeEvent({ params: { fileId: UUID } }))
    return { file, readFileImage, checkTextSourceCopy }
  }

  it('complete programa la lectura de una imagen apta y responde sin esperarla', async () => {
    s3.head.mockResolvedValueOnce({ size: 8386 }).mockResolvedValueOnce(null)
    s3.readRange.mockResolvedValueOnce(JPEG)
    const { file, readFileImage, checkTextSourceCopy } = await completeWith({})
    expect(file).toMatchObject({ id: UUID, name: 'foto.jpg' })
    expect(backgroundTasks).toHaveLength(1)
    // La respuesta ya llegó y la tarea capturada aún no corrió.
    expect(readFileImage).not.toHaveBeenCalled()
    expect(checkTextSourceCopy).not.toHaveBeenCalled()
    await backgroundTasks[0]!()
    expect(readFileImage).toHaveBeenCalledWith(UUID)
  })

  it('una HEIC apta valida su copia y solo se lee si la copia es válida', async () => {
    const heic = { name: 'IMG.heic', extension: 'heic', mimeType: 'image/heic', sizeBytes: 3_000_000 }
    s3.head.mockResolvedValueOnce({ size: 3_000_000 }).mockResolvedValueOnce(null)
    s3.readRange.mockResolvedValueOnce(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))
    const valid = await completeWith(heic)
    expect(valid.checkTextSourceCopy).toHaveBeenCalledWith({ table: 'files', id: UUID })
    expect(backgroundTasks).toHaveLength(1)

    s3.head.mockResolvedValueOnce({ size: 3_000_000 }).mockResolvedValueOnce(null)
    s3.readRange.mockResolvedValueOnce(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))
    const missing = await completeWith(heic, { checkTextSourceCopy: vi.fn(async () => false) })
    expect(missing.file).toMatchObject({ id: UUID })
    expect(backgroundTasks).toHaveLength(0)
  })

  it.each([
    ['webp', { name: 'i.webp', extension: 'webp', mimeType: 'image/webp' }, new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])],
    ['gif', { name: 'a.gif', extension: 'gif', mimeType: 'image/gif' }, new Uint8Array([0x47, 0x49, 0x46, 0x38])],
    ['más de 5 MB', { sizeBytes: 6_000_000 }, JPEG],
    ['no es imagen', { name: 'n.txt', extension: 'txt', mimeType: 'text/plain', category: 'document' }, new TextEncoder().encode('hola')],
  ])('%s: no programa ninguna lectura', async (_, row, bytes) => {
    s3.head.mockResolvedValueOnce({ size: (row as { sizeBytes?: number }).sizeBytes ?? 8386 }).mockResolvedValueOnce(null)
    s3.readRange.mockResolvedValueOnce(bytes)
    const { checkTextSourceCopy } = await completeWith(row)
    expect(backgroundTasks).toHaveLength(0)
    expect(checkTextSourceCopy).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/search', () => {
  it('busca archivos y carpetas y arma sus rutas en una sola consulta', async () => {
    const fake = installNitro([
      [fileRow({ folderId: UUID2 })],
      [{ ...folder, id: UUID, name: 'Domingo', parentId: UUID2 }],
      { rows: [{ start_id: UUID2, name: 'Fotos', depth: 0 }] },
    ])
    const handler = await loadHandler('api/files/search.get.ts')
    const result = await handler(makeEvent({ url: '/api/files/search?q=fo%25to' }))
    expect(result).toEqual({
      folders: [expect.objectContaining({ name: 'Domingo', path: ['Fotos'] })],
      files: [expect.objectContaining({ name: 'foto.jpg', path: ['Fotos'], commentCount: 1 })],
      nextCursor: null,
    })
    expect(fake.db.execute).toHaveBeenCalledTimes(1)
  })

  it('con tipo no busca carpetas; resultados en la raíz no tienen ruta', async () => {
    const fake = installNitro([[fileRow()]])
    const handler = await loadHandler('api/files/search.get.ts')
    const result = await handler(makeEvent({ url: '/api/files/search?q=foto&type=image&sort=size&dir=desc' }))
    expect(result).toMatchObject({ folders: [], files: [expect.objectContaining({ path: [] })] })
    expect(fake.db.execute).not.toHaveBeenCalled()
  })

  it('encuentra también por el texto leído de las imágenes y dice dónde coincidió (feature 002)', async () => {
    const fake = installNitro([[fileRow({ matchedIn: 'text' }), fileRow({ id: UUID2, name: 'abuela.jpg', matchedIn: 'name' })], [], { rows: [] }])
    const handler = await loadHandler('api/files/search.get.ts')
    const result = await handler(makeEvent({ url: '/api/files/search?q=abue_la&type=image&sort=date&dir=desc' })) as { files: { matchedIn: string }[] }
    expect(result.files.map(f => f.matchedIn)).toEqual(['text', 'name'])
    const where = sqlText(fake.calls.find(c => c.method === 'where')!.args[0])
    // El mismo patrón escapado para el nombre y el texto; sigue excluyendo papelera y subidas pendientes.
    expect(where).toMatch(/"files"."name" ILIKE \$(\d+) OR "files"."text_content" ILIKE \$\d+/)
    // Los dos ILIKE reciben el mismo patrón, con el `_` escapado (JSON duplica la barra).
    expect(where.match(/%abue\\\\_la%/g)).toHaveLength(2)
    expect(where).toMatch(/deleted_at.*upload_status|upload_status.*deleted_at/s)
    expect(where).toContain('"files"."category" = ')
    const select = fake.calls.find(c => c.method === 'select')!.args[0] as Record<string, unknown>
    expect(sqlText(select.matchedIn)).toContain("THEN 'name' ELSE 'text' END")
  })

  it('exige q y rol', async () => {
    installNitro()
    const handler = await loadHandler('api/files/search.get.ts')
    await expectStatus(Promise.resolve().then(() => handler(makeEvent({ url: '/api/files/search' }))), 422)
    await expectGuarded(handler, { url: '/api/files/search?q=a' })
  })
})

describe('/api/files/:id', () => {
  it('GET devuelve el archivo con su ruta', async () => {
    installNitro([[fileRow({ folderId: UUID2 })], { rows: [{ start_id: UUID2, name: 'Fotos', depth: 0 }] }, [fileRow()]])
    const handler = await loadHandler('api/files/[id].get.ts')
    expect(await handler(makeEvent({ params: { id: UUID } }))).toMatchObject({ name: 'foto.jpg', path: ['Fotos'], commentCount: 1 })
    expect(await handler(makeEvent({ params: { id: UUID } }))).toMatchObject({ path: [] })
    await expectGuarded(handler, { params: { id: UUID } })
  })

  it('GET 404 si está en la papelera', async () => {
    installNitro([[]])
    const handler = await loadHandler('api/files/[id].get.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)
  })

  it('PATCH renombra conservando la extensión', async () => {
    const fake = installNitro([[fileRow()], [], [fileRow({ name: 'portada.jpg' })], []])
    const handler = await loadHandler('api/files/[id].patch.ts')
    const result = await handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: 'portada' } }))
    expect(result).toMatchObject({ name: 'portada.jpg', commentCount: 1 })
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ name: 'portada.jpg', folderId: null })
    expect(fake.calls.filter(c => c.method === 'values').map(c => c.args[0])).toEqual([
      expect.objectContaining({ action: 'file.rename', meta: { from: 'foto.jpg', to: 'portada.jpg' } }),
    ])
  })

  it('PATCH mueve a otra carpeta (con sufijo si choca) y a la raíz', async () => {
    const fake = installNitro([
      [fileRow()], [folder], [{ name: 'foto.jpg' }], [fileRow({ name: 'foto (2).jpg', folderId: UUID2 })], [], [],
      [fileRow({ folderId: UUID2 })], [], [fileRow()], [],
    ])
    const handler = await loadHandler('api/files/[id].patch.ts')
    await handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { folderId: UUID2 } }))
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ name: 'foto (2).jpg', folderId: UUID2 })
    const actions = fake.calls.filter(c => c.method === 'values').map(c => (c.args[0] as { action: string }).action)
    expect(actions).toEqual(['file.rename', 'file.move'])

    await handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { folderId: null } }))
    expect(fake.calls.filter(c => c.method === 'set').at(-1)?.args[0]).toMatchObject({ folderId: null })
  })

  it('PATCH valida y responde 404 si el destino no existe', async () => {
    installNitro([[fileRow()], []])
    const handler = await loadHandler('api/files/[id].patch.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { folderId: UUID2 } }))), 404)
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: UUID }, body: { name: 'a|b' } }))), 422)
    await expectGuarded(handler, { method: 'PATCH', params: { id: UUID }, body: { name: 'b' } })
  })

  it('DELETE envía a la papelera con su actividad en el mismo lote', async () => {
    const fake = installNitro([[fileRow()], [], []])
    const handler = await loadHandler('api/files/[id].delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { id: UUID } })
    await handler(event)
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect(fake.calls.find(c => c.method === 'set')?.args[0]).toMatchObject({ deletedBy: 'u1', trashRootId: UUID })
    await expectGuarded(handler, { method: 'DELETE', params: { id: UUID } })
  })
})

describe('contenido y miniatura', () => {
  it('content redirige a una URL firmada, con descarga si se pide', async () => {
    installNitro([[fileRow()], [fileRow()]])
    const handler = await loadHandler('api/files/[id]/content.get.ts')
    const view = makeEvent({ params: { id: UUID } })
    await handler(view)
    expect(view.node.res.statusCode).toBe(302)
    expect(view.node.res.getHeader('location')).toBe(`https://s3.test/get/pre/files/${UUID}`)
    expect(view.node.res.getHeader('cache-control')).toBe('private, max-age=600')

    const download = makeEvent({ params: { id: UUID }, url: '/api/x?download=1' })
    await handler(download)
    expect(download.node.res.getHeader('location')).toContain('?dl=foto.jpg')
    await expectGuarded(handler, { params: { id: UUID } })
  })

  it('thumbnail redirige o responde 404 si no hay miniatura', async () => {
    installNitro([[fileRow({ thumbKey: 'pre/thumbs/x.webp' })], [fileRow()]])
    const handler = await loadHandler('api/files/[id]/thumbnail.get.ts')
    const ok = makeEvent({ params: { id: UUID } })
    await handler(ok)
    expect(ok.node.res.getHeader('location')).toBe('https://s3.test/get/pre/thumbs/x.webp')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)
    await expectGuarded(handler, { params: { id: UUID } })
  })
})
