// Feature 003 · US1 — el invitado pide acceso en /upload, el equipo decide en /solicitudes y el invitado envía
// sus archivos con permiso. Invitados a 360 px, editores a 1280 px; cada invitado con su propia IP.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Cookie, Page } from 'playwright-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { ACCESS_REQUEST_LIMIT } from '../../shared/constants/access'
import { E2E_URL, fixture, runId, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

let guestNo = 0
/** La IP va solo a las peticiones de la app: en las subidas a S3 un header extra rompería el preflight CORS. */
async function guestPage(ip = `198.51.100.${++guestNo}`) {
  const page = await createPage(undefined, { viewport: viewports.phone })
  await page.route(url => url.origin === E2E_URL, route => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }))
  return { page, ip }
}

// Una sola sesión de editor para todo el archivo: Neon Auth limita los inicios de sesión por IP (AGENTS.md).
let editorCookies: Cookie[] = []
beforeAll(async () => {
  const page = await createPage(undefined, { viewport: viewports.desktop })
  await signedInAs(page, 'editor', 'access-editor')
  editorCookies = await page.context().cookies()
  await page.close()
})

async function editorPage() {
  const page = await createPage(undefined, { viewport: viewports.desktop })
  await page.context().addCookies(editorCookies)
  await page.goto(`${E2E_URL}/solicitudes`)
  await waitForHydration(page)
  // El primer pulso fija el cursor: las solicitudes posteriores se avisan.
  await expect.poll(() => page.getByRole('heading', { name: 'Solicitudes de acceso' }).isVisible()).toBe(true)
  return page
}

async function askAccess(page: Page, name: string) {
  if (!new URL(page.url()).pathname.startsWith('/upload')) {
    await page.goto(`${E2E_URL}/upload`)
    await waitForHydration(page)
  }
  await page.getByLabel('Tu nombre').fill(name)
  await page.getByRole('button', { name: 'Pedir acceso' }).click()
}

const waitingText = 'Esperando a que alguien del equipo revise tu solicitud'
/**
 * Espera de una transición que no se cronometra: un ciclo de sondeo (5 s) más las idas y vueltas a Neon, que desde
 * el laboratorio llegan a varios segundos. Los tiempos objetivo (SC-002, SC-005) se miden aparte, con 6 s.
 */
const POLL_WAIT = 10_000
/** Los textos de estado también están en la región `aria-live` (oculta a la vista): se mira el primero. */
const shows = (page: Page, text: string) => page.getByText(text, { exact: true }).first().isVisible()
const requestCard = (page: Page, name: string) => page.getByRole('article', { name })

async function requestId(name: string): Promise<string> {
  const [row] = await testSql()`SELECT id FROM guest_access_requests WHERE sender_name = ${name} ORDER BY created_at DESC LIMIT 1`
  if (!row) throw new Error(`No hay solicitud de ${name}`)
  return row.id as string
}

/** Decide como el equipo, por la API y con la sesión del editor (cuando la UI no es lo que se prueba). */
async function decide(editor: Page, name: string, verb: 'approve' | 'reject') {
  const res = await editor.request.post(`${E2E_URL}/api/access-requests/${await requestId(name)}/${verb}`)
  expect(res.status(), `${verb} ${name}`).toBe(204)
}

describe('US1 · pedir acceso, decidir y enviar con permiso', () => {
  it('de /login a "Esperando", aviso al equipo, aprobación en vivo, envío y acceso ya usado', async () => {
    const editor = await editorPage()
    // Nombres propios de este archivo: guest-queue usa "Invitada", "Rechazada" y "Doble" en la misma corrida.
    const name = `Pide acceso ${runId()}`

    // Desde el inicio de sesión (FR-001).
    const { page: guest } = await guestPage()
    await guest.goto(`${E2E_URL}/login`)
    await waitForHydration(guest)
    const started = Date.now()
    await guest.getByRole('link', { name: 'Enviar archivos' }).click()
    await guest.waitForURL(url => url.pathname === '/upload')
    await waitForHydration(guest)
    await askAccess(guest, name)
    await expect.poll(() => guest.getByText(waitingText).first().isVisible()).toBe(true)
    // SC-001: de /login a "Esperando" en menos de 30 s.
    expect(Date.now() - started).toBeLessThan(30_000)
    const requestedAt = Date.now()

    // Recargar no crea otra solicitud: el SSR con la cookie pinta el mismo estado, sin desajustes al hidratar
    // (regresión: el SSR pintaba el esqueleto y el cliente "Esperando").
    const consoleErrors: string[] = []
    guest.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await guest.reload()
    await waitForHydration(guest)
    await expect.poll(() => guest.getByText(waitingText).first().isVisible()).toBe(true)
    expect(consoleErrors.filter(text => /hydrat/i.test(text))).toEqual([])
    expect(await guest.getByText(name).isVisible()).toBe(true)

    // El equipo ve el aviso y la solicitud en ≤ 5 s (siguiente ciclo del pulso; margen de red).
    await expect.poll(() => editor.getByText(`${name} pide permiso para enviar archivos`).isVisible(), { timeout: 6000 }).toBe(true)
    expect(Date.now() - requestedAt).toBeLessThan(6000)
    await expect.poll(() => requestCard(editor, name).isVisible()).toBe(true)
    expect(await requestCard(editor, name).count()).toBe(1)
    expect(await testSql()`SELECT count(*)::int AS n FROM guest_access_requests WHERE sender_name = ${name}`).toEqual([{ n: 1 }])

    // "Dar acceso" con un toque; el invitado ve el formulario en ≤ 5 s sin recargar.
    await requestCard(editor, name).getByRole('button', { name: 'Dar acceso' }).click()
    await expect.poll(() => editor.getByText(`Diste acceso a ${name}`).isVisible()).toBe(true)
    const approvedAt = Date.now()
    await expect.poll(() => shows(guest, '¡Listo! Ya puedes enviar tus archivos'), { timeout: 6000 }).toBe(true)
    expect(Date.now() - approvedAt).toBeLessThan(6000)
    await expect.poll(() => requestCard(editor, name).count()).toBe(0)

    // El envío con permiso (SC-003: del formulario a la confirmación en menos de 1 min).
    const formShownAt = Date.now()
    await guest.getByLabel('Elegir archivos', { exact: true }).setInputFiles([fixture('nota.jpg')])
    await guest.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => shows(guest, '¡Gracias! Recibimos tu envío'), { timeout: 60_000 }).toBe(true)
    expect(Date.now() - formShownAt).toBeLessThan(60_000)
    expect(await guest.getByRole('button', { name: 'Pedir acceso para otro envío' }).isVisible()).toBe(true)

    // Llega a la cola con su nombre.
    await editor.reload()
    await waitForHydration(editor)
    await expect.poll(() => editor.getByRole('article', { name: `Envío de ${name}` }).isVisible()).toBe(true)
    expect(await testSql()`SELECT origin FROM guest_submissions WHERE sender_name = ${name}`).toEqual([{ origin: 'permission' }])

    // Volver a enviar con el mismo acceso: ya se usó.
    const again = await guest.request.post(`${E2E_URL}/api/public/access/submissions`, {
      data: { files: [{ name: 'foto.jpg', size: 10, mimeType: 'image/jpeg' }] },
    })
    expect(again.status()).toBe(403)
    expect((await again.json()).message).toBe('Tu acceso ya se usó. Pide uno nuevo para enviar más archivos')

    // Otro navegador, sin la cookie, empieza de cero.
    const { page: other } = await guestPage()
    await other.goto(`${E2E_URL}/upload`)
    await waitForHydration(other)
    await expect.poll(() => other.getByRole('button', { name: 'Pedir acceso' }).isVisible()).toBe(true)
    const overflow = await guest.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await other.close()
    await guest.close()
    await editor.close()
  })

  it('una solicitud rechazada se lo dice al invitado', async () => {
    const editor = await editorPage()
    const name = `Acceso rechazado ${runId()}`
    const { page: guest } = await guestPage()
    await askAccess(guest, name)
    await expect.poll(() => guest.getByText(waitingText).first().isVisible()).toBe(true)

    await expect.poll(() => requestCard(editor, name).isVisible(), { timeout: 10_000 }).toBe(true)
    await requestCard(editor, name).getByRole('button', { name: 'Rechazar' }).click()
    const dialog = editor.getByRole('dialog', { name: `¿Rechazar la solicitud de ${name}?` })
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Rechazar' }).click()
    await expect.poll(() => editor.getByText(`Rechazaste la solicitud de ${name}`).isVisible()).toBe(true)

    await expect.poll(() => shows(guest, 'El equipo no aceptó tu solicitud'), { timeout: POLL_WAIT }).toBe(true)
    expect(await guest.getByRole('button', { name: 'Pedir acceso de nuevo' }).isVisible()).toBe(true)
    await guest.close()
    await editor.close()
  })

  it('caducidad: la solicitud sin atender y el acceso aprobado sin usar', async () => {
    const editor = await editorPage()
    const sql = testSql()

    // Solicitud sin atender (se adelanta su vencimiento solo en la rama de pruebas).
    const waiting = `Sin atender ${runId()}`
    const { page: first } = await guestPage()
    await askAccess(first, waiting)
    await expect.poll(() => first.getByText(waitingText).first().isVisible()).toBe(true)
    await sql`UPDATE guest_access_requests SET expires_at = now() - interval '1 second' WHERE id = ${await requestId(waiting)}`
    await expect.poll(() => shows(first, 'Tu solicitud caducó sin que nadie la atendiera'), { timeout: POLL_WAIT }).toBe(true)
    await first.close()

    // Acceso aprobado que vence sin usarse.
    const approved = `Sin usar ${runId()}`
    const { page: second } = await guestPage()
    await askAccess(second, approved)
    await expect.poll(() => second.getByText(waitingText).first().isVisible()).toBe(true)
    await decide(editor, approved, 'approve')
    await expect.poll(() => shows(second, '¡Listo! Ya puedes enviar tus archivos'), { timeout: POLL_WAIT }).toBe(true)
    await sql`UPDATE guest_access_requests SET access_expires_at = now() - interval '1 second' WHERE id = ${await requestId(approved)}`
    await expect.poll(() => shows(second, 'Tu acceso caducó antes de empezar el envío'), { timeout: POLL_WAIT }).toBe(true)
    expect(await second.getByRole('button', { name: 'Pedir acceso de nuevo' }).isVisible()).toBe(true)
    await second.close()
    await editor.close()
  })

  it('dos personas del equipo deciden a la vez: la segunda ve quién ya dio acceso', async () => {
    const first = await editorPage()
    const second = await editorPage()

    const name = `Decisión doble ${runId()}`
    const { page: guest } = await guestPage()
    await askAccess(guest, name)
    for (const page of [first, second]) await expect.poll(() => requestCard(page, name).isVisible(), { timeout: 10_000 }).toBe(true)

    // La segunda abre la confirmación de "Rechazar" antes de que la primera dé acceso.
    await requestCard(second, name).getByRole('button', { name: 'Rechazar' }).click()
    const dialog = second.getByRole('dialog', { name: `¿Rechazar la solicitud de ${name}?` })
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await requestCard(first, name).getByRole('button', { name: 'Dar acceso' }).click()
    await expect.poll(() => first.getByText(`Diste acceso a ${name}`).isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Rechazar' }).click()
    await expect.poll(() => second.getByText('E2E access-editor ya dio acceso a esta persona').isVisible()).toBe(true)
    await guest.close()
    await second.close()
    await first.close()
  })

  it('cuatro solicitudes nuevas del mismo navegador en 30 min: la cuarta se frena, otro navegador de la misma red sí puede', async () => {
    // El limitador es de ventana fija: si faltan menos de 90 s para la siguiente, se espera a que empiece.
    const windowMs = ACCESS_REQUEST_LIMIT.windowSec * 1000
    const left = windowMs - (Date.now() % windowMs)
    if (left < 90_000) await new Promise(resolve => setTimeout(resolve, left + 1000))

    const editor = await editorPage()
    const { page: guest, ip } = await guestPage()
    for (let i = 1; i <= ACCESS_REQUEST_LIMIT.limit; i++) {
      const name = `Insistente ${i} ${runId()}`
      await askAccess(guest, name)
      await expect.poll(() => guest.getByText(waitingText).first().isVisible()).toBe(true)
      await decide(editor, name, 'reject')
      await expect.poll(() => shows(guest, 'El equipo no aceptó tu solicitud'), { timeout: POLL_WAIT }).toBe(true)
      await guest.getByRole('button', { name: 'Pedir acceso de nuevo' }).click()
    }
    await askAccess(guest, `Insistente 4 ${runId()}`)
    await expect.poll(() => guest.getByRole('alert').first().innerText()).toMatch(/^Ya pediste acceso varias veces\. Intenta de nuevo en \d+ min$/)

    const { page: neighbour } = await guestPage(ip)
    await askAccess(neighbour, `Vecina ${runId()}`)
    await expect.poll(() => neighbour.getByText(waitingText).first().isVisible()).toBe(true)
    await neighbour.close()
    await guest.close()
    await editor.close()
  })

  it('la actividad muestra quién dio acceso y quién rechazó', async () => {
    const editor = await editorPage()
    const granted = `Con acceso ${runId()}`
    const denied = `Sin acceso ${runId()}`
    for (const [name, verb] of [[granted, 'approve'], [denied, 'reject']] as const) {
      const { page } = await guestPage()
      await askAccess(page, name)
      await expect.poll(() => page.getByText(waitingText).first().isVisible()).toBe(true)
      await decide(editor, name, verb)
      await page.close()
    }
    await editor.close()

    const admin = await createPage(undefined, { viewport: viewports.desktop })
    await signedInAs(admin, 'admin', 'access-admin')
    await admin.goto(`${E2E_URL}/actividad`)
    await waitForHydration(admin)
    await expect.poll(() => admin.getByText(granted).first().isVisible()).toBe(true)
    const row = (target: string) => admin.getByRole('listitem').filter({ hasText: target })
    await expect.poll(() => row(granted).first().innerText()).toContain('dio acceso a')
    await expect.poll(() => row(denied).first().innerText()).toContain('rechazó la solicitud de')
    await admin.close()
  })
})
