// Calendario de días de trabajo (`/calendario`): un administrador agenda un día especial con dos rangos, miembros y
// material en la página /calendario/nuevo, lo edita en /calendario/<id>/editar, cambia su estado y lo borra; el editor ve
// el calendario y el detalle pero no agenda (las páginas del formulario lo llevan a «Acceso denegado» y la API le
// responde 403) y solo cambia el estado de los días en los que está asignado (lista y detalle; en los demás, 403); sin sesión redirige a login; el calendario ocupa todo el ancho y el 80 % del alto, y se alterna con la
// lista; a 360 px no hay scroll horizontal y los controles miden al menos 44 px; los eventos normal y especial se
// distinguen en ambos temas; y el material cuya colección se borra deja de aparecer.
// Todos los datos llevan el `runId` y viven en la rama de pruebas.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { E2E_URL, email, profileUserId, runId, seedFolder, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const sql = testSql()
const ADMIN = 'calendar-admin'
const EDITOR = 'calendar-editor'

/** Fecha `AAAA-MM-DD` a `days` días de hoy en la zona de la iglesia (la misma que usa la lista «Próximos días»). */
async function dateIn(days: number): Promise<string> {
  const [row] = await sql`SELECT to_char((now() AT TIME ZONE 'America/Monterrey')::date + ${days}::int, 'YYYY-MM-DD') AS date`
  return row!.date as string
}

async function pageAs(role: 'editor' | 'admin', label: string, viewport: { width: number, height: number } = viewports.desktop): Promise<Page> {
  const page = await createPage(undefined, { viewport })
  await signedInAs(page, role, label)
  return page
}

async function openCalendar(page: Page) {
  await page.goto(`${E2E_URL}/calendario`)
  await waitForHydration(page)
  // El calendario llega después de hidratar, en su propio trozo.
  await page.locator('.cloudy-calendar').waitFor()
}

/** Siembra un día con un rango, directo en la base (para las pruebas que no pasan por el formulario). */
async function seedWorkDay(owner: string, { title, date, kind = 'normal' as 'normal' | 'special', start = '09:00', end = '11:00' }: { title: string, date: string, kind?: 'normal' | 'special', start?: string, end?: string }): Promise<string> {
  const [row] = await sql`INSERT INTO work_days (title, work_date, kind, created_by) VALUES (${title}, ${date}, ${kind}::work_day_kind, ${owner}) RETURNING id`
  const id = row!.id as string
  await sql`INSERT INTO work_day_slots (work_day_id, start_time, end_time) VALUES (${id}, ${start}, ${end})`
  return id
}

/** Asigna una cuenta como miembro de un día sembrado. */
async function seedMember(dayId: string, userId: string) {
  await sql`INSERT INTO work_day_members (work_day_id, user_id) VALUES (${dayId}, ${userId})`
}

/** La lista «Próximos días» es la otra vista de la página (`?vista=lista`). */
async function openList(page: Page) {
  await page.goto(`${E2E_URL}/calendario?vista=lista`)
  await waitForHydration(page)
}

const upcoming = (page: Page) => page.getByRole('list', { name: 'Próximos días' })
const main = (page: Page) => page.getByRole('main')
const toast = (page: Page, text: string) => page.getByText(text, { exact: true })
const dialog = (page: Page) => page.getByRole('dialog')

describe('calendario · administrador', () => {
  const title = `Conferencia ${runId()}`
  const edited = `Conferencia de jóvenes ${runId()}`
  const collection = `Colección calendario ${runId()}`

  it('agenda un día especial con 2 rangos, miembros y material', async () => {
    const page = await pageAs('admin', ADMIN)
    const owner = await profileUserId(email(ADMIN))
    await sql`INSERT INTO song_collections (name, created_by) VALUES (${collection}, ${owner})`
    await seedFolder(`Carpeta calendario ${runId()}`, owner)
    const date = await dateIn(3)

    await openCalendar(page)
    await page.getByRole('link', { name: 'Agendar día' }).click()
    await page.waitForURL(url => url.pathname === '/calendario/nuevo')
    const form = main(page)
    await expect.poll(() => form.getByRole('heading', { name: 'Agendar día', level: 1 }).isVisible()).toBe(true)
    await form.getByLabel('Título del evento').fill(title)

    // Con cambios sin guardar, salir pregunta; al quedarse, lo escrito sigue ahí.
    await form.getByRole('link', { name: 'Volver al calendario' }).click()
    await expect.poll(() => page.getByRole('heading', { name: '¿Salir sin guardar?' }).isVisible()).toBe(true)
    await dialog(page).getByRole('button', { name: 'Cancelar' }).click()
    expect(new URL(page.url()).pathname).toBe('/calendario/nuevo')
    expect(await form.getByLabel('Título del evento').inputValue()).toBe(title)

    await form.getByLabel('Fecha').fill(date)
    // El tipo no viene elegido: sin él no se puede guardar.
    expect(await form.getByRole('radio', { name: 'Normal' }).isChecked()).toBe(false)
    expect(await form.getByRole('radio', { name: 'Especial' }).isChecked()).toBe(false)
    expect(await form.getByLabel('Auditorio').inputValue()).toBe('Skykids Auditorium')
    await form.getByRole('button', { name: 'Agendar día' }).click()
    await expect.poll(() => form.getByText('Elige si es un día normal o especial').isVisible()).toBe(true)
    await form.getByRole('radio', { name: 'Especial' }).check()

    await form.getByLabel('Inicio del rango 1').fill('09:00')
    await form.getByLabel('Fin del rango 1').fill('12:00')
    await form.getByRole('button', { name: 'Agregar rango' }).click()
    await form.getByLabel('Inicio del rango 2').fill('11:00')
    await form.getByLabel('Fin del rango 2').fill('20:00')
    await expect.poll(() => form.getByText('Este rango se cruza con otro').count()).toBe(2)
    await form.getByLabel('Inicio del rango 2').fill('18:00')
    await expect.poll(() => form.getByText('Este rango se cruza con otro').count()).toBe(0)

    await form.getByRole('checkbox', { name: `E2E ${ADMIN}` }).check()
    await form.getByRole('tab', { name: 'Canciones' }).click()
    await form.getByRole('checkbox', { name: collection }).check()
    await form.getByRole('tab', { name: 'Carpetas' }).click()
    await form.getByRole('checkbox', { name: `Carpeta calendario ${runId()}` }).check()
    await form.getByRole('button', { name: 'Agendar día' }).click()

    await expect.poll(() => toast(page, `Se agendó «${title}»`).isVisible()).toBe(true)
    // Vuelve al calendario, en el mes del día agendado.
    await page.waitForURL(url => url.pathname === '/calendario' && url.searchParams.get('fecha') === date)
    await page.getByRole('button', { name: 'Lista', exact: true }).click()
    await page.waitForURL(url => url.searchParams.get('vista') === 'lista')
    await expect.poll(() => upcoming(page).innerText()).toContain(title)
    expect(await upcoming(page).innerText()).toContain('09:00–12:00 · 18:00–20:00')
    const [row] = await sql`
      SELECT d.kind, d.status, d.auditorium,
        (SELECT count(*)::int FROM work_day_slots s WHERE s.work_day_id = d.id) AS slots,
        (SELECT count(*)::int FROM work_day_members m WHERE m.work_day_id = d.id) AS members,
        (SELECT count(*)::int FROM work_day_materials x WHERE x.work_day_id = d.id) AS materials
      FROM work_days d WHERE d.title = ${title}`
    expect(row).toEqual({ kind: 'special', status: 'not_started', auditorium: 'Skykids Auditorium', slots: 2, members: 1, materials: 2 })
    await page.close()
  })

  it('lo edita desde el detalle y cambia su estado con un toque', async () => {
    const page = await pageAs('admin', ADMIN)
    await openList(page)
    await upcoming(page).getByRole('button', { name: new RegExp(`^Ver ${title}`) }).click()
    await expect.poll(() => dialog(page).getByText('Colección de canciones').isVisible()).toBe(true)
    await dialog(page).getByRole('button', { name: 'Editar' }).click()
    await page.waitForURL(url => /^\/calendario\/[^/]+\/editar$/.test(url.pathname))
    const form = main(page)
    await expect.poll(() => form.getByRole('heading', { name: 'Editar día', level: 1 }).isVisible()).toBe(true)
    await form.getByLabel('Título del evento').fill(edited)
    await form.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect.poll(() => toast(page, `Se guardaron los cambios de «${edited}»`).isVisible()).toBe(true)
    await page.waitForURL(url => url.pathname === '/calendario')
    await openList(page)

    await upcoming(page).getByRole('button', { name: new RegExp(`^Iniciar ${edited}`) }).click()
    await expect.poll(() => toast(page, `«${edited}» ahora está: En proceso`).isVisible()).toBe(true)
    const [row] = await sql`SELECT status FROM work_days WHERE title = ${edited}`
    expect(row!.status).toBe('in_progress')
    await page.close()
  })

  it('el material cuya colección se borra ya no aparece en el detalle', async () => {
    const page = await pageAs('admin', ADMIN)
    // La cascada de la base quita el adjunto: el día sigue, con un adjunto menos.
    await page.request.delete(`${E2E_URL}/api/songs/collections/${(await sql`SELECT id FROM song_collections WHERE name = ${collection}`)[0]!.id}`)
    await openList(page)
    await upcoming(page).getByRole('button', { name: new RegExp(`^Ver ${edited}`) }).click()
    await expect.poll(() => dialog(page).getByText(`Carpeta calendario ${runId()}`).isVisible()).toBe(true)
    expect(await dialog(page).getByText(collection).count()).toBe(0)
    await page.close()
  })

  it('editar un día que ya no existe lo dice y ofrece volver', async () => {
    const page = await pageAs('admin', ADMIN)
    await page.goto(`${E2E_URL}/calendario/00000000-0000-0000-0000-000000000000/editar`)
    await expect.poll(() => page.getByText('Ese día ya no está en el calendario.').isVisible()).toBe(true)
    await page.getByRole('link', { name: 'Volver al calendario' }).click()
    await page.waitForURL(url => url.pathname === '/calendario')
    await page.close()
  })

  it('lo borra con confirmación', async () => {
    const page = await pageAs('admin', ADMIN)
    await openList(page)
    await upcoming(page).getByRole('button', { name: new RegExp(`^Ver ${edited}`) }).click()
    await dialog(page).getByRole('button', { name: 'Eliminar' }).click()
    await page.getByRole('button', { name: 'Eliminar día' }).click()
    await expect.poll(() => toast(page, `Se eliminó «${edited}» del calendario`).isVisible()).toBe(true)
    expect(await sql`SELECT id FROM work_days WHERE title = ${edited}`).toHaveLength(0)
    // Los rangos, miembros y adjuntos se fueron con él.
    expect((await sql`SELECT count(*)::int AS count FROM work_day_slots s LEFT JOIN work_days d ON d.id = s.work_day_id WHERE d.id IS NULL`)[0]!.count).toBe(0)
    await page.close()
  })
})

describe('calendario · editor y accesos', () => {
  it('el editor ve el calendario y el detalle, pero no «Agendar día», y la API le responde 403', async () => {
    const admin = await pageAs('admin', ADMIN)
    const owner = await profileUserId(email(ADMIN))
    const title = `Servicio ${runId()}`
    const id = await seedWorkDay(owner, { title, date: await dateIn(1) })
    await admin.close()

    const page = await pageAs('editor', EDITOR)
    await openCalendar(page)
    expect(await page.getByRole('link', { name: 'Agendar día' }).count()).toBe(0)
    await page.getByRole('button', { name: 'Lista', exact: true }).click()
    await page.waitForURL(url => url.searchParams.get('vista') === 'lista')
    // Recargar conserva la vista elegida.
    await page.reload()
    await waitForHydration(page)
    expect(await page.getByRole('button', { name: 'Lista', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await upcoming(page).getByRole('button', { name: new RegExp(`^Ver ${title}`) }).click()
    await expect.poll(() => dialog(page).getByRole('heading', { name: title }).isVisible()).toBe(true)
    expect(await dialog(page).getByRole('button', { name: 'Editar' }).count()).toBe(0)
    expect(await dialog(page).getByRole('button', { name: 'Eliminar' }).count()).toBe(0)
    // No está asignado a este día: no hay control de estado y se le explica por qué.
    expect(await dialog(page).getByLabel('Estado').count()).toBe(0)
    expect(await dialog(page).getByText('Solo quienes están asignados a este día pueden cambiar su estado.').isVisible()).toBe(true)
    expect(await upcoming(page).getByRole('button', { name: new RegExp(`^Iniciar ${title}`) }).count()).toBe(0)

    const body = { title: 'No debería', date: await dateIn(2), kind: 'normal', auditorium: 'A', slots: [{ start: '09:00', end: '10:00' }] }
    expect((await page.request.post(`${E2E_URL}/api/calendario`, { data: body })).status()).toBe(403)
    expect((await page.request.patch(`${E2E_URL}/api/calendario/${id}`, { data: body })).status()).toBe(403)
    const status = await page.request.patch(`${E2E_URL}/api/calendario/${id}/estado`, { data: { status: 'finished' } })
    expect(status.status()).toBe(403)
    expect((await status.json()).data).toEqual({ code: 'not_assigned' })
    expect((await sql`SELECT status FROM work_days WHERE id = ${id}`)[0]!.status).toBe('not_started')
    expect((await page.request.delete(`${E2E_URL}/api/calendario/${id}`)).status()).toBe(403)
    expect((await page.request.get(`${E2E_URL}/api/calendario/miembros`)).status()).toBe(403)
    expect((await page.request.get(`${E2E_URL}/api/calendario/${id}`)).status()).toBe(200)

    // Las páginas del formulario son solo de administradores.
    for (const path of ['/calendario/nuevo', `/calendario/${id}/editar`]) {
      await page.goto(`${E2E_URL}${path}`)
      await page.waitForURL(url => url.pathname === '/acceso-denegado')
    }
    await page.close()
  })

  it('el editor asignado a un día cambia su estado desde la lista y desde el detalle, pero no lo edita ni lo borra', async () => {
    const admin = await pageAs('admin', ADMIN)
    const owner = await profileUserId(email(ADMIN))
    await admin.close()
    const page = await pageAs('editor', EDITOR)
    const me = await profileUserId(email(EDITOR))
    const title = `Asignado ${runId()}`
    const id = await seedWorkDay(owner, { title, date: await dateIn(1), start: '12:00', end: '13:00' })
    await seedMember(id, me)

    // Un toque en la lista: Sin iniciar → En proceso.
    await openList(page)
    await upcoming(page).getByRole('button', { name: new RegExp(`^Iniciar ${title}`) }).click()
    await expect.poll(() => toast(page, `«${title}» ahora está: En proceso`).isVisible()).toBe(true)
    await expect.poll(async () => (await sql`SELECT status FROM work_days WHERE id = ${id}`)[0]!.status).toBe('in_progress')
    await expect.poll(() => upcoming(page).getByRole('button', { name: new RegExp(`^Finalizar ${title}`) }).count()).toBe(1)

    // Desde el detalle: el select «Estado», sin «Editar» ni «Eliminar».
    await upcoming(page).getByRole('button', { name: new RegExp(`^Ver ${title}`) }).click()
    await expect.poll(() => dialog(page).getByRole('heading', { name: title }).isVisible()).toBe(true)
    expect(await dialog(page).getByRole('button', { name: 'Editar' }).count()).toBe(0)
    expect(await dialog(page).getByRole('button', { name: 'Eliminar' }).count()).toBe(0)
    expect(await dialog(page).getByText('Solo quienes están asignados a este día pueden cambiar su estado.').count()).toBe(0)
    await dialog(page).getByLabel('Estado').selectOption('finished')
    await expect.poll(() => page.getByText(`«${title}» ahora está: Finalizado`, { exact: true }).count()).toBeGreaterThan(0)
    await expect.poll(async () => (await sql`SELECT status FROM work_days WHERE id = ${id}`)[0]!.status).toBe('finished')
    await expect.poll(() => dialog(page).getByLabel('Estado').inputValue()).toBe('finished')

    // Sigue sin poder editarlo ni borrarlo.
    const body = { title: 'No debería', date: await dateIn(2), kind: 'normal', auditorium: 'A', slots: [{ start: '09:00', end: '10:00' }] }
    expect((await page.request.patch(`${E2E_URL}/api/calendario/${id}`, { data: body })).status()).toBe(403)
    expect((await page.request.delete(`${E2E_URL}/api/calendario/${id}`)).status()).toBe(403)
    // Un día que ya no existe: 404, no 403.
    expect((await page.request.patch(`${E2E_URL}/api/calendario/00000000-0000-4000-8000-000000000000/estado`, { data: { status: 'finished' } })).status()).toBe(404)
    await page.close()
  })

  it('sin sesión, /calendario lleva a login', async () => {
    const page = await createPage()
    await page.goto(`${E2E_URL}/calendario`)
    await page.waitForURL(url => url.pathname === '/login')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/calendario')
    await page.close()
  })
})

describe('calendario · layout', () => {
  it('en escritorio el calendario ocupa todo el ancho del contenido y el 80 % del alto bajo la barra', async () => {
    const page = await pageAs('admin', ADMIN, { width: 1440, height: 900 })
    await openCalendar(page)
    const box = await page.evaluate(() => {
      const calendar = document.querySelector<HTMLElement>('.cloudy-calendar')!.closest('section')!.getBoundingClientRect()
      const content = document.querySelector<HTMLElement>('main')!
      const style = getComputedStyle(content)
      const inner = content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      return { height: calendar.height, width: calendar.width, inner, viewport: window.innerHeight, maxWidth: style.maxWidth }
    })
    expect(box.maxWidth).toBe('none')
    expect(Math.abs(box.width - box.inner)).toBeLessThanOrEqual(1)
    // 80 % de (alto − 4 rem de la barra superior).
    expect(Math.abs(box.height - (box.viewport - 64) * 0.8)).toBeLessThanOrEqual(2)
    // Los controles quedan arriba y nada obliga a desplazar la página.
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0)
    await page.close()
  })

  it('en una pantalla corta el calendario conserva 28 rem y la página se desplaza', async () => {
    const page = await pageAs('admin', ADMIN, { width: 1280, height: 420 })
    await openCalendar(page)
    const height = await page.evaluate(() => document.querySelector<HTMLElement>('.cloudy-calendar')!.closest('section')!.getBoundingClientRect().height)
    expect(Math.abs(height - 448)).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true)
    await page.close()
  })
})

describe('calendario · móvil y temas', () => {
  it('a 360 px no hay scroll horizontal, abre en vista de día y los controles miden al menos 44 px', async () => {
    const page = await pageAs('admin', ADMIN, viewports.phone)
    await openCalendar(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    expect(await page.getByRole('button', { name: 'Día', exact: true }).getAttribute('aria-pressed')).toBe('true')
    const short = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a')]
      .filter(el => !el.closest('.wx-calendar') && el.offsetParent !== null)
      .map(el => ({ name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '', height: Math.round(el.getBoundingClientRect().height) }))
      .filter(el => el.height < 44))
    expect(short).toEqual([])

    // El formulario, como página, tampoco se desborda ni tiene controles pequeños.
    await page.goto(`${E2E_URL}/calendario/nuevo`)
    await waitForHydration(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    const shortInForm = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a, main input:not([type="checkbox"]):not([type="radio"]), main select')]
      .filter(el => el.offsetParent !== null)
      .map(el => ({ name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.id, height: Math.round(el.getBoundingClientRect().height) }))
      .filter(el => el.height < 44))
    expect(shortInForm).toEqual([])
    await page.close()
  })

  it.each(['cloudy', 'cloudy-light'] as const)('en el tema %s, normal y especial se distinguen y el texto del evento cumple AA', async (theme) => {
    const page = await pageAs('admin', ADMIN)
    const owner = await profileUserId(email(ADMIN))
    const date = await dateIn(0)
    await seedWorkDay(owner, { title: `Normal ${theme} ${runId()}`, date, kind: 'normal', start: '08:00', end: '09:00' })
    await seedWorkDay(owner, { title: `Especial ${theme} ${runId()}`, date, kind: 'special', start: '10:00', end: '11:00' })
    await page.context().addCookies([{ name: 'cloudy-theme', value: theme, url: E2E_URL }])
    await openCalendar(page)
    expect(await page.locator('html').getAttribute('data-theme')).toBe(theme)
    await page.locator('.cloudy-ev--special').first().waitFor()

    const colors = await page.evaluate(() => {
      // Convierte cualquier color CSS a sRGB pintándolo en un lienzo.
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const rgb = (color: string) => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
      }
      const luminance = (c: number[]) => c.map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0)
      const ratio = (a: number[], b: number[]) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
        return (hi + 0.05) / (lo + 0.05)
      }
      const read = (selector: string) => {
        const el = document.querySelector<HTMLElement>(selector)!
        const style = getComputedStyle(el)
        const background = rgb(style.backgroundColor)
        return { background, stripe: rgb(style.borderLeftColor), contrast: ratio(rgb(style.color), background) }
      }
      const normal = read('.cloudy-ev--normal')
      const special = read('.cloudy-ev--special')
      return { normal, special, apart: ratio(normal.stripe, special.stripe) }
    })
    expect(colors.normal.contrast).toBeGreaterThanOrEqual(4.5)
    expect(colors.special.contrast).toBeGreaterThanOrEqual(4.5)
    expect(colors.normal.stripe).not.toEqual(colors.special.stripe)
    expect(colors.normal.background).not.toEqual(colors.special.background)
    // Y no solo por color: el evento especial lo dice con texto en su nombre accesible.
    expect(await page.locator('.cloudy-ev--special button').first().getAttribute('aria-label')).toContain('Día especial')
    expect(await page.locator('.cloudy-ev--normal button').first().getAttribute('aria-label')).toContain('Día normal')
    await page.close()
  })
})
