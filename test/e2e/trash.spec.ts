// US7 — Papelera: listar, restaurar (también a la raíz), purgar y vaciar (solo admin).
// Los archivos se siembran como filas `ready` en la rama de pruebas (sin subir bytes): la papelera solo
// trabaja con filas, y purgar claves inexistentes en el bucket es inocuo.
import { randomUUID } from 'node:crypto'
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { ALLOWED_TYPES, getExtension } from '../../shared/constants/files'
import { E2E_URL, email, runId, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const sql = testSql()
const SIZE = 1000

async function userId(label: string): Promise<string> {
  const [row] = await sql`SELECT user_id FROM profiles WHERE email = ${email(label)}`
  return row!.user_id as string
}

async function seedFolder(name: string, owner: string, parentId: string | null = null): Promise<string> {
  const [row] = await sql`INSERT INTO folders (name, created_by, parent_id) VALUES (${name}, ${owner}, ${parentId}) RETURNING id`
  return row!.id as string
}

async function seedFile(name: string, owner: string, folderId: string | null, trashed = false): Promise<string> {
  const id = randomUUID()
  const ext = getExtension(name)
  const type = ALLOWED_TYPES[ext]!
  await sql`
    INSERT INTO files (id, folder_id, name, extension, mime_type, category, size_bytes, storage_key, upload_status, origin, uploaded_by,
      deleted_at, deleted_by, trash_root_id)
    VALUES (${id}, ${folderId}, ${name}, ${ext}, ${type.mimes[0]}, ${type.category}, ${SIZE}, ${`e2e/${runId()}/files/${id}`}, 'ready', 'team', ${owner},
      ${trashed ? new Date().toISOString() : null}, ${trashed ? owner : null}, ${trashed ? id : null})
  `
  return id
}

let editorSession: Cookie[] | undefined

/**
 * Página con la sesión del editor de esta suite. Solo la primera inicia sesión: Neon Auth limita los
 * inicios de sesión por IP y repetirlos en cada prueba termina en 429.
 */
async function editorPage(viewport: { width: number, height: number }): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  if (editorSession) await page.context().addCookies(editorSession)
  else {
    await signedInAs(page, 'editor', 'trash-editor')
    editorSession = await page.context().cookies()
  }
  return page
}

async function open(page: Page, path: string) {
  await page.goto(`${E2E_URL}${path}`)
  await waitForHydration(page)
}

async function openFolder(page: Page, id: string, name: string) {
  await open(page, `/archivos/${id}`)
  await expect.poll(() => page.getByRole('heading', { name, level: 1 }).isVisible()).toBe(true)
}

async function sendToTrash(page: Page, menuName: string, itemName: string) {
  await page.getByRole('button', { name: menuName, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Eliminar' }).click()
  await page.getByRole('dialog', { name: `¿Eliminar «${itemName}»?` }).getByRole('button', { name: 'Enviar a la papelera' }).click()
  await expect.poll(() => page.getByText(`«${itemName}» se envió a la papelera`).isVisible()).toBe(true)
}

/** Fila de la papelera que contiene el nombre exacto del elemento. */
function trashRow(page: Page, name: string) {
  return page.getByRole('list', { name: 'Elementos en la papelera' }).getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })
}

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const cookie = (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ')
  const res = await fetch(`${E2E_URL}${path}`, { headers: { cookie } })
  expect(res.status).toBe(200)
  return res.json() as Promise<T>
}

interface Dashboard { storage: { activeBytes: number, trashBytes: number } }
interface Search { files: { name: string }[] }

describe('US7 · papelera', () => {
  const tag = runId().slice(-6)

  it('un archivo eliminado aparece con su ubicación original y 30 días, y al restaurarlo vuelve a su carpeta', async () => {
    const page = await editorPage(viewports.desktop)
    const owner = await userId('trash-editor')
    const folderName = `Culto ${tag}`
    const fileName = `portada-${tag}.jpg`
    const folderId = await seedFolder(folderName, owner)
    await seedFile(fileName, owner, folderId)

    await openFolder(page, folderId, folderName)
    await sendToTrash(page, `Acciones de ${fileName}`, fileName)

    await open(page, '/papelera')
    const row = trashRow(page, fileName)
    await expect.poll(() => row.count()).toBe(1)
    expect(await row.textContent()).toContain(`Ubicación original: /${folderName}`)
    expect(await row.textContent()).toContain('Quedan 30 días')
    expect(await row.textContent()).toContain('Eliminado por E2E trash-editor')

    await page.getByRole('button', { name: `Restaurar ${fileName}` }).click()
    await expect.poll(() => page.getByText(`«${fileName}» se restauró en /${folderName}`).isVisible()).toBe(true)
    await expect.poll(() => row.count()).toBe(0)

    await openFolder(page, folderId, folderName)
    await expect.poll(() => page.getByRole('link', { name: `Abrir ${fileName}` }).isVisible()).toBe(true)
    await page.close()
  })

  it('una carpeta va completa a la papelera como una sola raíz, sale de búsqueda y totales, y se restaura entera', async () => {
    const page = await editorPage(viewports.desktop)
    const owner = await userId('trash-editor')
    const folderName = `Ensayo ${tag}`
    const subName = `Voces ${tag}`
    const files = [`ensayo-a-${tag}.jpg`, `ensayo-b-${tag}.mp3`, `voces-${tag}.jpg`]
    const folderId = await seedFolder(folderName, owner)
    const subId = await seedFolder(subName, owner, folderId)
    await seedFile(files[0]!, owner, folderId)
    await seedFile(files[1]!, owner, folderId)
    await seedFile(files[2]!, owner, subId)

    const search = async () => {
      const found = await apiJson<Search>(page, `/api/files/search?q=${encodeURIComponent(`${tag}.`)}`)
      return found.files.filter(f => files.includes(f.name)).length
    }
    expect(await search()).toBe(3)
    const before = await apiJson<Dashboard>(page, '/api/dashboard')
    await open(page, '/archivos')
    await sendToTrash(page, `Acciones de la carpeta ${folderName}`, folderName)

    // Solo la raíz: 2 archivos + 1 subcarpeta con 1 archivo = 4 elementos dentro.
    await open(page, '/papelera')
    const row = trashRow(page, folderName)
    await expect.poll(() => row.count()).toBe(1)
    expect(await row.textContent()).toContain('4 elementos')
    expect(await row.textContent()).toContain('Ubicación original: /')
    for (const name of [subName, ...files]) expect(await trashRow(page, name).count()).toBe(0)

    // Fuera de la búsqueda y de los totales de Inicio (el espacio pasa a "papelera").
    expect(await search()).toBe(0)
    const after = await apiJson<Dashboard>(page, '/api/dashboard')
    expect(before.storage.activeBytes - after.storage.activeBytes).toBe(3 * SIZE)
    expect(after.storage.trashBytes - before.storage.trashBytes).toBe(3 * SIZE)

    await page.getByRole('button', { name: `Restaurar ${folderName}` }).click()
    await expect.poll(() => page.getByText(`«${folderName}» se restauró en Archivos`).isVisible()).toBe(true)

    await openFolder(page, folderId, folderName)
    await expect.poll(() => page.getByRole('link', { name: `Abrir carpeta ${subName}` }).isVisible()).toBe(true)
    for (const name of files.slice(0, 2)) expect(await page.getByRole('link', { name: `Abrir ${name}` }).isVisible()).toBe(true)
    await openFolder(page, subId, subName)
    await expect.poll(() => page.getByRole('link', { name: `Abrir ${files[2]}` }).isVisible()).toBe(true)
    await page.close()
  })

  it('con la carpeta original en la papelera, restaurar un archivo lo deja en la raíz con un aviso; purgar pide confirmación', async () => {
    const page = await editorPage(viewports.desktop)
    const owner = await userId('trash-editor')
    const folderName = `Retiro ${tag}`
    const fileName = `retiro-${tag}.jpg`
    const folderId = await seedFolder(folderName, owner)
    await seedFile(fileName, owner, folderId)

    await openFolder(page, folderId, folderName)
    await sendToTrash(page, `Acciones de ${fileName}`, fileName)
    await open(page, '/archivos')
    await sendToTrash(page, `Acciones de la carpeta ${folderName}`, folderName)

    await open(page, '/papelera')
    await expect.poll(() => trashRow(page, fileName).count()).toBe(1)
    await page.getByRole('button', { name: `Restaurar ${fileName}` }).click()
    await expect.poll(() => page.getByText(`«${fileName}» se restauró en Archivos porque su carpeta original sigue en la papelera`).isVisible()).toBe(true)
    const [restored] = await sql`SELECT folder_id, deleted_at FROM files WHERE name = ${fileName}`
    expect(restored).toEqual({ folder_id: null, deleted_at: null })

    // Purgar: cancelar no borra nada; confirmar lo borra para siempre.
    const purge = page.getByRole('button', { name: `Eliminar definitivamente ${folderName}` })
    await purge.click()
    const dialog = page.getByRole('dialog', { name: `¿Eliminar definitivamente «${folderName}»?` })
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    expect(await trashRow(page, folderName).count()).toBe(1)
    await purge.click()
    await dialog.getByRole('button', { name: 'Eliminar definitivamente' }).click()
    await expect.poll(() => page.getByText(`«${folderName}» se eliminó definitivamente`).isVisible()).toBe(true)
    await expect.poll(() => trashRow(page, folderName).count()).toBe(0)
    expect(await sql`SELECT id FROM folders WHERE id = ${folderId}`).toEqual([])
    await page.close()
  })

  it('"Vaciar papelera" solo lo ve y lo puede usar el admin; la página no se desborda a 360 px', async () => {
    const editor = await editorPage(viewports.phone)
    const owner = await userId('trash-editor')
    const fileName = `vaciar-${tag}.mp3`
    await seedFile(fileName, owner, null, true)

    await open(editor, '/papelera')
    await expect.poll(() => trashRow(editor, fileName).count()).toBe(1)
    expect(await editor.getByRole('button', { name: 'Vaciar papelera' }).count()).toBe(0)
    const overflow = await editor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const cookie = (await editor.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ')
    expect((await fetch(`${E2E_URL}/api/trash`, { method: 'DELETE', headers: { cookie } })).status).toBe(403)
    await editor.close()

    const admin = await createPage(undefined, { viewport: viewports.desktop })
    await signedInAs(admin, 'admin', 'trash-admin')
    await open(admin, '/papelera')
    await expect.poll(() => trashRow(admin, fileName).count()).toBe(1)
    await admin.getByRole('button', { name: 'Vaciar papelera' }).click()
    await admin.getByRole('dialog', { name: '¿Vaciar la papelera?' }).getByRole('button', { name: 'Vaciar papelera' }).click()
    await expect.poll(() => admin.getByRole('heading', { name: 'La papelera está vacía' }).isVisible()).toBe(true)
    expect(await sql`SELECT id FROM files WHERE name = ${fileName}`).toEqual([])
    await admin.close()
  })
})
