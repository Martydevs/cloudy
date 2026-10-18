// T143 — US8 Comentarios: publicar y verlo en otra sesión en ≤ 5 s, editar, permisos del autor,
// moderación del admin (con actividad), 409 en papelera y contador en la tarjeta del archivo.
// Los archivos se siembran como filas `ready` (sin bytes): los comentarios solo trabajan con filas.
import { randomUUID } from 'node:crypto'
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { ALLOWED_TYPES, getExtension } from '../../shared/constants/files'
import { E2E_URL, email, runId, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const sql = testSql()

const AUTHOR = 'comments-a'
const READER = 'comments-b'
const ADMIN = 'comments-admin'

async function userId(label: string): Promise<string> {
  const [row] = await sql`SELECT user_id FROM profiles WHERE email = ${email(label)}`
  return row!.user_id as string
}

async function seedFolder(name: string, owner: string): Promise<string> {
  const [row] = await sql`INSERT INTO folders (name, created_by) VALUES (${name}, ${owner}) RETURNING id`
  return row!.id as string
}

async function seedFile(name: string, owner: string, folderId: string | null, trashed = false): Promise<string> {
  const id = randomUUID()
  const ext = getExtension(name)
  const type = ALLOWED_TYPES[ext]!
  await sql`
    INSERT INTO files (id, folder_id, name, extension, mime_type, category, size_bytes, storage_key, upload_status, origin, uploaded_by,
      deleted_at, deleted_by, trash_root_id)
    VALUES (${id}, ${folderId}, ${name}, ${ext}, ${type.mimes[0]}, ${type.category}, 1000, ${`e2e/${runId()}/files/${id}`}, 'ready', 'team', ${owner},
      ${trashed ? new Date().toISOString() : null}, ${trashed ? owner : null}, ${trashed ? id : null})
  `
  return id
}

const sessions = new Map<string, Cookie[]>()

/** Una sesión por persona en todo el archivo: Neon Auth limita los inicios de sesión (429). */
async function pageAs(role: 'admin' | 'editor', label: string): Promise<Page> {
  const page = await createPage(undefined, { viewport: viewports.desktop })
  const cookies = sessions.get(label)
  if (cookies) await page.context().addCookies(cookies)
  else {
    await signedInAs(page, role, label)
    sessions.set(label, await page.context().cookies())
  }
  return page
}

async function cookieOf(label: string): Promise<string> {
  return sessions.get(label)!.map(c => `${c.name}=${c.value}`).join('; ')
}

/** Abre el visor del archivo y espera a que el hilo de comentarios esté en pantalla. */
async function openThread(page: Page, fileId: string) {
  await page.goto(`${E2E_URL}/archivos/ver/${fileId}`)
  await waitForHydration(page)
  const heading = page.getByRole('heading', { name: 'Comentarios', level: 2 })
  await expect.poll(() => heading.isVisible()).toBe(true)
  await heading.scrollIntoViewIfNeeded()
  await expect.poll(() => page.getByLabel('Escribe un comentario').isVisible()).toBe(true)
}

const authorName = `E2E ${AUTHOR}`
const body = `Revisar la diapositiva 3 · ${randomUUID().slice(0, 8)}`
const edited = `${body} (letra corregida)`
let folderId = ''
let fileId = ''
let fileName = ''

describe('US8 · comentarios en archivos', () => {
  it('A publica y B, con el archivo abierto, lo ve en ≤ 5 s con autor y fecha', async () => {
    const author = await pageAs('editor', AUTHOR)
    const reader = await pageAs('editor', READER)
    const owner = await userId(AUTHOR)
    fileName = `Guion ${runId()}.pdf`
    folderId = await seedFolder(`Comentarios ${runId()}`, owner)
    fileId = await seedFile(fileName, owner, folderId)

    await openThread(reader, fileId)
    await expect.poll(() => reader.getByText('Sé el primero en comentar').isVisible()).toBe(true)
    await openThread(author, fileId)

    await author.getByLabel('Escribe un comentario').fill(body)
    await author.getByRole('button', { name: 'Comentar' }).click()
    await expect.poll(() => author.getByText(body).isVisible()).toBe(true)
    const published = Date.now()

    // Sondeo cada 5 s: B debe verlo antes de 6 s (5 s + el viaje de red).
    await expect.poll(() => reader.getByText(body).isVisible(), { timeout: 6000, interval: 250 }).toBe(true)
    expect(Date.now() - published).toBeLessThanOrEqual(6000)
    const item = reader.getByRole('listitem').filter({ hasText: body })
    expect(await item.getByText(authorName).isVisible()).toBe(true)
    expect(await item.locator('time').getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    await reader.close()
    await author.close()
  })

  it('A edita su comentario y aparece "(editado)"', async () => {
    const author = await pageAs('editor', AUTHOR)
    await openThread(author, fileId)
    await author.getByRole('button', { name: `Editar comentario de ${authorName}` }).click()
    const field = author.getByLabel('Editar comentario')
    await field.fill(edited)
    await author.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => author.getByText('Comentario actualizado').isVisible()).toBe(true)
    await expect.poll(() => author.getByText(edited).isVisible()).toBe(true)
    expect(await author.getByText('(editado)').isVisible()).toBe(true)
    await author.close()
  })

  it('B no tiene opciones sobre el comentario de A y un PATCH directo responde 403', async () => {
    const reader = await pageAs('editor', READER)
    await openThread(reader, fileId)
    await expect.poll(() => reader.getByText(edited).isVisible()).toBe(true)
    expect(await reader.getByRole('button', { name: `Editar comentario de ${authorName}` }).count()).toBe(0)
    expect(await reader.getByRole('button', { name: `Eliminar comentario de ${authorName}` }).count()).toBe(0)

    const [comment] = await sql`SELECT id FROM comments WHERE file_id = ${fileId}`
    const res = await fetch(`${E2E_URL}/api/comments/${comment!.id}`, {
      method: 'PATCH',
      headers: { 'cookie': await cookieOf(READER), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Intento ajeno' }),
    })
    expect(res.status).toBe(403)
    const del = await fetch(`${E2E_URL}/api/comments/${comment!.id}`, { method: 'DELETE', headers: { cookie: await cookieOf(READER) } })
    expect(del.status).toBe(403)
    expect(await sql`SELECT body FROM comments WHERE id = ${comment!.id}`).toEqual([{ body: edited }])
    await reader.close()
  })

  it('el contador de comentarios aparece en la tarjeta del archivo', async () => {
    const reader = await pageAs('editor', READER)
    await reader.goto(`${E2E_URL}/archivos/${folderId}`)
    await waitForHydration(reader)
    const card = reader.getByRole('article').filter({ has: reader.getByRole('link', { name: `Abrir ${fileName}` }) })
    await expect.poll(() => card.getByRole('img', { name: '1 comentario' }).isVisible()).toBe(true)
    await reader.close()
  })

  it('el admin borra el comentario de A y queda en la actividad', async () => {
    const admin = await pageAs('admin', ADMIN)
    await openThread(admin, fileId)
    // El admin modera pero no edita comentarios ajenos.
    expect(await admin.getByRole('button', { name: `Editar comentario de ${authorName}` }).count()).toBe(0)
    await admin.getByRole('button', { name: `Eliminar comentario de ${authorName}` }).click()
    await admin.getByRole('dialog', { name: '¿Eliminar este comentario?' }).getByRole('button', { name: 'Eliminar' }).click()
    await expect.poll(() => admin.getByText('Comentario eliminado').isVisible()).toBe(true)
    await expect.poll(() => admin.getByText('Sé el primero en comentar').isVisible()).toBe(true)

    expect(await sql`SELECT count(*)::int AS n FROM comments WHERE file_id = ${fileId}`).toEqual([{ n: 0 }])
    expect(await sql`
      SELECT actor_label, target_type, target_label, meta FROM activity_log
      WHERE action = 'comment.admin_delete' AND target_id = ${fileId}
    `).toEqual([{ actor_label: `E2E ${ADMIN}`, target_type: 'file', target_label: fileName, meta: { author: authorName } }])

    await admin.goto(`${E2E_URL}/actividad`)
    await waitForHydration(admin)
    await expect.poll(() => admin.getByText(`escrito por ${authorName}`).first().isVisible()).toBe(true)
    await admin.close()
  })

  it('un archivo en la papelera no admite comentarios (409)', async () => {
    const owner = await userId(AUTHOR)
    const trashedId = await seedFile(`Borrado ${runId()}.pdf`, owner, null, true)
    const res = await fetch(`${E2E_URL}/api/files/${trashedId}/comments`, {
      method: 'POST',
      headers: { 'cookie': await cookieOf(AUTHOR), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'No debería guardarse' }),
    })
    expect(res.status).toBe(409)
    expect((await res.json()).message).toBe('El archivo está en la papelera')
    // Tampoco se lee su hilo: el visor ya muestra que no está disponible.
    expect((await fetch(`${E2E_URL}/api/files/${trashedId}/comments`, { headers: { cookie: await cookieOf(AUTHOR) } })).status).toBe(404)
    expect(await sql`SELECT count(*)::int AS n FROM comments WHERE file_id = ${trashedId}`).toEqual([{ n: 0 }])
  })
})
