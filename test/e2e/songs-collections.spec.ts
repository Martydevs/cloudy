// T057 — US3 (feature 006, quickstart § 4 Colecciones): colecciones globales del equipo. Crear vacía desde la fila y desde una
// canción, agregar sin duplicar, permisos de autor/admin, generar toda la colección (un archivo por canción, de uno en uno, con
// fallo parcial) y eliminarla sin tocar el historial. Contra los stubs de Apify y `cloudy-api`.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { letrasUrl } from './setup/constants'
import { E2E_URL, runId, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const sql = testSql()

async function pageAs(role: 'editor' | 'admin', label: string, viewport = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  await signedInAs(page, role, label)
  return page
}

async function openIndex(page: Page) {
  await page.goto(`${E2E_URL}/canciones`)
  await waitForHydration(page)
}

async function fetchSong(page: Page, slug: string): Promise<string> {
  await openIndex(page)
  await page.getByLabel('Enlace de Letras.com').fill(letrasUrl(slug))
  await page.getByRole('button', { name: 'Ver letra' }).click()
  await page.waitForURL(url => /^\/canciones\/[0-9a-f-]{36}$/.test(url.pathname))
  return new URL(page.url()).pathname.split('/').pop()!
}

const row = (page: Page) => page.getByRole('list', { name: 'Colecciones del equipo' })
const toast = (page: Page, text: string) => page.getByText(text, { exact: true })

async function addFromSong(page: Page, collection: string, { create = false } = {}) {
  await page.getByRole('button', { name: 'Agregar a colección' }).click()
  const dialog = page.getByRole('dialog')
  if (create) {
    await dialog.getByLabel('Nombre').fill(collection)
    await dialog.getByRole('button', { name: 'Crear colección' }).click()
  }
  else {
    await dialog.getByRole('tab', { name: 'Agregar a una existente' }).click()
    await dialog.getByRole('button', { name: new RegExp(collection) }).click()
  }
}

describe('US3 · colecciones', () => {
  const name = `Domingo ${runId()}`
  const slugs = [`coleccion-uno-${runId()}`, `coleccion-letra-vacia-${runId()}`]

  it('«Nueva colección» crea una colección sin canciones (con la fila vacía, desde su estado vacío)', async () => {
    const page = await pageAs('editor', 'songs-col-author')
    await openIndex(page)
    // El orden de los archivos e2e no está garantizado: el estado vacío solo se afirma si no hay colecciones todavía.
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM song_collections` as { count: number }[]
    if (count === 0) await expect.poll(() => page.getByText('Aún no hay colecciones').isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Nueva colección' }).first().click()
    await page.getByRole('dialog').getByLabel('Nombre').fill(`Vacía ${runId()}`)
    await page.getByRole('dialog').getByRole('button', { name: 'Crear colección' }).click()
    await expect.poll(() => toast(page, `Colección «Vacía ${runId()}» creada`).isVisible()).toBe(true)
    await expect.poll(() => row(page).innerText()).toContain('0 canciones')
    await page.close()
  })

  it('crear desde una canción, agregar otra y repetir avisa «ya estaba»', async () => {
    const page = await pageAs('editor', 'songs-col-author')
    await fetchSong(page, slugs[0]!)
    await addFromSong(page, name, { create: true })
    await expect.poll(() => toast(page, `Colección «${name}» creada`).isVisible()).toBe(true)

    await fetchSong(page, slugs[1]!)
    await addFromSong(page, name)
    await expect.poll(() => toast(page, `Agregada a «${name}»`).isVisible()).toBe(true)
    await addFromSong(page, name)
    await expect.poll(() => toast(page, `Ya estaba en «${name}»`).isVisible()).toBe(true)

    await openIndex(page)
    await expect.poll(() => row(page).innerText()).toContain(name)
    expect(await row(page).getByRole('listitem').filter({ hasText: name }).innerText()).toContain('2 canciones')
    await page.close()
  })

  it('otro editor la ve con su autor, puede quitar canciones pero no renombrar ni eliminar; un admin sí', async () => {
    const other = await pageAs('editor', 'songs-col-other')
    await openIndex(other)
    const card = row(other).getByRole('listitem').filter({ hasText: name })
    expect(await card.innerText()).toContain('Creada por E2E songs-col-author')
    await card.getByRole('button', { name: `Abrir la colección ${name}, 2 canciones` }).click()
    const dialog = other.getByRole('dialog')
    await expect.poll(() => dialog.getByRole('list', { name: `Canciones de ${name}` }).isVisible()).toBe(true)
    expect(await dialog.getByRole('button', { name: 'Renombrar' }).count()).toBe(0)
    expect(await dialog.getByRole('button', { name: 'Eliminar colección' }).count()).toBe(0)
    // Sí puede agregar y quitar canciones (FR-021).
    const extra = `coleccion-ajena-${runId()}`
    await fetchSong(other, extra)
    await addFromSong(other, name)
    await expect.poll(() => toast(other, `Agregada a «${name}»`).isVisible()).toBe(true)
    await openIndex(other)
    await row(other).getByRole('button', { name: `Abrir la colección ${name}, 3 canciones` }).click()
    await other.getByRole('dialog').getByRole('button', { name: `Quitar Coleccion ajena ${runId()} de la colección` }).click()
    await other.locator('dialog[open]', { hasText: '¿Quitar' }).getByRole('button', { name: 'Quitar' }).click()
    await expect.poll(() => toast(other, `Se quitó «Coleccion ajena ${runId()}» de la colección`).isVisible()).toBe(true)
    await other.close()

    const admin = await pageAs('admin', 'songs-col-admin')
    await openIndex(admin)
    await row(admin).getByRole('button', { name: `Abrir la colección ${name}, 2 canciones` }).click()
    await expect.poll(() => admin.getByRole('dialog').getByRole('button', { name: 'Renombrar' }).isVisible()).toBe(true)
    await admin.close()
  })

  it('el botón de generar de la tarjeta aparece con hover y con foco en escritorio y siempre en móvil', async () => {
    const desktop = await pageAs('editor', 'songs-col-author')
    await openIndex(desktop)
    const card = row(desktop).getByRole('listitem').filter({ hasText: name })
    const generate = card.getByRole('button', { name: `Generar las presentaciones de ${name}` })
    const opacity = () => generate.evaluate(el => getComputedStyle(el.parentElement!).opacity)
    await desktop.mouse.move(0, 0)
    expect(await opacity()).toBe('0')
    await card.hover()
    await expect.poll(opacity).toBe('1')
    await desktop.mouse.move(0, 0)
    await generate.focus()
    await expect.poll(opacity).toBe('1')
    await desktop.close()

    const phone = await pageAs('editor', 'songs-col-author', viewports.phone)
    await openIndex(phone)
    expect(await row(phone).getByRole('button', { name: `Generar las presentaciones de ${name}` }).isVisible()).toBe(true)
    await phone.close()
  })

  it('generar la colección avisa los archivos y entrega la que funciona aunque otra falle', async () => {
    const page = await pageAs('editor', 'songs-col-author')
    await openIndex(page)
    const downloads: string[] = []
    page.on('download', d => downloads.push(d.suggestedFilename()))
    await row(page).getByRole('button', { name: `Generar las presentaciones de ${name}` }).click()
    const confirm = page.getByRole('dialog')
    await expect.poll(() => confirm.innerText()).toContain('Recibirás 2 archivos, uno por canción.')
    await confirm.getByRole('button', { name: 'Generar 2 presentaciones' }).click()
    const tray = page.getByRole('list', { name: 'Presentaciones de canciones' })
    await expect.poll(() => tray.innerText()).toContain('La letra guardada no tiene contenido. Vuelve a obtenerla.')
    await expect.poll(() => downloads.length).toBe(1)
    expect(downloads[0]).toMatch(/^Coleccion uno/)
    await page.close()
  })

  it('eliminar la colección (con confirmación) deja las canciones en el historial', async () => {
    const page = await pageAs('editor', 'songs-col-author')
    await openIndex(page)
    await row(page).getByRole('button', { name: `Abrir la colección ${name}, 2 canciones` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar colección' }).click()
    await page.locator('dialog[open]', { hasText: '¿Eliminar la colección' }).getByRole('button', { name: 'Eliminar colección' }).click()
    await expect.poll(() => toast(page, `Se eliminó la colección «${name}»`).isVisible()).toBe(true)
    // Las dos canciones que tenía la colección siguen en el historial.
    const urls = slugs.map(slug => `https://letras.com/e2e/${slug}`)
    const rows = await sql`SELECT count(*)::int AS count FROM songs WHERE source_url = ANY(${urls}) AND last_viewed_at IS NOT NULL` as { count: number }[]
    expect(rows[0]!.count).toBe(2)
    await page.close()
  })
})
