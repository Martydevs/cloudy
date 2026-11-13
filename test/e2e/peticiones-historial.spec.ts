// Peticiones · historial y colecciones de imágenes generadas (feature 007, enmienda de historial): la imagen generada contra el
// stub de OpenRouter queda en el historial; se guarda en una colección nueva o existente; la colección se ve, se renombra, se le
// quita la imagen y se elimina sin tocar el historial; otra persona del equipo ve todo pero no elimina lo ajeno; la autora
// elimina su imagen y sale de sus colecciones. Datos y objetos de la rama de pruebas (`e2e/<runId>/`).
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { E2E_URL, email, profileUserId, resetStub, runId, seedPrayerRequest, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const sql = testSql()
const AUTHOR = 'pet-hist-autora'
const OTHER = 'pet-hist-otro'

async function pageAs(label: string, viewport: { width: number, height: number } = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  await signedInAs(page, 'editor', label)
  return page
}

/** Abre la página y salta al historial con el atajo del encabezado (la rejilla de arriba deja de cargar sola). */
async function openPage(page: Page) {
  await page.goto(`${E2E_URL}/peticiones`)
  await waitForHydration(page)
  await page.getByRole('link', { name: 'Ver imágenes generadas' }).click()
}

const history = (page: Page) => page.getByRole('list', { name: 'Imágenes generadas', exact: true })
const saved = (page: Page, id: string) => history(page).getByRole('listitem').filter({ has: page.locator(`a[href="/api/peticiones/imagenes/${id}/content?download=1"]`) })
const row = (page: Page) => page.getByRole('list', { name: 'Colecciones de imágenes del equipo' })
const collectionCard = (page: Page, name: string) => row(page).getByRole('button', { name: new RegExp(`^Abrir la colección ${name},`) })
const toast = (page: Page, text: string) => page.getByText(text, { exact: true })

/** Genera una imagen con una petición nueva y devuelve su id (la respuesta 201 del servidor). */
async function generateOne(page: Page, owner: string, label: string): Promise<string> {
  const senderName = `${label} ${runId()}`
  await seedPrayerRequest(owner, { senderName })
  await page.goto(`${E2E_URL}/peticiones`)
  await waitForHydration(page)
  await page.getByRole('checkbox', { name: `Elegir la petición de ${senderName}`, exact: true }).check()
  const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/peticiones/imagenes')
  await page.getByRole('region', { name: 'Selección de peticiones' }).getByRole('button', { name: 'Escribir textos y generar' }).click()
  const dialog = page.getByRole('dialog', { name: 'Escribe el texto de cada petición' })
  await dialog.getByLabel(senderName, { exact: true }).fill(`Oremos por ${label} ${runId()}`)
  await dialog.getByRole('button', { name: 'Generar imágenes', exact: true }).click()
  const res = await response
  expect(res.status()).toBe(201)
  const { id } = await res.json() as { id: string }
  // Fuera de un `it` (también se usa en `beforeAll`): espera de Playwright en vez de `expect.poll`.
  await saved(page, id).waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByRole('region', { name: 'Selección de peticiones' }).getByRole('button', { name: 'Limpiar' }).click()
  return id
}

async function menu(page: Page, id: string, option: string) {
  await saved(page, id).getByRole('button', { name: 'Opciones de la imagen' }).click()
  await page.getByRole('menuitem', { name: option }).click()
}

let owner: string
let imageId: string

beforeAll(async () => {
  await resetStub()
  const page = await pageAs(AUTHOR)
  owner = await profileUserId(email(AUTHOR))
  imageId = await generateOne(page, owner, 'Historial')
  await page.close()
})

describe('historial y colecciones de imágenes generadas', () => {
  it('guardar en una colección nueva desde el historial; verla, renombrarla, quitarle la imagen y eliminarla sin tocar el historial', async () => {
    const page = await pageAs(AUTHOR)
    await openPage(page)
    const name = `Domingo ${runId()}`
    const renamed = `Domingo renombrada ${runId()}`

    await menu(page, imageId, 'Guardar en colección')
    const dialog = page.getByRole('dialog', { name: 'Guardar en una colección' })
    await dialog.getByLabel('Nombre').fill(name)
    await dialog.getByRole('button', { name: 'Crear colección' }).click()
    await expect.poll(() => toast(page, `Colección «${name}» creada`).isVisible()).toBe(true)
    await expect.poll(() => collectionCard(page, name).getAttribute('aria-label')).toBe(`Abrir la colección ${name}, 1 imagen`)
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM prayer_image_collection_items WHERE image_id = ${imageId}` as { count: number }[]
    expect(count).toBe(1)

    // Ver: la imagen con su descarga; renombrar.
    await collectionCard(page, name).click()
    const view = page.getByRole('dialog', { name })
    await expect.poll(() => view.getByRole('list', { name: `Imágenes de ${name}` }).getByRole('listitem').count()).toBe(1)
    expect(await view.locator(`a[href="/api/peticiones/imagenes/${imageId}/content?download=1"]`).count()).toBe(1)
    await view.getByRole('button', { name: 'Renombrar' }).click()
    await view.getByLabel('Nuevo nombre').fill(renamed)
    await view.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => toast(page, `Ahora se llama «${renamed}»`).isVisible()).toBe(true)
    const renamedView = page.getByRole('dialog', { name: renamed })
    await expect.poll(() => renamedView.isVisible()).toBe(true)

    // Quitar la imagen (con confirmación): la colección queda vacía y la imagen sigue en el historial.
    await renamedView.getByRole('button', { name: /^Quitar de la colección/ }).click()
    await page.getByRole('dialog', { name: '¿Quitar esta imagen de la colección?' }).getByRole('button', { name: 'Quitar de la colección' }).click()
    await expect.poll(() => renamedView.getByText('Esta colección no tiene imágenes todavía.').isVisible()).toBe(true)
    await renamedView.getByRole('button', { name: 'Cerrar' }).first().click()
    await expect.poll(() => collectionCard(page, renamed).getAttribute('aria-label')).toBe(`Abrir la colección ${renamed}, 0 imágenes`)

    // Eliminar desde el menú de la tarjeta: la imagen sigue en el historial.
    await row(page).getByRole('button', { name: `Opciones de ${renamed}` }).click()
    await page.getByRole('menuitem', { name: 'Eliminar colección' }).click()
    await page.getByRole('dialog', { name: `¿Eliminar la colección «${renamed}»?` }).getByRole('button', { name: 'Eliminar colección' }).click()
    await expect.poll(() => toast(page, `Se eliminó la colección «${renamed}»`).isVisible()).toBe(true)
    await expect.poll(() => collectionCard(page, renamed).count()).toBe(0)
    expect(await saved(page, imageId).isVisible()).toBe(true)
    await page.close()
  })

  it('guardar en una colección existente no la duplica', async () => {
    const page = await pageAs(AUTHOR)
    await openPage(page)
    const name = `Existente ${runId()}`
    await page.getByRole('button', { name: 'Nueva colección' }).first().click()
    const create = page.getByRole('dialog', { name: 'Nueva colección' })
    await create.getByLabel('Nombre').fill(name)
    await create.getByRole('button', { name: 'Crear colección' }).click()
    await expect.poll(() => collectionCard(page, name).isVisible()).toBe(true)

    for (const expected of [`Imagen guardada en «${name}»`, `Ya estaba en «${name}»`]) {
      await page.getByRole('link', { name: 'Ver imágenes generadas' }).click()
      await menu(page, imageId, 'Guardar en colección')
      const dialog = page.getByRole('dialog', { name: 'Guardar en una colección' })
      await dialog.getByRole('tab', { name: 'Agregar a una existente' }).click()
      await dialog.getByRole('button', { name: new RegExp(name) }).click()
      await expect.poll(() => toast(page, expected).isVisible()).toBe(true)
    }
    await expect.poll(() => collectionCard(page, name).getAttribute('aria-label')).toBe(`Abrir la colección ${name}, 1 imagen`)
    await page.close()
  })

  it('otra persona del equipo ve la imagen y la colección, pero no elimina la imagen ni renombra la colección ajenas', async () => {
    const name = `Ajena ${runId()}`
    const [collection] = await sql`
      INSERT INTO prayer_image_collections (name, created_by) VALUES (${name}, ${owner}) RETURNING id
    ` as { id: string }[]
    await sql`INSERT INTO prayer_image_collection_items (collection_id, image_id, added_by) VALUES (${collection!.id}, ${imageId}, ${owner})`

    const page = await pageAs(OTHER)
    await openPage(page)
    await expect.poll(() => saved(page, imageId).isVisible(), { timeout: 10_000 }).toBe(true)
    expect(await saved(page, imageId).innerText()).toMatch(/por E2E pet-hist-autora/)
    await saved(page, imageId).getByRole('button', { name: 'Opciones de la imagen' }).click()
    await expect.poll(() => page.getByRole('menuitem').allInnerTexts()).toEqual(['Guardar en colección', 'Generar de nuevo'])
    await page.keyboard.press('Escape')
    // El servidor es la autoridad: la API responde 403 aunque se salte la interfaz.
    expect((await page.request.delete(`${E2E_URL}/api/peticiones/imagenes/${imageId}`)).status()).toBe(403)
    expect((await page.request.patch(`${E2E_URL}/api/peticiones/colecciones/${collection!.id}`, { data: { name: 'Otro' } })).status()).toBe(403)

    await collectionCard(page, name).click()
    const view = page.getByRole('dialog', { name })
    await expect.poll(() => view.getByRole('list', { name: `Imágenes de ${name}` }).isVisible()).toBe(true)
    expect(await view.getByRole('button', { name: 'Renombrar' }).count()).toBe(0)
    expect(await view.getByRole('button', { name: 'Eliminar colección' }).count()).toBe(0)
    await page.close()
  })

  it('la autora elimina su imagen: sale del historial y de sus colecciones, también tras recargar', async () => {
    const page = await pageAs(AUTHOR)
    const doomed = await generateOne(page, owner, 'Eliminar')
    const name = `Con imagen ${runId()}`
    await page.getByRole('link', { name: 'Ver imágenes generadas' }).click()
    await menu(page, doomed, 'Guardar en colección')
    const dialog = page.getByRole('dialog', { name: 'Guardar en una colección' })
    await dialog.getByLabel('Nombre').fill(name)
    await dialog.getByRole('button', { name: 'Crear colección' }).click()
    await expect.poll(() => collectionCard(page, name).getAttribute('aria-label')).toBe(`Abrir la colección ${name}, 1 imagen`)

    await menu(page, doomed, 'Eliminar')
    const confirm = page.getByRole('dialog', { name: '¿Eliminar esta imagen?' })
    await confirm.getByRole('button', { name: 'Eliminar' }).click()
    await expect.poll(() => toast(page, 'Imagen eliminada').isVisible()).toBe(true)
    await expect.poll(() => saved(page, doomed).count()).toBe(0)
    await expect.poll(() => collectionCard(page, name).getAttribute('aria-label')).toBe(`Abrir la colección ${name}, 0 imágenes`)
    const rows = await sql`SELECT id FROM prayer_images WHERE id = ${doomed}`
    expect(rows).toHaveLength(0)

    await openPage(page)
    await expect.poll(() => history(page).isVisible(), { timeout: 10_000 }).toBe(true)
    expect(await saved(page, doomed).count()).toBe(0)
    expect((await page.request.get(`${E2E_URL}/api/peticiones/imagenes/${doomed}/content`, { maxRedirects: 0 })).status()).toBe(404)
    await page.close()
  })

  it('a 360 px las colecciones y el historial caben sin scroll horizontal', async () => {
    const page = await pageAs(AUTHOR, viewports.phone)
    await openPage(page)
    await expect.poll(() => saved(page, imageId).isVisible(), { timeout: 10_000 }).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.close()
  })
})
