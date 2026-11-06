// Única frontera con Apify (feature 006, research D1–D3): solo este módulo importa `apify-client` y lee
// `apifyApiKey`/`apifyBaseUrl`. Lanza el actor `apify/rag-web-browser` sobre el enlace de la canción y entrega el HTML de la
// página; los endpoints nunca tocan el SDK. Ni las respuestas ni los registros llevan el token, la URL del run ni el mensaje
// del actor: se registra solo el paso, el estado y el tipo (`[lyrics-crawler] call → 402`).
import { ApifyClient } from 'apify-client'
import { songError } from './songs'

export interface CrawledPage {
  html: string | null
  /** `crawl.httpStatusCode` del item. */
  status: number | null
  /** Dirección final tras las redirecciones (`metadata.redirectedUrl ?? metadata.url`). */
  finalUrl: string | null
}

export const LYRICS_ACTOR = 'apify/rag-web-browser'
/** Espera máxima del run (research D2); el plazo de la función es 120 s (D15). */
export const CRAWL_WAIT_SECS = 55
/** Plazo de cada petición HTTP del SDK: debe cubrir la espera larga de `waitForFinish` (verificado en T003). */
export const CRAWL_HTTP_TIMEOUT_SECS = 60

export const CRAWL_INPUT = {
  maxResults: 1,
  outputFormats: ['html'],
  scrapingTool: 'browser-playwright',
  requestTimeoutSecs: 40,
  removeCookieWarnings: true,
  htmlTransformer: 'none',
} as const

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'])

/** `ApifyApiError` (respuesta de la API) → código; cualquier otro error es de red. Se compara por forma, no por clase. */
function classify(error: unknown, step: string) {
  const { name, statusCode, type } = (error ?? {}) as { name?: unknown, statusCode?: unknown, type?: unknown }
  if (name === 'ApifyApiError' && typeof statusCode === 'number') {
    console.warn(`[lyrics-crawler] ${step} → ${statusCode}${typeof type === 'string' ? ` (${type})` : ''}`)
    if (statusCode === 401 || statusCode === 403) return songError('misconfigured')
    if (statusCode === 402) return songError('quota')
    if (statusCode === 429) return songError('busy')
    return songError('crawl_failed')
  }
  console.warn(`[lyrics-crawler] ${step} → network (${typeof name === 'string' ? name : 'unknown'})`)
  return songError('crawl_failed')
}

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/** Rastrea la página de la canción. Lanza errores ya traducidos (research D2); no decide si hay letra. */
export async function crawlLetras(url: string): Promise<CrawledPage> {
  const { apifyApiKey, apifyBaseUrl } = useRuntimeConfig()
  if (!apifyApiKey) throw songError('not_configured')

  const base = typeof apifyBaseUrl === 'string' && apifyBaseUrl !== '' ? { baseUrl: apifyBaseUrl } : {}
  // Un cliente por llamada: las funciones no guardan estado entre peticiones.
  const client = new ApifyClient({ token: String(apifyApiKey), ...base, maxRetries: 2, timeoutSecs: CRAWL_HTTP_TIMEOUT_SECS })

  let run: { id: string, status: string, defaultDatasetId: string }
  try {
    // `log: null`: sin leer ni transmitir el registro del actor (peticiones de más y líneas ajenas en nuestros registros).
    run = await client.actor(LYRICS_ACTOR).call({ query: url, ...CRAWL_INPUT }, { waitSecs: CRAWL_WAIT_SECS, log: null })
  }
  catch (error) {
    throw classify(error, 'call')
  }

  if (!TERMINAL.has(run.status)) {
    // Sigue corriendo tras la espera: se cancela para no pagar un run huérfano (mejor esfuerzo).
    console.warn(`[lyrics-crawler] run → ${run.status} (abort)`)
    await client.run(run.id).abort().catch(() => console.warn('[lyrics-crawler] abort → failed'))
    throw songError('crawl_failed')
  }
  if (run.status !== 'SUCCEEDED') {
    console.warn(`[lyrics-crawler] run → ${run.status}`)
    throw songError('crawl_failed')
  }

  let items: unknown[]
  try {
    ({ items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 1 }))
  }
  catch (error) {
    throw classify(error, 'items')
  }
  const item = items[0] as { html?: unknown, crawl?: { httpStatusCode?: unknown }, metadata?: { url?: unknown, redirectedUrl?: unknown } } | undefined
  if (!item) {
    console.warn('[lyrics-crawler] items → empty')
    throw songError('crawl_failed')
  }
  const status = item.crawl?.httpStatusCode
  return {
    html: text(item.html),
    status: typeof status === 'number' && Number.isFinite(status) ? status : null,
    finalUrl: text(item.metadata?.redirectedUrl) ?? text(item.metadata?.url),
  }
}
