// Feature 002 · US1 — Texto extraído de las imágenes que sube el equipo, contra el stub de OpenAI (A9).
// La lectura corre en segundo plano tras `complete`: las pruebas esperan el texto en el panel, no la
// respuesta de la subida. El stub lee como nota toda imagen que no reconoce (`foto.jpg`, `imagen.png`).
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { BrowserContextOptions, Page } from 'playwright-core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  E2E_URL,
  fixture,
  profileUserId,
  resetStub,
  seedFolder,
  seedImage,
  setStubMode,
  signedInAs,
  stubCalls,
  testSql,
  textColumns,
  viewports,
  waitForHydration,
} from './setup/fixtures'
import { NOTE_TEXT } from './setup/openai-stub'

await setup({ host: E2E_URL, browser: true })

const NOTE_JPG = 'nota.jpg'
const NOTE_PNG = 'nota.png'
const FIRST_LINE = NOTE_TEXT.split('\n')[0]!

const panel = (page: Page) => page.getByRole('region', { name: 'Texto de la imagen' })

async function uploadAndClose(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Subir', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Subir archivos' })
  await dialog.getByLabel('Elegir archivos', { exact: true }).setInputFiles(names.map(fixture))
  // Se espera a que cada fila llegue a «Listo»: contar solo «sin filas en curso» pasaba antes de que las filas se pintaran.
  await expect.poll(() => dialog.getByText(/· Listo$/).count(), { timeout: 60_000 }).toBe(names.length)
  await dialog.getByRole('button', { name: 'Listo' }).click()
}

/** Abre la vista previa desde la lista y devuelve el id del archivo. */
async function openPreview(page: Page, name: string): Promise<string> {
  await page.getByRole('link', { name: `Abrir ${name}` }).click()
  await page.waitForURL(/\/archivos\/ver\/[0-9a-f-]{36}$/)
  await waitForHydration(page)
  return page.url().split('/').at(-1)!
}

/** Cada prueba sube a su propia carpeta: los nombres repetidos de otras pruebas no reciben sufijo aquí. */
async function openNewFolder(page: Page, email: string, label: string): Promise<() => Promise<void>> {
  const folderId = await seedFolder(`Texto ${label}`, await profileUserId(email))
  const goto = async () => {
    await page.goto(`${E2E_URL}/archivos/${folderId}`)
    await waitForHydration(page)
  }
  await goto()
  return goto
}

// Neon Auth limita los inicios de sesión por IP (AGENTS.md): se inicia una vez y cada página reutiliza la cookie.
let creds: { email: string }
let cookies: Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>

beforeAll(async () => {
  const page = await createPage(undefined, { viewport: viewports.phone })
  creds = await signedInAs(page, 'editor', 'text-editor')
  cookies = await page.context().cookies()
  await page.close()
})

beforeEach(async () => {
  await resetStub()
})

/** Página nueva con la sesión del editor. */
async function editorPage(options: BrowserContextOptions = { viewport: viewports.phone }): Promise<Page> {
  const page = await createPage(undefined, options)
  await page.context().addCookies(cookies)
  return page
}

describe('US1 · texto de las imágenes del equipo', () => {
  it('se lee al subir, se ve al abrir, no se relee al reabrir y se copia (escenarios 1, 2 y 6)', async () => {
    const page = await editorPage({ viewport: viewports.phone, permissions: ['clipboard-read', 'clipboard-write'] })
    await openNewFolder(page, creds.email, '1')
    await uploadAndClose(page, [NOTE_JPG])

    const id = await openPreview(page, NOTE_JPG)
    await expect.poll(() => panel(page).textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)
    expect(await panel(page).textContent()).not.toContain('Skykids')
    expect((await stubCalls()).total).toBe(1)

    // Reabrir: el texto ya está y no hay una lectura nueva.
    await page.reload()
    await waitForHydration(page)
    await expect.poll(() => panel(page).textContent()).toContain(FIRST_LINE)
    expect((await stubCalls()).total).toBe(1)
    expect(await textColumns(id)).toMatchObject({ text_status: 'ready', text_attempts: 1 })

    await panel(page).getByRole('button', { name: 'Copiar texto' }).click()
    await expect.poll(() => page.getByText('Texto copiado').isVisible()).toBe(true)
    await page.close()
  })

  it('dos imágenes subidas juntas se leen cada una (escenario 2c)', async () => {
    const page = await editorPage({ viewport: viewports.desktop })
    const gotoFiles = await openNewFolder(page, creds.email, '2')
    await uploadAndClose(page, [NOTE_JPG, NOTE_PNG])
    await expect.poll(async () => (await stubCalls()).total, { timeout: 30_000 }).toBe(2)

    for (const name of [NOTE_JPG, NOTE_PNG]) {
      await openPreview(page, name)
      await expect.poll(() => panel(page).textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)
      await gotoFiles()
    }
    expect((await stubCalls()).total).toBe(2)
    await page.close()
  })

  it('una imagen sin texto lo dice (escenario 4)', async () => {
    const page = await editorPage({ viewport: viewports.phone })
    await openNewFolder(page, creds.email, '3')
    await uploadAndClose(page, ['paisaje.jpg'])
    await openPreview(page, 'paisaje.jpg')
    await expect.poll(() => panel(page).textContent(), { timeout: 30_000 }).toContain('No se reconoció texto en esta imagen')
    await page.close()
  })

  it('WEBP, GIF y más de 5 MB no están disponibles, sin llamar al modelo (escenario 5)', async () => {
    const page = await editorPage({ viewport: viewports.phone })
    const gotoFiles = await openNewFolder(page, creds.email, '4')
    await uploadAndClose(page, ['imagen.webp', 'anim.gif', 'grande.jpg'])
    for (const name of ['imagen.webp', 'anim.gif', 'grande.jpg']) {
      await openPreview(page, name)
      await expect.poll(() => panel(page).textContent()).toContain('No disponible para este archivo')
      expect(await panel(page).getByRole('button').count()).toBe(0)
      await gotoFiles()
    }
    expect((await stubCalls()).total).toBe(0)
    await page.close()
  })

  it('si el proveedor falla se ofrece Reintentar y la vista previa y la descarga siguen (escenario 8)', async () => {
    await setStubMode({ fail: true })
    const page = await editorPage({ viewport: viewports.phone })
    await openNewFolder(page, creds.email, '5')
    await uploadAndClose(page, ['foto.jpg'])
    const id = await openPreview(page, 'foto.jpg')
    await expect.poll(() => panel(page).textContent(), { timeout: 30_000 }).toContain('No pudimos leer el texto ahora')
    expect(await page.getByRole('img', { name: 'foto.jpg' }).count()).toBeGreaterThan(0)
    expect(await page.getByRole('link', { name: 'Descargar' }).getAttribute('href')).toBe(`/api/files/${id}/content?download=1`)

    await setStubMode({ fail: false })
    await panel(page).getByRole('button', { name: 'Reintentar' }).click()
    await expect.poll(() => panel(page).textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)
    await page.close()
  })

  it('dos pestañas durante la lectura en segundo plano: una sola llamada (escenario 13)', async () => {
    await setStubMode({ delayMs: 6000 })
    const page = await editorPage({ viewport: viewports.desktop })
    await openNewFolder(page, creds.email, '6')
    await uploadAndClose(page, ['foto.jpg'])
    const id = await openPreview(page, 'foto.jpg')
    const second = await editorPage({ viewport: viewports.desktop })
    await second.goto(page.url())
    await waitForHydration(second)

    for (const tab of [page, second]) {
      await expect.poll(() => panel(tab).textContent()).toContain('Leyendo texto…')
    }
    for (const tab of [page, second]) {
      await expect.poll(() => panel(tab).textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)
    }
    expect((await stubCalls()).total).toBe(1)
    expect((await textColumns(id)).text_attempts).toBe(1)
    await second.close()
    await page.close()
  })

  it('una imagen anterior a la feature se lee al abrirla; una HEIC sin copia no está disponible (2d y 3b)', async () => {
    const page = await editorPage({ viewport: viewports.phone })
    const owner = await profileUserId(creds.email)
    const old = await seedImage(owner, NOTE_JPG)
    const heic = await seedImage(owner, 'foto.jpg', { withBytes: false })
    // La fila sembrada como HEIC: misma imagen, pero sin copia para lectura.
    await testSql()`UPDATE files SET extension = 'heic', mime_type = 'image/heic', name = ${`${heic.slice(0, 8)}-foto.heic`} WHERE id = ${heic}`

    await page.goto(`${E2E_URL}/archivos/ver/${old}`)
    await waitForHydration(page)
    await expect.poll(() => panel(page).textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)
    expect((await stubCalls()).total).toBe(1)

    await page.goto(`${E2E_URL}/archivos/ver/${heic}`)
    await waitForHydration(page)
    await expect.poll(() => panel(page).textContent()).toContain('esta foto HEIC se subió sin copia para lectura')
    expect((await stubCalls()).total).toBe(1)
    await page.close()
  })

  it('una HEIC sube su copia JPEG y se lee su texto (escenario 3)', async () => {
    const page = await editorPage({ viewport: viewports.phone })
    await openNewFolder(page, creds.email, '7')
    await uploadAndClose(page, ['nota.heic'])
    await openPreview(page, 'nota.heic')
    await expect.poll(() => panel(page).textContent(), { timeout: 45_000 }).toContain(FIRST_LINE)
    await page.close()
  })
})

describe('US3 · corregir y buscar por el texto', () => {
  it('editar guarda «editado», queda en la actividad y volver a leer pide confirmación (escenario 7)', async () => {
    const page = await editorPage({ viewport: viewports.phone })
    await openNewFolder(page, creds.email, 'editar')
    await uploadAndClose(page, ['foto.jpg'])
    const id = await openPreview(page, 'foto.jpg')
    await expect.poll(() => panel(page).textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)

    await panel(page).getByRole('button', { name: 'Editar' }).click()
    await panel(page).getByLabel('Texto de la imagen').fill('Oremos por la familia Ruiz')
    await panel(page).getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => page.getByText('Texto guardado').isVisible()).toBe(true)
    await expect.poll(() => panel(page).textContent()).toContain('Editado por E2E text-editor')
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Editar')

    const [activity] = await testSql()`SELECT action, meta FROM activity_log WHERE target_id = ${id} AND action = 'file.text_edit'`
    expect(activity).toEqual({ action: 'file.text_edit', meta: { length: 'Oremos por la familia Ruiz'.length } })

    // Volver a leer: se cancela la primera vez y no se lee; al confirmar se reemplaza la corrección.
    const calls = (await stubCalls()).total
    const reread = async () => {
      await panel(page).getByRole('button', { name: 'Más acciones del texto' }).click()
      await page.getByRole('menuitem', { name: 'Volver a leer' }).click()
    }
    await reread()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
    expect((await stubCalls()).total).toBe(calls)
    await reread()
    await page.getByRole('dialog').getByRole('button', { name: 'Volver a leer' }).click()
    await expect.poll(() => panel(page).textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)
    expect(await panel(page).textContent()).not.toContain('Editado')
    expect((await stubCalls()).total).toBe(calls + 1)
    await page.close()
  })

  it('la búsqueda encuentra una imagen recién subida por su texto y la excluye tras la papelera (escenario 12)', async () => {
    const page = await editorPage({ viewport: viewports.desktop })
    const gotoFolder = await openNewFolder(page, creds.email, 'buscar')
    await uploadAndClose(page, ['imagen.png'])
    const id = await openPreview(page, 'imagen.png')
    // La lectura de segundo plano termina sola; aquí se corrige con una palabra única para la búsqueda.
    await expect.poll(() => panel(page).textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)
    const word = `girasol${id.slice(0, 6)}`
    await panel(page).getByRole('button', { name: 'Editar' }).click()
    await panel(page).getByLabel('Texto de la imagen').fill(`Gracias por el ${word}`)
    await panel(page).getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => panel(page).textContent()).toContain(word)

    await page.getByRole('searchbox', { name: 'Buscar archivos' }).fill(word)
    await page.keyboard.press('Enter')
    await page.waitForURL(url => url.searchParams.get('q') === word)
    await expect.poll(() => page.getByRole('link', { name: 'Abrir imagen.png' }).isVisible()).toBe(true)
    expect(await page.getByText('En el texto', { exact: true }).count()).toBe(1)
    expect(await page.getByText('Solo buscamos en el texto de las imágenes que ya se leyeron').isVisible()).toBe(true)

    await gotoFolder()
    await page.getByRole('button', { name: 'Acciones de imagen.png', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    await page.getByRole('dialog', { name: '¿Eliminar «imagen.png»?' }).getByRole('button', { name: 'Enviar a la papelera' }).click()
    await expect.poll(() => page.getByText('«imagen.png» se envió a la papelera').isVisible()).toBe(true)
    await page.goto(`${E2E_URL}/archivos?q=${word}`)
    await waitForHydration(page)
    await expect.poll(() => page.getByText(`No encontramos nada con «${word}»`).isVisible()).toBe(true)
    await page.close()
  })
})
