// Stub local de la API de Apify para los e2e (feature 006, research D14). La app de pruebas lo usa vía
// `NUXT_APIFY_BASE_URL`; los e2e nunca llaman a Apify ni a Letras.com. Implementa solo las rutas que usa `apify-client`
// con `call({ … }, { log: null })` y `listItems` (verificadas en T003):
//   POST /v2/actors/apify~rag-web-browser/runs · GET /v2/actor-runs/:id?waitForFinish=N · POST /v2/actor-runs/:id/abort ·
//   GET /v2/datasets/:id/items
// Escenarios por el último segmento del enlace pedido (`query`): ver `APIFY_SCENARIOS` en `constants.ts`.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const APIFY_STUB_TOKEN = 'e2e-stub'

/** Página real de una canción (T004): la del enlace de ejemplo de quickstart § 2. */
const REAL_SONG = readFileSync(new URL('../../unit/fixtures/letras-song.html', import.meta.url), 'utf8')
const REAL_SLUG = 'de-buenas-part-josh-gamez'

interface Run { id: string, datasetId: string, query: string, status: string }

const slugOf = (query: string) => query.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? ''

/** «cancion-uno-ab12» → «Cancion uno ab12»; el escenario `con-tildes` prueba nombres de archivo con tildes. */
function titleOf(slug: string): string {
  if (slug.includes('con-tildes')) return 'Canción del Señor'
  const words = slug.replace(/-+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Canción'
}

function songPage(slug: string): string {
  if (slug === REAL_SLUG) return REAL_SONG
  const title = titleOf(slug)
  const head = `<head><title>${title.toUpperCase()} - Artista E2E - LETRAS.COM</title></head>`
  const header = `<h1>${title}</h1><a class="title-secondary" href="/e2e/"><h2>Artista E2E</h2></a>`
  if (slug.includes('sin-letra')) return `<html>${head}<body>${header}<p>Esta página no tiene letra.</p></body></html>`
  const lines = slug.includes('muy-larga')
    ? `<p>${Array.from({ length: 301 }, (_, i) => `Línea ${i + 1}`).join('<br>')}</p>`
    : `<p>Primera línea de ${title}<br>Segunda línea</p><p>Coro de ${title}<br>Aleluya (x2)</p>`
  return `<html>${head}<body>${header}<div class="lyric-original">${lines}</div></body></html>`
}

function item(query: string) {
  const slug = slugOf(query)
  // Letras.com redirige un enlace inexistente a otra canción con 200 (research D2, hallazgo de T003).
  const finalUrl = slug.includes('redirige') ? 'https://www.letras.com/e2e/otra-cancion/' : query
  return {
    crawl: { httpStatusCode: 200, httpStatusMessage: 'OK', requestStatus: 'handled' },
    metadata: { title: titleOf(slug), url: finalUrl, redirectedUrl: finalUrl, canonicalUrl: finalUrl },
    query,
    html: songPage(slug),
  }
}

export interface ApifyStubCalls {
  /** `query` de cada run creado, en orden. */
  runs: string[]
  aborts: number
}

export async function startApifyStub(): Promise<{ url: string, close: () => Promise<void> }> {
  const runs = new Map<string, Run>()
  const calls: ApifyStubCalls = { runs: [], aborts: 0 }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url ?? '/', 'http://stub')
    const path = url.pathname
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'GET' && path === '/__stub/calls') return json(200, calls)
    if (req.method === 'POST' && path === '/__stub/reset') {
      calls.runs.length = 0
      calls.aborts = 0
      runs.clear()
      return json(200, { ok: true })
    }

    if (req.headers.authorization !== `Bearer ${APIFY_STUB_TOKEN}`) {
      return json(401, { error: { type: 'token-not-valid', message: 'Authentication token is not valid.' } })
    }

    if (req.method === 'POST' && path === '/v2/actors/apify~rag-web-browser/runs') {
      const input = (raw ? JSON.parse(raw) : {}) as { query?: string }
      const query = String(input.query ?? '')
      calls.runs.push(query)
      if (slugOf(query).includes('sin-credito')) {
        return json(402, { error: { type: 'not-enough-usage-to-run-paid-actor', message: 'Not enough usage.' } })
      }
      const run: Run = {
        id: randomBytes(8).toString('hex'),
        datasetId: randomBytes(8).toString('hex'),
        query,
        status: slugOf(query).includes('fallo-del-run') ? 'FAILED' : 'SUCCEEDED',
      }
      runs.set(run.id, run)
      return json(201, { data: { id: run.id, status: 'RUNNING', defaultDatasetId: run.datasetId } })
    }

    const runMatch = /^\/v2\/actor-runs\/([0-9a-f]+)(\/abort)?$/.exec(path)
    if (runMatch) {
      const run = runs.get(runMatch[1]!)
      if (!run) return json(404, { error: { type: 'record-not-found', message: 'Actor run was not found' } })
      if (req.method === 'POST' && runMatch[2]) {
        calls.aborts += 1
        run.status = 'ABORTED'
      }
      return json(200, { data: { id: run.id, status: run.status, defaultDatasetId: run.datasetId } })
    }

    const itemsMatch = /^\/v2\/datasets\/([0-9a-f]+)\/items$/.exec(path)
    if (req.method === 'GET' && itemsMatch) {
      const run = [...runs.values()].find(r => r.datasetId === itemsMatch[1])
      const items = run && run.status === 'SUCCEEDED' ? [item(run.query)] : []
      return json(200, items, {
        'x-apify-pagination-total': String(items.length),
        'x-apify-pagination-offset': '0',
        'x-apify-pagination-limit': url.searchParams.get('limit') ?? '1',
        'x-apify-pagination-desc': 'false',
      })
    }

    json(404, { error: { type: 'page-not-found', message: 'Not found' } })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}
