// T033 / T051 / T066 / T077 — Página Peticiones (feature 007, quickstart § 3): tarjetas de peticiones aprobadas, selección,
// generación de imágenes contra el stub de OpenRouter, corrección de transcripciones y filtros. Los datos se siembran en la
// rama de pruebas con `seedPrayerRequest`; las aprobaciones de esta corrida son las más recientes (otros archivos e2e corren
// antes, uno a la vez), así que salen primero en la rejilla.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { E2E_URL, profileUserId, runId, seedPrayerRequest, signedInAs, viewports, waitForHydration } from './setup/fixtures'
import type { Credentials, PrayerSeed } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

let session: Cookie[] | null = null
let editor: Credentials
let owner: string

async function editorPage(viewport: { width: number, height: number } = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  if (session) await page.context().addCookies(session)
  else {
    editor = await signedInAs(page, 'editor', 'peticiones')
    session = await page.context().cookies()
  }
  return page
}

async function openPage(page: Page) {
  await page.goto(`${E2E_URL}/peticiones`)
  await waitForHydration(page)
  await expect.poll(() => page.getByRole('list', { name: 'Peticiones aprobadas' }).isVisible()).toBe(true)
}

const card = (page: Page, sender: string) => page.getByRole('article', { name: `Petición de ${sender}`, exact: true })
const box = (page: Page, sender: string) => page.getByRole('checkbox', { name: `Elegir la petición de ${sender}`, exact: true })
const bar = (page: Page) => page.getByRole('region', { name: 'Selección de peticiones' })

/** Siembra en orden: el primero queda como el aprobado más reciente. */
async function seedMany(prefix: string, count: number, extra: PrayerSeed = {}): Promise<string[]> {
  const names: string[] = []
  const base = Date.now()
  for (let i = 0; i < count; i++) {
    const senderName = `${prefix} ${String(i + 1).padStart(2, '0')} ${runId()}`
    await seedPrayerRequest(owner, { senderName, text: `Petición ${i + 1} de ${prefix}`, reviewedAt: new Date(base - i * 1000), ...extra })
    names.push(senderName)
  }
  return names
}

beforeAll(async () => {
  const page = await editorPage()
  owner = await profileUserId(editor.email)
  await page.close()
})

describe('US1 · ver las peticiones y elegir cuáles proyectar', () => {
  it('solo aparecen las aprobadas, con foto, texto, nombre y fechas', async () => {
    const hidden = {
      pending: `Por revisar ${runId()}`,
      rejected: `Rechazada ${runId()}`,
      trashed: `En papelera ${runId()}`,
    }
    await seedPrayerRequest(owner, { senderName: hidden.pending, status: 'pending' })
    await seedPrayerRequest(owner, { senderName: hidden.rejected, status: 'rejected' })
    await seedPrayerRequest(owner, { senderName: hidden.trashed, deleted: true })
    const [shown] = await seedMany('Visible', 1, { note: 'para el domingo' })

    const page = await editorPage()
    await openPage(page)
    const visible = card(page, shown!)
    await expect.poll(() => visible.isVisible()).toBe(true)
    const text = await visible.innerText()
    expect(text).toContain('Petición 1 de Visible')
    expect(text).toMatch(/Aprobada hace/)
    expect(text).toContain('Enviada el')
    expect(text).toContain('para el domingo')
    await visible.scrollIntoViewIfNeeded()
    await expect.poll(() => visible.getByRole('img').getAttribute('src')).toMatch(/\/api\/files\/[0-9a-f-]+\/content$/)
    for (const name of Object.values(hidden)) expect(await card(page, name).count()).toBe(0)
    await page.close()
  })

  it('marcar con clic en la tarjeta, en la casilla y con Espacio; desmarcar; Abrir foto no cambia la selección', async () => {
    const names = await seedMany('Elegir', 4)
    const page = await editorPage()
    await openPage(page)

    // Toda la tarjeta es objetivo de la casilla.
    await card(page, names[0]!).click({ position: { x: 40, y: 40 } })
    await box(page, names[1]!).check()
    await box(page, names[2]!).focus()
    await page.keyboard.press('Space')
    await expect.poll(() => bar(page).innerText()).toContain('3 peticiones → 1 imagen')
    expect(await box(page, names[2]!).isChecked()).toBe(true)

    await box(page, names[1]!).uncheck()
    await expect.poll(() => bar(page).innerText()).toContain('2 peticiones → 1 imagen')

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      card(page, names[3]!).getByRole('link', { name: 'Abrir foto' }).click(),
    ])
    await popup.close()
    expect(await box(page, names[3]!).isChecked()).toBe(false)
    await expect.poll(() => bar(page).innerText()).toContain('2 peticiones → 1 imagen')

    await bar(page).getByRole('button', { name: 'Ver elegidas' }).click()
    const dialog = page.getByRole('dialog', { name: 'Peticiones elegidas' })
    await expect.poll(() => dialog.innerText()).toContain(names[0])
    expect(await dialog.innerText()).toContain(names[2])
    await dialog.getByRole('button', { name: 'Cerrar' }).first().click()
    await page.close()
  })

  it('una tarjeta sin texto no se puede marcar y dice por qué', async () => {
    const [name] = await seedMany('Sin texto', 1, { textStatus: 'empty', text: null })
    const page = await editorPage()
    await openPage(page)
    expect(await box(page, name!).isDisabled()).toBe(true)
    expect(await card(page, name!).innerText()).toContain('Sin texto: escríbelo primero')
    await page.close()
  })

  it('con 14 nuevas se cargan 12 y al desplazarse el resto, sin duplicados, conservando la selección', async () => {
    const names = await seedMany('Scroll', 14)
    const page = await editorPage()
    await openPage(page)
    const cards = page.getByRole('list', { name: 'Peticiones aprobadas' }).getByRole('article')
    expect(await cards.count()).toBe(12)
    await box(page, names[0]!).check()
    await expect.poll(() => bar(page).innerText()).toContain('1 petición → 1 imagen')

    // Hasta el aviso de fin (detrás de las de esta corrida pueden venir las aprobadas por otros archivos e2e).
    await expect.poll(async () => {
      await page.mouse.wheel(0, 20_000)
      return page.getByText('Ya viste todas las peticiones').isVisible()
    }, { timeout: 60_000 }).toBe(true)
    for (const name of names) expect(await card(page, name).count(), name).toBe(1)
    expect(await box(page, names[0]!).isChecked()).toBe(true)
    await expect.poll(() => bar(page).innerText()).toContain('1 petición → 1 imagen')
    await page.close()
  })

  it('Copiar enlace para invitados confirma con un aviso', async () => {
    const page = await editorPage()
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E2E_URL })
    await openPage(page)
    await page.getByRole('button', { name: 'Copiar enlace para invitados' }).first().click()
    await expect.poll(() => page.getByText('Enlace para invitados copiado').isVisible()).toBe(true)
    await page.close()
  })

  it('a 360 px no hay scroll horizontal', async () => {
    await seedMany('Movil', 2, { note: 'Una nota larga para comprobar que el texto se ajusta sin desbordar la tarjeta en un teléfono pequeño' })
    const page = await editorPage(viewports.phone)
    await openPage(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.close()
  })
})
