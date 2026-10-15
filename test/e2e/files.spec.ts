// US1 — Subir, organizar y encontrar archivos del equipo.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { E2E_URL, fixture, signedInAs, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

async function uploadFiles(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Subir', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Subir archivos' })
  await dialog.getByLabel('Elegir archivos', { exact: true }).setInputFiles(names.map(fixture))
  return dialog
}

async function waitForQueue(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Subir archivos' })
  await expect.poll(() => dialog.getByText(/Subiendo|Verificando|En espera/).count(), { timeout: 60_000 }).toBe(0)
  return dialog
}

async function itemAction(page: Page, itemName: string, action: string) {
  await page.getByRole('button', { name: `Acciones de ${itemName}`, exact: true }).click()
  await page.getByRole('menuitem', { name: action }).click()
}

describe('US1 · archivos del equipo', () => {
  it('flujo completo: carpeta, subida, vista previa, búsqueda, filtros, organización y papelera', async () => {
    const page = await createPage(undefined, { viewport: viewports.desktop, acceptDownloads: true })
    await signedInAs(page, 'editor', 'files-editor')
    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)

    // Crear la carpeta "Domingo" y entrar.
    await page.getByRole('button', { name: 'Nueva carpeta' }).first().click()
    await page.getByLabel('Nombre de la carpeta').fill('Domingo')
    await page.getByRole('button', { name: 'Crear carpeta' }).click()
    await page.getByRole('link', { name: 'Abrir carpeta Domingo' }).click()
    await page.waitForURL(/\/archivos\/[0-9a-f-]{36}$/)
    // Mientras carga la carpeta sigue visible la página anterior: se espera su título.
    await expect.poll(() => page.getByRole('heading', { name: 'Domingo', level: 1 }).isVisible()).toBe(true)
    const folderUrl = page.url()

    // Subir tres archivos a la vez con progreso.
    await uploadFiles(page, ['foto.jpg', 'audio.mp3', 'deck.pptx'])
    const dialog = await waitForQueue(page)
    expect(await dialog.getByText(/· Listo$/).count()).toBe(3)
    await dialog.getByRole('button', { name: 'Listo' }).click()

    for (const name of ['foto.jpg', 'audio.mp3', 'deck.pptx']) {
      await expect.poll(() => page.getByRole('link', { name: `Abrir ${name}` }).isVisible()).toBe(true)
    }
    // Miniatura generada en el navegador.
    await expect.poll(() => page.getByRole('img', { name: 'foto.jpg' }).isVisible()).toBe(true)

    // La vista de lista muestra quién subió, fecha y tamaño.
    await page.getByRole('button', { name: 'Ver en lista' }).click()
    const row = page.getByRole('listitem').filter({ hasText: 'audio.mp3' })
    await expect.poll(() => row.textContent()).toMatch(/E2E files-editor · .+ · 16,\d KB/)
    await page.getByRole('button', { name: 'Ver en cuadrícula' }).click()

    // Reproducir el MP3.
    await page.getByRole('link', { name: 'Abrir audio.mp3' }).click()
    await page.waitForURL(/\/archivos\/ver\//)
    await expect.poll(() => page.locator('audio[controls]').count()).toBe(1)
    await page.goto(folderUrl)
    await waitForHydration(page)

    // Buscar "dom" desde la barra superior encuentra la carpeta.
    await page.getByRole('searchbox', { name: 'Buscar archivos' }).fill('dom')
    await page.keyboard.press('Enter')
    await page.waitForURL(url => url.pathname === '/archivos' && url.searchParams.get('q') === 'dom')
    await expect.poll(() => page.getByRole('link', { name: 'Abrir carpeta Domingo' }).isVisible()).toBe(true)
    await page.goto(folderUrl)
    await waitForHydration(page)

    // Filtrar por Audio deja solo el MP3.
    await page.getByRole('button', { name: 'Audio', exact: true }).click()
    await expect.poll(() => page.getByRole('link', { name: /^Abrir .+\.(jpg|mp3|pptx)$/ }).count()).toBe(1)
    expect(await page.getByRole('link', { name: 'Abrir audio.mp3' }).isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Todos', exact: true }).click()

    // Ordenar por tamaño (mayor primero): el MP3 es el más pesado.
    await page.getByLabel('Ordenar por').selectOption('size-desc')
    // Se compara el orden completo: por nombre el MP3 también va primero, así que mirar solo el
    // primero podría pasar con los datos anteriores.
    const fileOrder = () => page.getByRole('link', { name: /^Abrir .+\.(jpg|mp3|pptx)$/ })
      .evaluateAll(links => links.map(link => link.getAttribute('aria-label')))
    await expect.poll(fileOrder).toEqual(['Abrir audio.mp3', 'Abrir foto.jpg', 'Abrir deck.pptx'])

    // Renombrar conserva la extensión.
    await itemAction(page, 'deck.pptx', 'Renombrar')
    await page.getByLabel('Nombre nuevo').fill('presentacion')
    await page.getByRole('button', { name: 'Renombrar' }).click()
    await expect.poll(() => page.getByRole('link', { name: 'Abrir presentacion.pptx' }).isVisible()).toBe(true)

    // Mover a una subcarpeta.
    await page.getByRole('button', { name: 'Nueva carpeta' }).first().click()
    await page.getByLabel('Nombre de la carpeta').fill('Fotos')
    await page.getByRole('button', { name: 'Crear carpeta' }).click()
    await expect.poll(() => page.getByRole('link', { name: 'Abrir carpeta Fotos' }).isVisible()).toBe(true)
    await itemAction(page, 'foto.jpg', 'Mover')
    await page.getByRole('radio', { name: 'Fotos' }).click()
    await page.getByRole('button', { name: 'Mover aquí' }).click()
    await expect.poll(() => page.getByRole('link', { name: 'Abrir foto.jpg' }).count()).toBe(0)

    // Descargar.
    const download = page.waitForEvent('download')
    await itemAction(page, 'audio.mp3', 'Descargar')
    expect((await download).suggestedFilename()).toBe('audio.mp3')

    // El mismo nombre otra vez recibe sufijo.
    await uploadFiles(page, ['audio.mp3'])
    await (await waitForQueue(page)).getByRole('button', { name: 'Listo' }).click()
    await expect.poll(() => page.getByRole('link', { name: 'Abrir audio (2).mp3' }).isVisible()).toBe(true)

    // Eliminar pide confirmación y lo quita de la lista.
    await itemAction(page, 'audio (2).mp3', 'Eliminar')
    await page.getByRole('dialog', { name: '¿Eliminar «audio (2).mp3»?' }).getByRole('button', { name: 'Enviar a la papelera' }).click()
    await expect.poll(() => page.getByRole('link', { name: 'Abrir audio (2).mp3' }).count()).toBe(0)

    // Un ejecutable renombrado a .jpg se rechaza tras subir y no aparece.
    const fake = await uploadFiles(page, ['falso.jpg'])
    await waitForQueue(page)
    await expect.poll(() => fake.getByText('El contenido no corresponde al tipo de archivo').isVisible()).toBe(true)
    await fake.getByRole('button', { name: 'Listo' }).click()
    expect(await page.getByRole('link', { name: 'Abrir falso.jpg' }).count()).toBe(0)

    await page.close()
  })

  it('subir desde un teléfono (360 px)', async () => {
    const page = await createPage(undefined, { viewport: viewports.phone })
    await signedInAs(page, 'editor', 'files-phone')
    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)
    await uploadFiles(page, ['notas.txt'])
    await (await waitForQueue(page)).getByRole('button', { name: 'Listo' }).click()
    await expect.poll(() => page.getByRole('link', { name: /^Abrir notas( \(\d+\))?\.txt$/ }).first().isVisible()).toBe(true)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.close()
  })

  it('las APIs de archivos validan el tamaño y el tipo antes de firmar', async () => {
    const page = await createPage()
    await signedInAs(page, 'editor', 'files-api')
    const cookies = (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ')
    const post = (body: Record<string, unknown>) => fetch(`${E2E_URL}/api/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies },
      body: JSON.stringify({ folderId: null, withThumbnail: false, ...body }),
    })
    expect((await post({ name: 'culto.mp4', size: 120 * 1024 * 1024, mimeType: 'video/mp4' })).status).toBe(413)
    expect((await post({ name: 'setup.exe', size: 10, mimeType: 'application/x-msdownload' })).status).toBe(415)
    expect((await post({ name: 'foto.jpg', size: 0, mimeType: 'image/jpeg' })).status).toBe(422)
    await page.close()
  })
})
