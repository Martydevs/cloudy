// US5 / US9 — Dashboard responsivo y tema oscuro/claro sin parpadeo. T151: recorrido de todas las
// rutas a 360 px y 1280 px en `cloudy` y `cloudy-light`, sin scroll horizontal, con objetivos
// táctiles ≥ 44 px en teléfono, foco visible al tabular y sin errores de consola.
import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { BrowserContext, Locator, Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { ALLOWED_TYPES, getExtension } from '../../shared/constants/files'
import { E2E_URL, email, ensureAccount, login, runId, setProfile, signedInAs, testSql, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

describe('US5 · dashboard responsivo', () => {
  it('a 360 px no hay scroll horizontal y el menú se abre y se cierra', async () => {
    const page = await createPage(undefined, { viewport: viewports.phone })
    await signedInAs(page, 'editor', 'shell-phone')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    const sidebar = page.getByRole('navigation', { name: 'Secciones' })
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => sidebar.isVisible()).toBe(true)
    expect(await page.getByRole('link', { name: 'Usuarios' }).count()).toBe(0)

    // Teclado (T162, defecto 5): al abrirse, el foco va al primer enlace del panel, cuando ya es visible
    // (daisyUI anima `visibility`; happy-dom no lo reproduce, por eso se comprueba aquí). Esc lo devuelve.
    const focused = () => page.evaluate(() => {
      const el = document.activeElement
      return el instanceof HTMLElement ? `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.textContent?.trim()}` : 'none'
    })
    await expect.poll(focused).toBe('a Inicio')
    expect(await page.evaluate(() => document.querySelector('.drawer-content')?.hasAttribute('inert'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => sidebar.isVisible()).toBe(false)
    await expect.poll(focused).toBe('button Abrir menú')
    expect(await page.evaluate(() => document.querySelector('.drawer-content')?.hasAttribute('inert'))).toBe(false)
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => sidebar.isVisible()).toBe(true)

    // Elegir una sección cierra el panel.
    await sidebar.getByRole('link', { name: 'Archivos' }).click()
    await page.waitForURL(url => url.pathname === '/archivos')
    await expect.poll(() => sidebar.isVisible()).toBe(false)

    // Esc lo cierra.
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => sidebar.isVisible()).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => sidebar.isVisible()).toBe(false)

    // Tocar fuera (el overlay) también.
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => sidebar.isVisible()).toBe(true)
    // Se toca el overlay a la derecha del panel; Playwright espera a que termine la animación.
    await page.getByRole('button', { name: 'Cerrar menú' }).click({ position: { x: 340, y: 400 } })
    await expect.poll(() => sidebar.isVisible()).toBe(false)

    // Con `prefers-reduced-motion: reduce` no hay transición y el enlace tarda unos cuadros más en ser
    // enfocable que el panel: el foco debe quedar igualmente en el primer enlace.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => sidebar.isVisible()).toBe(true)
    await expect.poll(focused).toBe('a Inicio')
    await page.keyboard.press('Escape')
    await expect.poll(focused).toBe('button Abrir menú')
    await page.emulateMedia({ reducedMotion: null })
    await page.close()
  })

  it('en escritorio la barra contraída se mantiene tras recargar', async () => {
    const page = await createPage(undefined, { viewport: viewports.desktop })
    await signedInAs(page, 'editor', 'shell-desktop')
    await page.getByRole('button', { name: 'Contraer barra lateral' }).click()
    await expect.poll(() => page.getByRole('button', { name: 'Expandir barra lateral' }).isVisible()).toBe(true)
    await page.reload()
    await expect.poll(() => page.getByRole('button', { name: 'Expandir barra lateral' }).isVisible()).toBe(true)
    await page.close()
  })
})

// Regresiones de la prueba humana del MVP (T110a–T110d).
describe('US5 · bugs visuales del shell', () => {
  const metrics = (page: Awaited<ReturnType<typeof createPage>>) => page.evaluate(() => {
    const side = document.querySelector('.drawer-side')!
    const aside = side.querySelector('aside')!
    const button = document.querySelector<HTMLElement>('button[aria-label="Menú de usuario"]')!
    const avatar = button.querySelector('span')!
    return {
      sideOverflow: side.scrollHeight - side.clientHeight,
      asideHeight: Math.round(aside.getBoundingClientRect().height),
      viewport: window.innerHeight,
      button: button.getBoundingClientRect(),
      avatar: avatar.getBoundingClientRect(),
    }
  })

  const filtersOverflow = (page: Awaited<ReturnType<typeof createPage>>) => page.evaluate(() => {
    const box = document.querySelector('[aria-label="Filtrar por tipo"]')!.parentElement!
    return box.scrollHeight - box.clientHeight
  })

  it('en escritorio la barra lateral no se desplaza, la fila de cuenta mide ≥ 44 px y los filtros no muestran barras', async () => {
    const page = await createPage(undefined, { viewport: viewports.desktop })
    await signedInAs(page, 'editor', 'shell-bugs-desktop')

    // Expandida: la cuenta es una fila (avatar + nombre/correo) al pie, con alto táctil.
    const m = await metrics(page)
    expect(m.sideOverflow).toBeLessThanOrEqual(0)
    expect(m.asideHeight).toBe(m.viewport)
    expect(m.button.height).toBeGreaterThanOrEqual(44)

    // Contraída tampoco se desplaza y el avatar llena su botón (el hover no deja un aro).
    await page.getByRole('button', { name: 'Contraer barra lateral' }).click()
    const c = await metrics(page)
    expect(c.sideOverflow).toBeLessThanOrEqual(0)
    expect(c.asideHeight).toBe(c.viewport)
    expect(Math.round(c.avatar.width)).toBe(Math.round(c.button.width))
    expect(Math.round(c.avatar.height)).toBe(Math.round(c.button.height))

    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Imágenes' }).click()
    await expect.poll(() => filtersOverflow(page)).toBeLessThanOrEqual(0)
    await page.close()
  })

  it('a 360 px el panel abierto no se desplaza y los filtros no muestran barras', async () => {
    const page = await createPage(undefined, { viewport: viewports.phone })
    await signedInAs(page, 'editor', 'shell-bugs-phone')
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect.poll(() => page.getByRole('navigation', { name: 'Secciones' }).isVisible()).toBe(true)

    // El cajón siempre va expandido: la fila de cuenta queda al pie del panel.
    const m = await metrics(page)
    expect(m.sideOverflow).toBeLessThanOrEqual(0)
    expect(m.asideHeight).toBe(m.viewport)
    expect(m.button.height).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Escape')

    await page.goto(`${E2E_URL}/archivos`)
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Imágenes' }).click()
    await expect.poll(() => filtersOverflow(page)).toBeLessThanOrEqual(0)
    await page.close()
  })
})

describe('US9 · tema', () => {
  it('la primera visita es oscura aunque el sistema prefiera claro', async () => {
    const page = await createPage(undefined, { colorScheme: 'light' })
    const res = await page.goto(`${E2E_URL}/login`)
    expect(await res?.text()).toMatch(/<html[^>]*data-theme="cloudy"/)
    expect(await page.locator('html').getAttribute('data-theme')).toBe('cloudy')
    await page.close()
  })

  it('el cambio a claro persiste y llega en el HTML del servidor', async () => {
    const page = await createPage('/login')
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Cambiar a tema claro' }).click()
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('cloudy-light')

    const res = await page.reload()
    expect(await res?.text()).toMatch(/<html[^>]*data-theme="cloudy-light"/)
    await expect.poll(() => page.getByRole('button', { name: 'Cambiar a tema oscuro' }).isVisible()).toBe(true)
    await page.close()
  })
})

// ---------------------------------------------------------------- T151 · recorrido de rutas
// Matriz de contracts/ui-routes.md; cada página declara su `access` en `definePageMeta`.
// Los parámetros se sustituyen por una carpeta y un archivo sembrados en esta corrida.
const PRIVATE_ROUTES = ['/', '/archivos', '/archivos/:folderId', '/archivos/ver/:fileId', '/solicitudes', '/papelera', '/usuarios', '/actividad', '/perfil']
const PUBLIC_ROUTES = ['/login', '/registro', '/recuperar', '/restablecer', '/enviar', '/upload', '/acceso-denegado']
const PENDING_ROUTES = ['/pendiente']

type Theme = 'cloudy' | 'cloudy-light'
const THEMES: Theme[] = ['cloudy', 'cloudy-light']
type Viewport = keyof typeof viewports
const VIEWPORTS: Viewport[] = ['phone', 'desktop']

// Lo que se toca con el dedo. El `<input type="file">` de DropZone es `sr-only` y se opera con su
// botón, por eso no cuenta; un `input` dentro de un `<label>` (campo daisyUI, checkbox, radio) se
// mide por la etiqueta, que es lo que recibe el toque (un checkbox de daisyUI mide 24 px adrede).
const TARGET_SELECTOR = 'button, a.btn, input:not([type=hidden]):not([type=file])'

const sql = testSql()
const ADMIN = 'sweep-admin'
const PENDING = 'sweep-pending'

type CookieInit = Parameters<BrowserContext['addCookies']>[0][number]
const sessions = new Map<string, readonly CookieInit[]>()

/** Una sesión por persona en todo el archivo: Neon Auth limita los inicios de sesión (429). */
async function pageAs(role: 'admin' | 'editor', label: string, viewport: Viewport): Promise<Page> {
  const page = await createPage(undefined, { viewport: viewports[viewport] })
  const cookies = sessions.get(label)
  if (cookies) await page.context().addCookies(cookies)
  else {
    await signedInAs(page, role, label)
    sessions.set(label, await page.context().cookies())
  }
  return page
}

/** Cuenta pendiente de aprobación: un solo inicio de sesión por la UI (termina en /pendiente) y se reutiliza. */
async function pendingPage(viewport: Viewport): Promise<Page> {
  const page = await createPage(undefined, { viewport: viewports[viewport] })
  const cookies = sessions.get(PENDING)
  if (cookies) await page.context().addCookies(cookies)
  else {
    const creds = { name: `E2E ${PENDING}`, email: email(PENDING) }
    await ensureAccount(creds)
    await setProfile(creds.email, { status: 'pending', role: null })
    await login(page, creds)
    sessions.set(PENDING, await page.context().cookies())
  }
  return page
}

async function userId(label: string): Promise<string> {
  const [row] = await sql`SELECT user_id FROM profiles WHERE email = ${email(label)}`
  return row!.user_id as string
}

async function seedFolder(name: string, owner: string): Promise<string> {
  const [row] = await sql`INSERT INTO folders (name, created_by) VALUES (${name}, ${owner}) RETURNING id`
  return row!.id as string
}

/** Fila `ready` sin bytes en el bucket: la ruta del visor se recorre sin pedir contenido. */
async function seedFile(name: string, owner: string, folderId: string): Promise<string> {
  const id = randomUUID()
  const ext = getExtension(name)
  const type = ALLOWED_TYPES[ext]!
  await sql`
    INSERT INTO files (id, folder_id, name, extension, mime_type, category, size_bytes, storage_key, upload_status, origin, uploaded_by)
    VALUES (${id}, ${folderId}, ${name}, ${ext}, ${type.mimes[0]}, ${type.category}, 1000, ${`e2e/${runId()}/files/${id}`}, 'ready', 'team', ${owner})
  `
  return id
}

/** Errores de consola y excepciones no capturadas; se vacía antes de cada ruta. */
function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', error => errors.push(error.message))
  return errors
}

interface OpenPage { page: Page, errors: string[] }

/**
 * Una página por tamaño de pantalla, abierta la primera vez que una prueba la pide: `createPage`
 * necesita el contexto de @nuxt/test-utils, que solo existe dentro de cada prueba (lo fija su
 * `beforeEach` y lo quita su `afterEach`), no en un `beforeAll` anidado.
 */
function pagePool(create: (viewport: Viewport) => Promise<Page>) {
  const open = new Map<Viewport, OpenPage>()
  return {
    async get(viewport: Viewport): Promise<OpenPage> {
      let entry = open.get(viewport)
      if (!entry) {
        const page = await create(viewport)
        entry = { page, errors: trackErrors(page) }
        open.set(viewport, entry)
      }
      return entry
    },
    async closeAll() {
      for (const { page } of open.values()) await page.close()
      open.clear()
    },
  }
}

async function audit(page: Page, errors: string[], path: string, theme: Theme, viewport: Viewport) {
  const label = `${path} · ${theme} · ${viewport}`
  errors.length = 0
  await page.context().addCookies([{ name: 'cloudy-theme', value: theme, url: E2E_URL }])
  await page.goto(`${E2E_URL}${path}`)
  await waitForHydration(page)
  expect(new URL(page.url()).pathname, `${label}: redirigió`).toBe(path)
  expect(await page.locator('html').getAttribute('data-theme'), label).toBe(theme)
  // Se mide el estado con contenido, no el skeleton.
  await expect.poll(() => page.locator('[aria-busy="true"]').count(), { message: label }).toBe(0)

  const layout = await page.evaluate((selector) => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }
    const name = (el: Element) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? ''
    const short: string[] = []
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue
      const target = el instanceof HTMLInputElement ? el.closest('label') ?? el : el
      const height = target.getBoundingClientRect().height
      if (height < 44) short.push(`<${el.tagName.toLowerCase()}> «${name(el)}» ${Math.round(height)} px`)
    }
    const root = document.documentElement
    const main = document.querySelector('main')
    return {
      overflow: Math.max(root.scrollWidth - root.clientWidth, main ? main.scrollWidth - main.clientWidth : 0),
      short,
    }
  }, TARGET_SELECTOR)
  expect(layout.overflow, `${label}: scroll horizontal`).toBeLessThanOrEqual(0)
  if (viewport === 'phone') expect(layout.short, `${label}: objetivos de menos de 44 px`).toEqual([])

  await page.keyboard.press('Tab')
  const focus = await page.evaluate(() => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement) || el === document.body) return null
    return { tag: el.tagName.toLowerCase(), outline: getComputedStyle(el).outlineStyle, width: el.getBoundingClientRect().width }
  })
  expect(focus, `${label}: nada recibe el foco al tabular`).not.toBeNull()
  expect(focus!.outline, `${label}: el foco en <${focus!.tag}> no se ve`).not.toBe('none')
  expect(focus!.width, `${label}: el elemento enfocado no mide nada`).toBeGreaterThan(0)

  expect(errors, `${label}: errores de consola`).toEqual([])
}

interface Box { x: number, y: number, width: number, height: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Espera a que termine la animación de entrada del aviso (daisyUI lo escala desde 0,9): medir en plena
 * animación daría una caja más pequeña que la final y un «no se solapan» engañoso.
 */
const settled = (toast: Locator) => toast.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)).then(() => undefined))

describe('US9 · recorrido de rutas (T151)', () => {
  it('las listas cubren todas las páginas de app/pages', async () => {
    const dir = fileURLToPath(new URL('../../app/pages', import.meta.url))
    const files = (await readdir(dir, { recursive: true })).filter(file => file.endsWith('.vue'))
    // `readdir` devuelve `\` como separador en Windows: se normaliza para comparar con las rutas de la app.
    const routes = files.map(file => `/${file.replaceAll('\\', '/').replace(/\.vue$/, '').replace(/(^|\/)index$/, '').replace(/\[(\w+)\]/g, ':$1')}`)
    expect(routes.sort()).toEqual([...PRIVATE_ROUTES, ...PUBLIC_ROUTES, ...PENDING_ROUTES].sort())
  })

  describe('privadas, como administradora', () => {
    const pool = pagePool(viewport => pageAs('admin', ADMIN, viewport))
    let seed: { folderId: string, fileId: string } | null = null

    afterAll(() => pool.closeAll())

    /** Carpeta y archivo de la administradora; se siembran cuando ya existe su perfil (tras abrir su página). */
    async function seeded() {
      if (!seed) {
        // Un .pptx no tiene vista previa en línea: el visor no pide bytes al bucket.
        const owner = await userId(ADMIN)
        const folderId = await seedFolder(`Recorrido ${runId()}`, owner)
        seed = { folderId, fileId: await seedFile(`Recorrido ${runId()}.pptx`, owner, folderId) }
      }
      return seed
    }

    it.each(PRIVATE_ROUTES)('%s', async (pattern) => {
      for (const viewport of VIEWPORTS) {
        const { page, errors } = await pool.get(viewport)
        const { folderId, fileId } = await seeded()
        const path = pattern.replace(':folderId', folderId).replace(':fileId', fileId)
        for (const theme of THEMES) await audit(page, errors, path, theme, viewport)
      }
    })

    // La barra de herramientas del explorador depende del ancho del contenido, que cambia al contraer la barra lateral.
    it('/archivos con la barra lateral contraída (escritorio)', async () => {
      const { page, errors } = await pool.get('desktop')
      await page.goto(`${E2E_URL}/archivos`)
      await waitForHydration(page)
      await page.getByRole('button', { name: 'Contraer barra lateral' }).click()
      await expect.poll(() => page.getByRole('button', { name: 'Expandir barra lateral' }).isVisible()).toBe(true)
      try {
        for (const theme of THEMES) await audit(page, errors, '/archivos', theme, 'desktop')
      }
      finally {
        // El estado vive en localStorage del contexto: se deja expandida para las demás pruebas.
        await page.getByRole('button', { name: 'Expandir barra lateral' }).click()
      }
    })

    it('los enlaces de la barra lateral muestran el anillo de foco al tabular: ambos temas, activo e inactivo, expandida y contraída', async () => {
      const { page } = await pool.get('desktop')
      // Shift+Tab desde el inicio del documento va al último elemento tabulable (la cuenta); otro más, al último enlace del menú.
      const ringOnLastLink = async () => {
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Shift+Tab')
        return page.evaluate(() => {
          const el = document.activeElement
          if (!(el instanceof HTMLElement) || !el.closest('nav[aria-label="Secciones"]')) return null
          const style = getComputedStyle(el)
          return {
            label: el.getAttribute('aria-label') ?? el.textContent?.trim(),
            current: el.getAttribute('aria-current'),
            outline: style.outlineStyle,
            width: Number.parseFloat(style.outlineWidth),
            sameAsText: style.outlineColor === style.color,
          }
        })
      }
      const expectRing = (ring: Awaited<ReturnType<typeof ringOnLastLink>>, label: string) => {
        expect(ring, `${label}: el foco no llegó al menú`).not.toBeNull()
        expect(ring!.outline, `${label}: sin anillo`).not.toBe('none')
        expect(ring!.width, `${label}: anillo sin ancho`).toBeGreaterThan(0)
        expect(ring!.sameAsText, `${label}: el anillo no toma el color del texto`).toBe(true)
      }

      for (const theme of THEMES) {
        await page.context().addCookies([{ name: 'cloudy-theme', value: theme, url: E2E_URL }])
        for (const [path, current] of [['/', null], ['/actividad', 'page']] as const) {
          await page.goto(`${E2E_URL}${path}`)
          await waitForHydration(page)
          const ring = await ringOnLastLink()
          expectRing(ring, `${path} · ${theme}`)
          expect(ring!.label).toBe('Actividad')
          expect(ring!.current).toBe(current)
        }
      }

      await page.getByRole('button', { name: 'Contraer barra lateral' }).click()
      try {
        await page.goto(`${E2E_URL}/actividad`)
        await waitForHydration(page)
        expectRing(await ringOnLastLink(), 'contraída · /actividad')
      }
      finally {
        await page.getByRole('button', { name: 'Expandir barra lateral' }).click()
      }
    })

    it('al crear una carpeta, el aviso no tapa «Nueva carpeta» ni «Subir» (escritorio)', async () => {
      const { page } = await pool.get('desktop')
      await page.goto(`${E2E_URL}/archivos`)
      await waitForHydration(page)
      const newFolder = page.getByRole('button', { name: 'Nueva carpeta' }).first()
      const upload = page.getByRole('button', { name: 'Subir', exact: true })
      await newFolder.click()
      await page.getByLabel('Nombre de la carpeta').fill(`Aviso ${runId()}`)
      await page.getByRole('button', { name: 'Crear carpeta' }).click()
      const toast = page.getByRole('status').locator('.alert', { hasText: 'creada' })
      await expect.poll(() => toast.isVisible()).toBe(true)
      await settled(toast)
      const [toastBox, newFolderBox, uploadBox] = await Promise.all([toast.boundingBox(), newFolder.boundingBox(), upload.boundingBox()])
      expect(toastBox && newFolderBox && overlaps(toastBox, newFolderBox), 'el aviso tapa «Nueva carpeta»').toBe(false)
      expect(toastBox && uploadBox && overlaps(toastBox, uploadBox), 'el aviso tapa «Subir»').toBe(false)
    })

    it('el aviso «Comentario publicado» no tapa el botón «Comentar»', async () => {
      for (const viewport of VIEWPORTS) {
        const { page } = await pool.get(viewport)
        const { fileId } = await seeded()
        await page.goto(`${E2E_URL}/archivos/ver/${fileId}`)
        await waitForHydration(page)
        const field = page.getByLabel('Escribe un comentario')
        await expect.poll(() => field.isVisible()).toBe(true)
        await field.fill(`Aviso en ${viewport} · ${randomUUID().slice(0, 8)}`)
        // `exact`: con un comentario publicado, «Editar comentario de…» también contiene "comentar".
        const button = page.getByRole('button', { name: 'Comentar', exact: true })
        await button.click()
        const toast = page.getByRole('status').locator('.alert', { hasText: 'Comentario publicado' })
        await expect.poll(() => toast.isVisible()).toBe(true)
        await settled(toast)
        // Con el botón pegado al borde inferior, donde salían los avisos, no deben solaparse.
        await button.evaluate(el => el.scrollIntoView({ block: 'end' }))
        const [toastBox, buttonBox] = await Promise.all([toast.boundingBox(), button.boundingBox()])
        expect(toastBox && buttonBox && overlaps(toastBox, buttonBox), `${viewport}: el aviso tapa «Comentar»`).toBe(false)
      }
    })
  })

  describe('públicas y de acceso, sin sesión', () => {
    const pool = pagePool(viewport => createPage(undefined, { viewport: viewports[viewport] }))

    afterAll(() => pool.closeAll())

    it.each(PUBLIC_ROUTES)('%s', async (path) => {
      for (const viewport of VIEWPORTS) {
        const { page, errors } = await pool.get(viewport)
        for (const theme of THEMES) await audit(page, errors, path, theme, viewport)
      }
    })
  })

  describe('/pendiente, con la cuenta pendiente de aprobación', () => {
    const pool = pagePool(pendingPage)

    afterAll(() => pool.closeAll())

    it.each(PENDING_ROUTES)('%s', async (path) => {
      for (const viewport of VIEWPORTS) {
        const { page, errors } = await pool.get(viewport)
        for (const theme of THEMES) await audit(page, errors, path, theme, viewport)
      }
    })
  })
})
