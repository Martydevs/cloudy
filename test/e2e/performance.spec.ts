// Constitución I / R18 — Presupuestos de rendimiento en móvil 4G: LCP ≤ 2,5 s y CLS ≤ 0,1 en el
// Inicio (50 archivos sembrados), una carpeta con 200 elementos y /enviar. Chromium a 360×740 con
// red 4G y CPU ×4 vía CDP; mediana de 3 cargas en frío (caché del navegador desactivada).
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { BrowserContext, Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import type { TestContext } from 'vitest'
import { E2E_URL, email, profileUserId, runId, seedFiles, seedFolder, signedInAs, viewports, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const LCP_BUDGET_MS = 2500
const CLS_BUDGET = 0.1
const LOADS = 3
/** Tras el estado con contenido se deja un respiro para que lleguen los últimos candidatos de LCP y desplazamientos. */
const SETTLE_MS = 1000

// Móvil 4G lento (perfil de Lighthouse): 9 Mbps de bajada, 1,5 Mbps de subida, 170 ms de RTT, CPU ×4.
const NETWORK = { offline: false, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8, latency: 170 }
const CPU_RATE = 4

const ADMIN = 'perf-admin'

interface Vitals {
  lcp: number
  cls: number
  /** Diagnóstico de dónde se va el tiempo: TTFB del HTML, DOMContentLoaded, elemento LCP y peticiones /api. */
  ttfb: number
  dcl: number
  lcpElement: string
  api: string[]
  /** Desplazamientos con su valor y los nodos que se movieron (para saber qué arreglar si el CLS se pasa). */
  shifts: string[]
}

type CookieInit = Parameters<BrowserContext['addCookies']>[0][number]
let session: readonly CookieInit[] | null = null
let seed: { folderId: string } | null = null
let page: Page | null = null

/**
 * Una sola sesión en todo el archivo (Neon Auth limita los inicios de sesión) y una sola página
 * acelerada: `createPage` necesita el contexto de @nuxt/test-utils, que solo existe dentro de cada
 * prueba, así que se abre la primera vez que una prueba la pide.
 */
async function throttledPage(): Promise<Page> {
  if (page) return page
  page = await createPage(undefined, { viewport: viewports.phone })
  if (session) await page.context().addCookies(session)
  else {
    await signedInAs(page, 'admin', ADMIN)
    session = await page.context().cookies()
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', NETWORK)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE })
  return page
}

/** Inicio con 50 archivos y una carpeta con 200; se siembran cuando ya existe el perfil (tras iniciar sesión). */
async function seeded(): Promise<{ folderId: string }> {
  if (seed) return seed
  await throttledPage()
  const owner = await profileUserId(email(ADMIN))
  const homeFolder = await seedFolder(`Inicio ${runId()}`, owner)
  await seedFiles(owner, homeFolder, 50, `Reciente ${runId()}`)
  const folderId = await seedFolder(`Rendimiento ${runId()}`, owner)
  await seedFiles(owner, folderId, 200, `Elemento ${runId()}`)
  seed = { folderId }
  return seed
}

/**
 * LCP: último candidato reportado (en ms desde la navegación). CLS: ventanas de sesión de 1 s con
 * tope de 5 s (la definición de Web Vitals) ignorando los desplazamientos tras una interacción.
 */
function measure(p: Page): Promise<Vitals> {
  return p.evaluate((settle) => new Promise<Vitals>((resolve) => {
    let lcp = 0
    let lcpElement = ''
    const describe = (el: Element | null | undefined) => {
      if (!el) return '?'
      const cls = (el.getAttribute('class') ?? '').split(' ').slice(0, 3).join('.')
      return `<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}> "${(el.textContent ?? '').trim().slice(0, 30)}"`
    }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { element?: Element | null })[]) {
        lcp = entry.startTime
        lcpElement = describe(entry.element)
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true })

    let cls = 0
    let windowValue = 0
    let windowStart = 0
    let previous = 0
    const shifts: string[] = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number, hadRecentInput: boolean, sources?: { node?: Node | null }[] })[]) {
        if (entry.hadRecentInput) continue
        shifts.push(`${entry.value.toFixed(3)}@${Math.round(entry.startTime)} ${(entry.sources ?? []).map(s => describe(s.node instanceof Element ? s.node : s.node?.parentElement)).join(' | ')}`)
        if (windowValue > 0 && entry.startTime - previous < 1000 && entry.startTime - windowStart < 5000) {
          windowValue += entry.value
        }
        else {
          windowValue = entry.value
          windowStart = entry.startTime
        }
        previous = entry.startTime
        cls = Math.max(cls, windowValue)
      }
    }).observe({ type: 'layout-shift', buffered: true })

    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      const api = performance.getEntriesByType('resource')
        .filter(r => new URL(r.name).pathname.startsWith('/api/'))
        .map(r => `${new URL(r.name).pathname.replace(/[0-9a-f-]{36}/g, ':id')} ${Math.round(r.startTime)}→${Math.round(r.responseEnd)}`)
      resolve({
        lcp: Math.round(lcp),
        cls: Number(cls.toFixed(4)),
        ttfb: Math.round(nav?.responseStart ?? 0),
        dcl: Math.round(nav?.domContentLoadedEventEnd ?? 0),
        lcpElement,
        api,
        shifts,
      })
    }, settle)
  }), SETTLE_MS)
}

async function load(p: Page, path: string): Promise<Vitals> {
  await p.goto(`${E2E_URL}${path}`, { waitUntil: 'load' })
  await waitForHydration(p)
  // Se mide el estado con contenido, no el skeleton: el LCP real llega con los datos.
  await expect.poll(() => p.locator('[aria-busy="true"]').count(), { message: `${path}: sigue cargando` }).toBe(0)
  return measure(p)
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

type Annotate = TestContext['annotate']

/**
 * Los números se anotan en la prueba (el reporter los muestra también cuando pasa) y se escriben
 * directo a stdout: `console.*` dentro del worker puede quedar oculto para las pruebas que pasan.
 */
async function audit(path: string, annotate: Annotate) {
  const p = await throttledPage()
  // Una carga de calentamiento que no cuenta: la primera SSR de cada ruta tras arrancar el servidor
  // paga el código de la ruta y la conexión TLS a Neon (+200–500 ms de TTFB), un artefacto del
  // laboratorio y no del producto. Solo calienta servidor y BD: la caché del navegador sigue apagada.
  await load(p, path)
  const runs: Vitals[] = []
  for (let i = 0; i < LOADS; i++) runs.push(await load(p, path))
  const lcp = median(runs.map(r => r.lcp))
  const cls = median(runs.map(r => r.cls))
  const summary = `LCP ${lcp} ms · CLS ${cls} · cargas: ${runs.map(r => `${r.lcp} ms / ${r.cls}`).join(', ')}`
  const detail = runs.map((r, i) => `carga ${i + 1}: TTFB ${r.ttfb} · DCL ${r.dcl} · LCP ${r.lcp} en ${r.lcpElement} · api: ${r.api.join(', ') || '—'}${r.shifts.length ? ` · desplazamientos: ${r.shifts.join(' ; ')}` : ''}`)
  process.stdout.write(`[perf] ${path} · ${summary}\n${detail.map(d => `[perf]   ${d}\n`).join('')}`)
  await annotate(summary, 'perf')
  for (const d of detail) await annotate(d, 'perf')
  expect(lcp, `${path}: LCP ${lcp} ms supera ${LCP_BUDGET_MS} ms`).toBeLessThanOrEqual(LCP_BUDGET_MS)
  expect(cls, `${path}: CLS ${cls} supera ${CLS_BUDGET}`).toBeLessThanOrEqual(CLS_BUDGET)
}

describe('Constitución I · Web Vitals en móvil 4G (T155)', () => {
  afterAll(async () => {
    await page?.close()
    page = null
  })

  it('/ con 50 archivos recientes', async ({ annotate }) => {
    await seeded()
    await audit('/', annotate)
  })

  it('/archivos/<carpeta> con 200 elementos', async ({ annotate }) => {
    const { folderId } = await seeded()
    await audit(`/archivos/${folderId}`, annotate)
  })

  it('/enviar (pública)', async ({ annotate }) => {
    await audit('/enviar', annotate)
  })

  it('/upload (pública, feature 003)', async ({ annotate }) => {
    await audit('/upload', annotate)
  })

  it('/solicitudes (feature 003)', async ({ annotate }) => {
    await seeded()
    await audit('/solicitudes', annotate)
  })
})

// Feature 002 · SC-006 — la búsqueda por el texto leído de las imágenes responde en < 2 s con 5 000 archivos.
describe('SC-006 · búsqueda por texto con 5 000 archivos', () => {
  it('GET /api/files/search?q=<palabra del texto> responde en menos de 2 s', async ({ annotate }) => {
    const p = await throttledPage()
    const owner = await profileUserId(email(ADMIN))
    const folderId = await seedFolder(`Texto ${runId()}`, owner)
    const word = `girasol${runId()}`
    // Una de cada 10 con texto leído; solo 50 contienen la palabra buscada.
    await seedFiles(owner, folderId, 5000, `Nota ${runId()}`, {
      textContent: i => (i % 10 === 0 ? `Oremos por la familia\nGracias por ${i % 100 === 0 ? word : 'el campamento'}` : null),
    })
    const cookie = (await p.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ')
    const timings: number[] = []
    let found = 0
    for (let i = 0; i < 3; i++) {
      const start = performance.now()
      const res = await fetch(`${E2E_URL}/api/files/search?q=${word}`, { headers: { cookie } })
      timings.push(Math.round(performance.now() - start))
      expect(res.status).toBe(200)
      const body = await res.json() as { files: { matchedIn: string }[] }
      found = body.files.length
      expect(body.files.every(f => f.matchedIn === 'text')).toBe(true)
    }
    const ms = median(timings)
    await annotate(`búsqueda por texto: ${ms} ms (${timings.join(', ')}) · ${found} resultados en la primera página`, 'perf')
    expect(found).toBeGreaterThan(0)
    expect(ms, `búsqueda por texto: ${ms} ms`).toBeLessThan(2000)
  })
})
