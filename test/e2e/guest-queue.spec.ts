// US3 — Envío público de invitados con cola de aprobación.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { E2E_URL, fixture, profileUserId, resetStub, runId, seedFolder, signedInAs, stubCalls, testSql, viewports, waitForHydration } from './setup/fixtures'
import { NOTE_TEXT } from './setup/openrouter-stub'

await setup({ host: E2E_URL, browser: true })

let guestNo = 0
/** Cada invitado lleva su propia IP (X-Forwarded-For): el límite de uno no afecta a otro. */
/** La IP se añade solo a las peticiones al servidor de la app: en las subidas a S3 un header extra rompería el preflight CORS. */
async function pageFromIp(ip: string) {
  const page = await createPage(undefined, { viewport: viewports.phone })
  await page.route(url => url.origin === E2E_URL, route => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }))
  return page
}

async function guestPage() {
  guestNo++
  return pageFromIp(`203.0.113.${guestNo}`)
}

async function sendAsGuest(page: Page, name: string, files: string[]) {
  await page.goto(`${E2E_URL}/enviar`)
  await waitForHydration(page)
  await page.getByLabel('Tu nombre').fill(name)
  await page.getByLabel('Elegir archivos', { exact: true }).setInputFiles(files.map(fixture))
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect.poll(async () => {
    if (await page.getByText('Recibimos tu envío').isVisible()) return 'ok'
    const alert = page.getByRole('alert')
    return (await alert.count()) > 0 ? `alert: ${await alert.first().innerText()}` : 'esperando'
  }, { timeout: 60_000 }).toBe('ok')
}

describe('US3 · envíos de invitados', () => {
  const sender = `Invitada ${runId()}`

  it('un invitado envía desde el móvil y el equipo recibe el aviso en menos de 5 s', async () => {
    const editor = await createPage(undefined, { viewport: viewports.desktop })
    await signedInAs(editor, 'editor', 'guest-editor')
    // El primer pulso fija el cursor; los envíos posteriores se avisan.
    await expect.poll(() => editor.getByRole('link', { name: 'Solicitudes', exact: true }).isVisible()).toBe(true)

    const guest = await guestPage()
    await sendAsGuest(guest, sender, ['foto.jpg', 'imagen.png'])
    const sentAt = Date.now()
    await expect.poll(() => editor.getByText(`Nuevo envío de ${sender} (2 archivos)`).isVisible(), { timeout: 5000 }).toBe(true)
    expect(Date.now() - sentAt).toBeLessThan(5000)
    await expect.poll(() => editor.getByRole('link', { name: /^Solicitudes \d/ }).innerText()).toMatch(/\d/)
    await guest.close()

    // Aprobar hacia la raíz: los archivos aparecen con el badge "invitado".
    await editor.getByRole('link', { name: 'Ver', exact: true }).click()
    await editor.waitForURL(url => url.pathname === '/solicitudes')
    const card = editor.getByRole('article', { name: `Envío de ${sender}` })
    await expect.poll(() => card.isVisible()).toBe(true)
    await expect.poll(() => card.getByText(/caduca en \d+ días/).isVisible()).toBe(true)
    await card.getByRole('button', { name: 'Aprobar' }).click()
    await editor.getByRole('button', { name: 'Aprobar aquí' }).click()
    await expect.poll(() => editor.getByText(`Se aprobaron 2 archivos de ${sender}`).isVisible()).toBe(true)
    await expect.poll(() => card.count()).toBe(0)

    await editor.goto(`${E2E_URL}/archivos`)
    await waitForHydration(editor)
    await expect.poll(() => editor.getByText('invitado', { exact: true }).count()).toBeGreaterThanOrEqual(2)
    await editor.close()
  })

  it('un envío rechazado desaparece de la cola y no llega a Archivos', async () => {
    const editor = await createPage(undefined, { viewport: viewports.desktop })
    await signedInAs(editor, 'editor', 'guest-editor')
    const guest = await guestPage()
    const name = `Rechazada ${runId()}`
    await sendAsGuest(guest, name, ['notas.txt'])
    await guest.close()

    await editor.goto(`${E2E_URL}/solicitudes`)
    await waitForHydration(editor)
    const card = editor.getByRole('article', { name: `Envío de ${name}` })
    await expect.poll(() => card.isVisible()).toBe(true)
    await card.getByRole('button', { name: 'Rechazar' }).click()
    await editor.getByLabel('Motivo (opcional)').fill('No corresponde')
    await editor.getByRole('button', { name: 'Rechazar envío' }).click()
    await expect.poll(() => editor.getByText(`Se rechazó el envío de ${name}`).isVisible()).toBe(true)
    await expect.poll(() => card.count()).toBe(0)

    await editor.getByRole('tab', { name: 'Rechazados' }).click()
    await expect.poll(() => editor.getByRole('article', { name: `Envío de ${name}` }).isVisible()).toBe(true)

    // Otras suites suben su propio `notas.txt` a Archivos: buscar por nombre no prueba nada aquí.
    // Se comprueba que el envío rechazado no dejó ningún archivo del equipo.
    const sql = testSql()
    expect(await sql`
      SELECT f.id FROM files f JOIN guest_submissions s ON s.id = f.submission_id WHERE s.sender_name = ${name}
    `).toEqual([])
    expect(await sql`SELECT status FROM guest_submissions WHERE sender_name = ${name}`).toEqual([{ status: 'rejected' }])
    await editor.close()
  })

  it('dos pestañas que aprueban el mismo envío: la segunda ve que ya fue revisado', async () => {
    const first = await createPage(undefined, { viewport: viewports.desktop })
    await signedInAs(first, 'editor', 'guest-editor')
    const second = await createPage(undefined, { viewport: viewports.desktop })
    await second.context().addCookies(await first.context().cookies())
    const guest = await guestPage()
    const name = `Doble ${runId()}`
    await sendAsGuest(guest, name, ['audio.mp3'])
    await guest.close()

    for (const page of [first, second]) {
      await page.goto(`${E2E_URL}/solicitudes`)
      await waitForHydration(page)
      await expect.poll(() => page.getByRole('article', { name: `Envío de ${name}` }).isVisible()).toBe(true)
      await page.getByRole('article', { name: `Envío de ${name}` }).getByRole('button', { name: 'Aprobar' }).click()
      await expect.poll(() => page.getByRole('button', { name: 'Aprobar aquí' }).isVisible()).toBe(true)
    }
    await first.getByRole('button', { name: 'Aprobar aquí' }).click()
    await expect.poll(() => first.getByText(`Se aprobó «audio`).isVisible()).toBe(true)
    await second.getByRole('button', { name: 'Aprobar aquí' }).click()
    await expect.poll(() => second.getByText('ya fue revisado por otra persona').isVisible()).toBe(true)
    await second.close()
    await first.close()
  })

  it('enviar sin nombre muestra un error en línea', async () => {
    const guest = await guestPage()
    await guest.goto(`${E2E_URL}/enviar`)
    await waitForHydration(guest)
    await guest.getByLabel('Elegir archivos', { exact: true }).setInputFiles([fixture('foto.jpg')])
    await guest.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => guest.getByRole('alert').first().innerText()).toContain('Este campo es obligatorio')
    const overflow = await guest.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await guest.close()
  })

  it('el sexto envío en una hora desde la misma IP responde 429 con el mensaje', async () => {
    const ip = `203.0.113.${200 + guestNo}`
    const body = JSON.stringify({ senderName: 'Spam', files: [{ name: 'foto.jpg', size: 10, mimeType: 'image/jpeg' }] })
    const post = () => fetch(`${E2E_URL}/api/public/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body,
    })
    for (let i = 0; i < 5; i++) expect((await post()).status).toBe(201)
    const sixth = await post()
    expect(sixth.status).toBe(429)
    expect(sixth.headers.get('retry-after')).toMatch(/^\d+$/)

    const guest = await pageFromIp(ip)
    await guest.goto(`${E2E_URL}/enviar`)
    await waitForHydration(guest)
    await guest.getByLabel('Tu nombre').fill('Spam')
    await guest.getByLabel('Elegir archivos', { exact: true }).setInputFiles([fixture('foto.jpg')])
    await guest.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => guest.getByRole('alert').first().innerText()).toContain('Has enviado demasiados archivos; intenta en una hora')
    await guest.close()
  })
})

// Feature 003 · US3 — en Solicitudes, cada envío muestra su origen y, si llegó por permiso, quién dio acceso.
describe('US3 (feature 003) · origen de los envíos', () => {
  it('a 360 px distingue "Por enlace" y "Por permiso", y aprobar el de permiso lo deja en la carpeta como invitado', async () => {
    const editor = await createPage(undefined, { viewport: viewports.phone })
    const creds = await signedInAs(editor, 'editor', 'origin-editor')
    const folderId = await seedFolder(`Origen ${runId()}`, await profileUserId(creds.email))

    const byLink = `Por enlace ${runId()}`
    const linkGuest = await guestPage()
    await sendAsGuest(linkGuest, byLink, ['imagen.png'])
    await linkGuest.close()

    // El otro invitado pide acceso en /upload; el editor se lo da y el invitado envía.
    const byPermission = `Por permiso ${runId()}`
    const permitted = await guestPage()
    await permitted.goto(`${E2E_URL}/upload`)
    await waitForHydration(permitted)
    await permitted.getByLabel('Tu nombre').fill(byPermission)
    await permitted.getByRole('button', { name: 'Pedir acceso' }).click()
    await expect.poll(async () => (await testSql()`SELECT id FROM guest_access_requests WHERE sender_name = ${byPermission}`).length).toBe(1)
    const [request] = await testSql()`SELECT id FROM guest_access_requests WHERE sender_name = ${byPermission}`
    expect((await editor.request.post(`${E2E_URL}/api/access-requests/${request!.id}/approve`)).status()).toBe(204)
    await expect.poll(() => permitted.getByLabel('Elegir archivos', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    await permitted.getByLabel('Elegir archivos', { exact: true }).setInputFiles([fixture('foto.jpg')])
    await permitted.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => permitted.getByText('¡Gracias! Recibimos tu envío').first().isVisible(), { timeout: 60_000 }).toBe(true)
    await permitted.close()

    await editor.goto(`${E2E_URL}/solicitudes`)
    await waitForHydration(editor)
    const linkCard = editor.getByRole('article', { name: `Envío de ${byLink}` })
    const permissionCard = editor.getByRole('article', { name: `Envío de ${byPermission}` })
    await expect.poll(() => permissionCard.isVisible()).toBe(true)
    expect(await linkCard.getByText('Por enlace', { exact: true }).isVisible()).toBe(true)
    expect(await permissionCard.getByText('Por permiso', { exact: true }).isVisible()).toBe(true)
    expect(await permissionCard.getByText(`Acceso aprobado por ${creds.name}`).isVisible()).toBe(true)
    expect(await linkCard.getByText('Acceso aprobado por').count()).toBe(0)
    const overflow = await editor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    await permissionCard.getByRole('button', { name: 'Aprobar' }).click()
    await editor.getByRole('radio', { name: new RegExp(`Origen ${runId()}`) }).click()
    await editor.getByRole('button', { name: 'Aprobar aquí' }).click()
    await expect.poll(() => permissionCard.count()).toBe(0)
    expect(await testSql()`
      SELECT f.origin, f.guest_name, f.folder_id FROM files f JOIN guest_submissions s ON s.id = f.submission_id WHERE s.sender_name = ${byPermission}
    `).toEqual([{ origin: 'guest', guest_name: byPermission, folder_id: folderId }])
    await editor.close()

    // Las lecturas de texto de estas imágenes corren en segundo plano contra el stub: se esperan aquí para que no
    // lleguen después del `resetStub()` de la prueba siguiente y le sumen llamadas.
    await expect.poll(async () => (await testSql()`
      SELECT count(*)::int AS n FROM guest_submission_files f JOIN guest_submissions s ON s.id = f.submission_id
      WHERE s.sender_name IN (${byLink}, ${byPermission}) AND (f.text_status IS NULL OR f.text_status = 'reading')
    `)[0]!.n, { timeout: 30_000 }).toBe(0)
  })
})

// Feature 002 · US2 — el texto de las imágenes de invitados se lee en segundo plano al recibir el envío.
describe('US2 · texto de las imágenes de invitados', () => {
  const FIRST_LINE = NOTE_TEXT.split('\n')[0]!
  const note = 'nota.jpg'

  it('confirmación inmediata, texto en Solicitudes, aprobación sin releer y rechazo que lo elimina (9, 10, 11)', async () => {
    await resetStub()
    const editor = await createPage(undefined, { viewport: viewports.phone })
    await signedInAs(editor, 'editor', 'guest-text-editor')

    // 9 · El invitado ve el aviso, recibe la confirmación y nunca ve el texto extraído (FR-016).
    const guest = await guestPage()
    const name = `Texto ${runId()}`
    await guest.goto(`${E2E_URL}/enviar`)
    await waitForHydration(guest)
    expect(await guest.getByText('Leeremos automáticamente el texto de tus imágenes').isVisible()).toBe(true)
    const files = [note, 'nota.heic']
    await sendAsGuest(guest, name, files)
    expect(await guest.content()).not.toContain(FIRST_LINE)
    await guest.close()

    await editor.goto(`${E2E_URL}/solicitudes`)
    await waitForHydration(editor)
    const card = editor.getByRole('article', { name: `Envío de ${name}` })
    await expect.poll(() => card.isVisible()).toBe(true)
    const panel = card.getByRole('region', { name: `Texto de «${note}»` })
    await expect.poll(() => panel.textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)
    const callsBeforeApproval = (await stubCalls()).total
    expect(callsBeforeApproval).toBe(files.length)

    // 10 · Al aprobar, el archivo conserva el texto sin una lectura nueva.
    await card.getByRole('button', { name: 'Aprobar' }).click()
    await editor.getByRole('button', { name: 'Aprobar aquí' }).click()
    await expect.poll(() => card.count()).toBe(0)
    const [approved] = await testSql()`
      SELECT f.id, f.text_status FROM files f JOIN guest_submissions s ON s.id = f.submission_id
      WHERE s.sender_name = ${name} AND f.extension = 'jpg'
    `
    expect(approved).toMatchObject({ text_status: 'ready' })
    await editor.goto(`${E2E_URL}/archivos/ver/${approved!.id}`)
    await waitForHydration(editor)
    await expect.poll(() => editor.getByRole('region', { name: 'Texto de la imagen' }).textContent()).toContain(FIRST_LINE)
    expect((await stubCalls()).total).toBe(callsBeforeApproval)

    // 11 · Rechazar otro envío con imagen elimina sus filas, y con ellas el texto.
    const other = await guestPage()
    const rejected = `Texto rechazado ${runId()}`
    await sendAsGuest(other, rejected, ['imagen.png'])
    await other.close()
    await editor.goto(`${E2E_URL}/solicitudes`)
    await waitForHydration(editor)
    const rejectCard = editor.getByRole('article', { name: `Envío de ${rejected}` })
    await expect.poll(() => rejectCard.getByRole('region', { name: 'Texto de «imagen.png»' }).textContent(), { timeout: 30_000 }).toContain(FIRST_LINE)
    await rejectCard.getByRole('button', { name: 'Rechazar' }).click()
    await editor.getByRole('button', { name: 'Rechazar envío' }).click()
    await expect.poll(() => rejectCard.count()).toBe(0)
    expect(await testSql()`
      SELECT g.id FROM guest_submission_files g JOIN guest_submissions s ON s.id = g.submission_id WHERE s.sender_name = ${rejected}
    `).toEqual([])
    await editor.close()
  })
})
