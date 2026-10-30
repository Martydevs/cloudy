// Endpoints del texto de una imagen del disco (feature 002, contracts/api): GET para el estado y POST para
// la lectura en la petición (respaldo, Reintentar y Volver a leer).
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageText } from '#shared/types/api'
import { expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID } from './helpers/nitro'

const s3 = vi.hoisted(() => ({ head: vi.fn(), readRange: vi.fn(), deleteMany: vi.fn(async () => {}) }))
vi.mock('../../server/utils/storage', () => ({ key: (path: string) => `pre/${path}`, ...s3 }))

const ai = vi.hoisted(() => ({ extractImageText: vi.fn() }))
vi.mock('#server/ai', async () => ({
  extractImageText: ai.extractImageText,
  imageSourceSchema: (await import('../../server/ai/image-text/schemas')).imageSourceSchema,
  createProviderBreaker: (await import('../../server/ai/breaker')).createProviderBreaker,
  resolveImageTextModel: () => null,
}))

const JPEG = new Uint8Array(readFileSync(new URL('../fixtures/files/foto.jpg', import.meta.url)))
const CLAIMED_AT = '2026-10-21 10:00:00.123456+00'

const visible = (category = 'image') => [{ id: UUID, name: 'nota.jpg', category }]
const textRow = (changes: Record<string, unknown> = {}) => ({
  id: UUID, extension: 'jpg', category: 'image', size_bytes: JPEG.byteLength, storage_key: `pre/files/${UUID}`,
  text_status: null, text_content: null, text_error: null, text_source_key: null, text_attempts: 0,
  text_started_at: null, text_read_at: null, text_edited_at: null, edited_by_name: null, ...changes,
})
const claimedRow = () => ({ ...textRow({ text_status: 'reading', text_started_at: new Date().toISOString() }), claimed_at: CLAIMED_AT })

const post = (body: unknown = { force: false }) => makeEvent({ method: 'POST', params: { id: UUID }, body })

beforeEach(() => {
  s3.readRange.mockReset()
  s3.readRange.mockResolvedValue(JPEG)
  ai.extractImageText.mockReset()
  ai.extractImageText.mockResolvedValue({ status: 'ready', text: 'Oremos por Ana' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/files/:id/text', () => {
  it('devuelve el DTO de una imagen visible', async () => {
    const fake = installNitro([visible(), { rows: [textRow({ text_status: 'ready', text_content: 'Hola', text_read_at: '2026-10-21T10:00:00Z' })] }])
    const handler = await loadHandler<ImageText>('api/files/[id]/text.get.ts')
    expect(await handler(makeEvent({ params: { id: UUID } }))).toEqual({
      status: 'ready', text: 'Hola', error: null, readAt: '2026-10-21T10:00:00.000Z', editedAt: null, editedBy: null,
    })
    // La visibilidad se comprueba en la misma consulta: lista y fuera de la papelera.
    expect(sqlText(fake.calls.find(c => c.method === 'where')!.args[0])).toMatch(/deleted_at.*upload_status|upload_status.*deleted_at/s)
  })

  it('404 si no existe, está en la papelera o no es imagen', async () => {
    const handler = await loadHandler('api/files/[id]/text.get.ts')
    installNitro([[]])
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)
    installNitro([visible('document')])
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)
    installNitro([])
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: 'x' } }))), 404)
  })

  it('401 sin sesión y 403 con rol sin permiso', async () => {
    installNitro()
    await expectGuarded(await loadHandler('api/files/[id]/text.get.ts'), { params: { id: UUID } })
  })
})

describe('POST /api/files/:id/text', () => {
  it.each(['ready', 'empty', 'failed', 'unavailable'])('sin force devuelve %s tal cual, sin llamar a la IA', async (status) => {
    installNitro([visible(), { rows: [textRow({ text_status: status, text_content: 'Hola', text_error: 'provider' })] }])
    const handler = await loadHandler<ImageText>('api/files/[id]/text.post.ts')
    expect((await handler(post())).status).toBe(status)
    expect(ai.extractImageText).not.toHaveBeenCalled()
  })

  it('desde NULL reclama y lee en la petición (respaldo)', async () => {
    const fake = installNitro([visible(), { rows: [textRow()] }, { rows: [claimedRow()] }, { rows: [{ saved: 1 }] }])
    const handler = await loadHandler<ImageText>('api/files/[id]/text.post.ts')
    expect(await handler(post({}))).toMatchObject({ status: 'ready', text: 'Oremos por Ana' })
    expect(sqlText(fake.db.execute.mock.calls[1]![0])).toContain(`SET text_status = 'reading'`)
  })

  it('una lectura vencida se vuelve a leer y una vigente responde reading', async () => {
    const handler = await loadHandler<ImageText>('api/files/[id]/text.post.ts')
    installNitro([visible(), { rows: [textRow({ text_status: 'reading', text_started_at: new Date(Date.now() - 120_000).toISOString() })] }, { rows: [claimedRow()] }, { rows: [{ saved: 1 }] }])
    expect((await handler(post())).status).toBe('ready')

    installNitro([visible(), { rows: [textRow({ text_status: 'reading', text_started_at: new Date().toISOString() })] }])
    expect((await handler(post())).status).toBe('reading')
    expect(ai.extractImageText).toHaveBeenCalledTimes(1)
  })

  it.each(['failed', 'ready', 'empty'])('con force reclama desde %s', async (status) => {
    const fake = installNitro([visible(), { rows: [textRow({ text_status: status })] }, { rows: [claimedRow()] }, { rows: [{ saved: 1 }] }])
    const handler = await loadHandler<ImageText>('api/files/[id]/text.post.ts')
    expect((await handler(post({ force: true }))).status).toBe('ready')
    expect(sqlText(fake.db.execute.mock.calls[1]![0])).toContain(`IN ('failed', 'ready', 'empty')`)
  })

  it('409 con force sobre unavailable o una lectura vigente', async () => {
    const handler = await loadHandler('api/files/[id]/text.post.ts')
    installNitro([visible(), { rows: [textRow({ text_status: 'unavailable' })] }])
    await expectStatus(Promise.resolve(handler(post({ force: true }))), 409)
    installNitro([visible(), { rows: [textRow({ text_status: 'reading', text_started_at: new Date().toISOString() })] }])
    await expectStatus(Promise.resolve(handler(post({ force: true }))), 409)
  })

  it('un fallo de lectura responde 200 con status failed y su código', async () => {
    ai.extractImageText.mockResolvedValue({ status: 'failed', error: 'rate_limited' })
    installNitro([visible(), { rows: [textRow()] }, { rows: [claimedRow()] }, { rows: [{ saved: 1 }] }])
    const handler = await loadHandler<ImageText>('api/files/[id]/text.post.ts')
    expect(await handler(post())).toMatchObject({ status: 'failed', error: 'rate_limited', text: null })
  })

  it('valida el cuerpo y 404 si no es una imagen visible', async () => {
    const handler = await loadHandler('api/files/[id]/text.post.ts')
    installNitro([visible()])
    await expectStatus(Promise.resolve(handler(post({ force: 'sí' }))), 422)
    installNitro([[]])
    await expectStatus(Promise.resolve(handler(post())), 404)
    installNitro([visible('audio')])
    await expectStatus(Promise.resolve(handler(post())), 404)
  })

  it('401 sin sesión y 403 con rol sin permiso', async () => {
    installNitro()
    await expectGuarded(await loadHandler('api/files/[id]/text.post.ts'), { method: 'POST', params: { id: UUID }, body: {} })
  })
})

describe('PATCH /api/files/:id/text (US3)', () => {
  const patch = (body: unknown = { text: '  Oremos por Ana  ' }) => makeEvent({ method: 'PATCH', params: { id: UUID }, body })

  it.each([null, 'ready', 'empty', 'failed'])('desde %s guarda la corrección y la registra con su longitud, sin el texto', async (status) => {
    const fake = installNitro([
      visible(),
      { rows: [textRow({ text_status: status, text_error: status === 'failed' ? 'provider' : null })] },
      { rows: [] }, [],
      { rows: [textRow({ text_status: 'ready', text_content: 'Oremos por Ana', text_edited_at: '2026-10-21T11:00:00Z', edited_by_name: 'Ana' })] },
    ])
    const handler = await loadHandler<ImageText>('api/files/[id]/text.patch.ts')
    expect(await handler(patch())).toEqual({
      status: 'ready', text: 'Oremos por Ana', error: null, readAt: null, editedAt: '2026-10-21T11:00:00.000Z', editedBy: 'Ana',
    })
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    const update = sqlText(fake.db.execute.mock.calls[1]![0])
    expect(update).toContain(`SET text_status = 'ready', text_content = $1, text_error = NULL, text_edited_by = $2, text_edited_at = now()`)
    expect(update).toContain('"Oremos por Ana","u1"')
    const activity = fake.calls.find(c => c.method === 'values')!.args[0] as { action: string, meta: unknown, targetLabel: string }
    expect(activity).toMatchObject({ action: 'file.text_edit', targetLabel: 'nota.jpg', meta: { length: 14 } })
    expect(JSON.stringify(activity)).not.toContain('Oremos')
  })

  it('409 si se está leyendo o no admite lectura', async () => {
    const handler = await loadHandler('api/files/[id]/text.patch.ts')
    installNitro([visible(), { rows: [textRow({ text_status: 'reading', text_started_at: new Date().toISOString() })] }])
    await expectStatus(Promise.resolve(handler(patch())), 409)
    installNitro([visible(), { rows: [textRow({ text_status: 'unavailable' })] }])
    await expectStatus(Promise.resolve(handler(patch())), 409)
    installNitro([visible(), { rows: [textRow({ extension: 'gif' })] }])
    await expectStatus(Promise.resolve(handler(patch())), 409)
  })

  it('422 si la validación falla y 404 si no es una imagen visible', async () => {
    const handler = await loadHandler('api/files/[id]/text.patch.ts')
    installNitro([visible()])
    await expectStatus(Promise.resolve(handler(patch({ text: '   ' }))), 422)
    await expectStatus(Promise.resolve(handler(patch({ text: 'a'.repeat(10_001) }))), 422)
    installNitro([[]])
    await expectStatus(Promise.resolve(handler(patch())), 404)
    installNitro([visible(), { rows: [] }])
    await expectStatus(Promise.resolve(handler(patch())), 404)
  })

  it('401 sin sesión y 403 con rol sin permiso', async () => {
    installNitro()
    await expectGuarded(await loadHandler('api/files/[id]/text.patch.ts'), { method: 'PATCH', params: { id: UUID }, body: { text: 'x' } })
  })
})
