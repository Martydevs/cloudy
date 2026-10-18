// US8 — Endpoints de comentarios: guards, validación, 404/409 y permisos de autor y moderación.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authAs, created, expectGuarded, expectStatus, installNitro, loadHandler, makeEvent, sqlText, UUID, UUID2 } from './helpers/nitro'

afterEach(() => {
  vi.unstubAllGlobals()
})

const C1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

const file = (changes: Record<string, unknown> = {}) => ({ id: UUID, name: 'guion.pdf', deletedAt: null, ...changes })
const row = (changes: Record<string, unknown> = {}) => ({
  id: C1, fileId: UUID, authorId: 'u1', body: 'Revisar la diapositiva 3', createdAt: created, editedAt: null, authorName: 'Ana', ...changes,
})
const stored = (changes: Record<string, unknown> = {}) => ({ ...row(), fileName: 'guion.pdf', fileDeletedAt: null, ...changes })

const admin = authAs({ userId: 'u9', name: 'Pastor', role: 'admin' })
const otherEditor = authAs({ userId: 'u2', name: 'Luis', role: 'editor' })

describe('GET /api/files/:id/comments', () => {
  it('devuelve el hilo en orden cronológico con permisos por comentario', async () => {
    installNitro([[file()], [row(), row({ id: UUID2, authorId: 'u2', authorName: null, editedAt: created })]])
    const handler = await loadHandler('api/files/[id]/comments.get.ts')
    const list = await handler(makeEvent({ params: { id: UUID } }))
    expect(list).toEqual([
      { id: C1, body: 'Revisar la diapositiva 3', author: { id: 'u1', name: 'Ana' }, createdAt: created.toISOString(), editedAt: null, canEdit: true, canDelete: true },
      { id: UUID2, body: 'Revisar la diapositiva 3', author: { id: 'u2', name: 'Usuario' }, createdAt: created.toISOString(), editedAt: created.toISOString(), canEdit: false, canDelete: false },
    ])
  })

  it('el admin puede borrar comentarios ajenos pero no editarlos; otro editor ninguna de las dos', async () => {
    installNitro([[file()], [row()], [file()], [row()]])
    const handler = await loadHandler('api/files/[id]/comments.get.ts')
    const [asAdmin] = await handler(makeEvent({ params: { id: UUID }, auth: admin })) as { canEdit: boolean, canDelete: boolean }[]
    expect(asAdmin).toMatchObject({ canEdit: false, canDelete: true })
    const [asOther] = await handler(makeEvent({ params: { id: UUID }, auth: otherEditor })) as { canEdit: boolean, canDelete: boolean }[]
    expect(asOther).toMatchObject({ canEdit: false, canDelete: false })
  })

  it('con since filtra en SQL los creados después del cursor (truncado a milisegundos)', async () => {
    const fake = installNitro([[file()], []])
    const handler = await loadHandler('api/files/[id]/comments.get.ts')
    const since = '2026-10-14T10:00:00.123Z'
    expect(await handler(makeEvent({ params: { id: UUID }, url: `/api/files/${UUID}/comments?since=${since}` }))).toEqual([])
    const wheres = fake.calls.filter(c => c.method === 'where').map(c => sqlText(c.args[0]))
    expect(wheres.some(text => text.includes('date_trunc') && text.includes(since))).toBe(true)
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
  })

  it('sin since no filtra por fecha', async () => {
    const fake = installNitro([[file()], []])
    const handler = await loadHandler('api/files/[id]/comments.get.ts')
    await handler(makeEvent({ params: { id: UUID } }))
    expect(fake.calls.filter(c => c.method === 'where').some(c => sqlText(c.args[0]).includes('date_trunc'))).toBe(false)
  })

  it('404 si el id no es válido, no existe o está en la papelera; 422 con since inválido', async () => {
    installNitro([[], [], [file({ deletedAt: created })], []])
    const handler = await loadHandler('api/files/[id]/comments.get.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: 'x' } }))), 404)
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)
    const trashed = await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID } }))), 404)
    expect(trashed.message).toBe('El archivo no existe o está en la papelera')
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, url: '/api/x?since=ayer' }))), 422)
    await expectGuarded(handler, { params: { id: UUID } })
  })
})

describe('POST /api/files/:id/comments', () => {
  it('201 con el comentario del autor (texto recortado)', async () => {
    const fake = installNitro([[file()], [row({ body: 'Listo' })]])
    const handler = await loadHandler('api/files/[id]/comments.post.ts')
    const event = makeEvent({ params: { id: UUID }, body: { body: '  Listo  ' } })
    const comment = await handler(event)
    expect(event.node.res.statusCode).toBe(201)
    expect(comment).toMatchObject({ body: 'Listo', author: { id: 'u1', name: 'Ana' }, canEdit: true, canDelete: true })
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toEqual({ fileId: UUID, authorId: 'u1', body: 'Listo' })
  })

  it('409 si el archivo está en la papelera, sin insertar', async () => {
    const fake = installNitro([[file({ deletedAt: created })]])
    const handler = await loadHandler('api/files/[id]/comments.post.ts')
    const error = await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { body: 'Hola' } }))), 409)
    expect(error.message).toBe('El archivo está en la papelera')
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
  })

  it('422 por texto vacío o largo, 404 si el archivo no existe', async () => {
    const fake = installNitro([[]])
    const handler = await loadHandler('api/files/[id]/comments.post.ts')
    const empty = await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { body: '  ' } }))), 422)
    expect(empty.data).toEqual({ errors: { body: 'Este campo es obligatorio' } })
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { body: 'a'.repeat(2001) } }))), 422)
    await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: 'x' }, body: { body: 'Hola' } }))), 404)
    const missing = await expectStatus(Promise.resolve(handler(makeEvent({ params: { id: UUID }, body: { body: 'Hola' } }))), 404)
    expect(missing.message).toBe('El archivo no existe')
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
    await expectGuarded(handler, { params: { id: UUID }, body: { body: 'Hola' } })
  })
})

describe('PATCH /api/comments/:id', () => {
  it('el autor edita y queda marcado como editado', async () => {
    const fake = installNitro([[stored()], [row({ body: 'Corregido', editedAt: created })]])
    const handler = await loadHandler('api/comments/[id].patch.ts')
    const comment = await handler(makeEvent({ method: 'PATCH', params: { id: C1 }, body: { body: ' Corregido ' } }))
    expect(comment).toMatchObject({ body: 'Corregido', editedAt: created.toISOString(), author: { name: 'Ana' }, canEdit: true })
    const set = fake.calls.find(c => c.method === 'set')?.args[0] as { body: string, editedAt: Date }
    expect(set.body).toBe('Corregido')
    expect(set.editedAt).toBeInstanceOf(Date)
  })

  it('403 para quien no es el autor, también para el admin', async () => {
    const fake = installNitro([[stored()], [stored()]])
    const handler = await loadHandler('api/comments/[id].patch.ts')
    for (const auth of [otherEditor, admin]) {
      const error = await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', auth, params: { id: C1 }, body: { body: 'X' } }))), 403)
      expect(error.message).toBe('No tienes permiso para esta acción')
    }
    expect(fake.calls.some(c => c.method === 'update')).toBe(false)
  })

  it('409 si el archivo está en la papelera; 404 y 422 antes de tocar nada', async () => {
    const fake = installNitro([[stored({ fileDeletedAt: created })], []])
    const handler = await loadHandler('api/comments/[id].patch.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: C1 }, body: { body: 'X' } }))), 409)
    const missing = await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: C1 }, body: { body: 'X' } }))), 404)
    expect(missing.message).toBe('El comentario ya no existe')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: 'x' }, body: { body: 'X' } }))), 404)
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'PATCH', params: { id: C1 }, body: { body: '' } }))), 422)
    expect(fake.calls.some(c => c.method === 'update')).toBe(false)
    await expectGuarded(handler, { method: 'PATCH', params: { id: C1 }, body: { body: 'X' } })
  })
})

describe('DELETE /api/comments/:id', () => {
  it('el autor borra su comentario sin registrar actividad', async () => {
    const fake = installNitro([[stored()], []])
    const handler = await loadHandler('api/comments/[id].delete.ts')
    const event = makeEvent({ method: 'DELETE', params: { id: C1 } })
    expect(await handler(event)).toBeNull()
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.calls.some(c => c.method === 'delete')).toBe(true)
    expect(fake.calls.some(c => c.method === 'insert')).toBe(false)
    expect(fake.db.batch).not.toHaveBeenCalled()
  })

  it('un admin que no es el autor modera y queda en la actividad', async () => {
    const fake = installNitro([[stored()], [], []])
    const handler = await loadHandler('api/comments/[id].delete.ts')
    const event = makeEvent({ method: 'DELETE', auth: admin, params: { id: C1 } })
    await handler(event)
    expect(event.node.res.statusCode).toBe(204)
    expect(fake.db.batch).toHaveBeenCalledTimes(1)
    expect(fake.calls.find(c => c.method === 'values')?.args[0]).toMatchObject({
      actorId: 'u9', actorLabel: 'Pastor', action: 'comment.admin_delete', targetType: 'file', targetId: UUID, targetLabel: 'guion.pdf', meta: { author: 'Ana' },
    })
  })

  it('403 para otro editor y 404 si no existe', async () => {
    const fake = installNitro([[stored()], []])
    const handler = await loadHandler('api/comments/[id].delete.ts')
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'DELETE', auth: otherEditor, params: { id: C1 } }))), 403)
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'DELETE', params: { id: C1 } }))), 404)
    await expectStatus(Promise.resolve(handler(makeEvent({ method: 'DELETE', params: { id: 'x' } }))), 404)
    expect(fake.calls.some(c => c.method === 'delete')).toBe(false)
    await expectGuarded(handler, { method: 'DELETE', params: { id: C1 } })
  })
})
