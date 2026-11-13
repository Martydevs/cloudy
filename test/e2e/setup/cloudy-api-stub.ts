// Stub local del servicio de descargas `cloudy-api` para los e2e (feature 005, research D17). La app de pruebas lo
// usa vía `NUXT_CLOUDY_API_URL`; los e2e nunca llaman a YouTube ni al servicio real. Implementa el contrato del servicio
// (`/healthz` en la raíz y, bajo `/api`, `/videos/:id`, `/jobs`, `/jobs/:id`, `/jobs/:id/file`, `/lyrics/pptx` y
// `/lyrics/pptx/batch`) con escenarios por ID de video. Como el servicio, las rutas viejas `/v1/*` y `/v2/*` responden 404.
// Los archivos son fixtures reproducibles diminutos (`test/fixtures/files/stub-video.mp4` y `stub-audio.mp3`,
// H.264/AAC y MP3); el `.zip` de un lote se arma en código (STORED).
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const STUB_API_KEY = 'e2e-stub-key'
const SIGNING = 'stub-signing-secret'

const VIDEO = readFileSync(new URL('../../fixtures/files/stub-video.mp4', import.meta.url))
const AUDIO = readFileSync(new URL('../../fixtures/files/stub-audio.mp3', import.meta.url))

/** Tiempo de cada video de un trabajo (corto) y el de `slowJobVid1`. */
const ITEM_MS = 400
const SLOW_ITEM_MS = 6000
const ZIP_MS = 200

interface Scenario {
  title: string
  channel: string | null
  duration: number | null
  heights: number[]
  downloadable: boolean
  reason?: string
  /** La sonda falla con este código (422 del servicio). */
  probeError?: string
  /** El video falla dentro del trabajo con este código (pasa la sonda). */
  jobError?: string
  /** Fracción de avance en la que falla. */
  failAt?: number
  slow?: boolean
  /** El servicio responde 502 con este código al sondear el video o al crear un trabajo que lo incluya. */
  serviceError?: string
}

const HEIGHTS = [144, 240, 360, 480, 720, 1080]

/** Escenarios por ID de video (11 caracteres). Cualquier otro ID válido es un video corto descargable. */
export const SCENARIOS: Record<string, Partial<Scenario>> = {
  okShortVid1: { title: 'Alabanza de prueba', channel: 'Canal Cloudy', duration: 185 },
  privateVid1: { probeError: 'private' },
  tooLongVid1: { title: 'Conferencia muy larga', duration: 7200, downloadable: false, reason: 'too_long' },
  liveVideo01: { title: 'Transmisión en vivo', duration: null, downloadable: false, reason: 'live' },
  slowJobVid1: { title: 'Video lento', slow: true },
  failMidVid1: { title: 'Video que falla', jobError: 'download_failed', failAt: 0.5 },
  unavailVid1: { title: 'Video que ya no está', jobError: 'unavailable', failAt: 0 },
  lowResVid01: { title: 'Video en baja calidad', heights: [144, 240, 360, 480] },
  // El bloqueo anti-robots de YouTube al sondear o crear (502 del servicio), o ya dentro del trabajo.
  botCheckVd1: { title: 'Bloqueado por YouTube', serviceError: 'bot_check' },
  itemBotChk1: { title: 'Bloqueado dentro del trabajo', jobError: 'bot_check', failAt: 0 },
}

function scenario(videoId: string): Scenario {
  const s = SCENARIOS[videoId] ?? {}
  return {
    title: s.title ?? `Video ${videoId}`,
    channel: s.channel === undefined ? 'Canal Cloudy' : s.channel,
    duration: s.duration === undefined ? 95 : s.duration,
    heights: s.heights ?? HEIGHTS,
    downloadable: s.downloadable ?? true,
    ...s,
  } as Scenario
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

// ---------------------------------------------------------------- zip (STORED, sin compresión)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

export function buildZip(entries: { name: string, data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, data } of entries) {
    const fileName = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8
    local.writeUInt16LE(0, 8) // STORED
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    locals.push(local, fileName, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, fileName)
    offset += 30 + fileName.length + data.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

// ---------------------------------------------------------------- trabajos

type Format = 'mp4_720' | 'mp4_1080' | 'mp3'

interface Job {
  id: string
  format: Format
  createdAt: number
  videoIds: string[]
  cancelled: boolean
}

interface ItemView {
  video_id: string
  title: string
  status: 'queued' | 'running' | 'done' | 'failed'
  progress: number
  error: { code: string, message: string } | null
  actual_height: number | null
}

function itemDuration(videoId: string) {
  return scenario(videoId).slow ? SLOW_ITEM_MS : ITEM_MS
}

/** Estado del trabajo calculado por el tiempo transcurrido: los videos se procesan uno tras otro. */
function view(job: Job, now = Date.now()) {
  let clock = job.createdAt
  const elapsed = now
  const items: ItemView[] = job.videoIds.map((videoId) => {
    const s = scenario(videoId)
    const duration = itemDuration(videoId)
    const start = clock
    clock += duration
    const fraction = Math.max(0, Math.min(1, (elapsed - start) / duration))
    const height = job.format === 'mp3' ? null : Math.min(job.format === 'mp4_1080' ? 1080 : 720, Math.max(...s.heights))
    if (s.jobError && fraction >= (s.failAt ?? 0) && elapsed >= start) {
      return { video_id: videoId, title: s.title, status: 'failed', progress: s.failAt ?? 0, error: { code: s.jobError, message: 'Stub failure' }, actual_height: null }
    }
    if (elapsed < start) return { video_id: videoId, title: s.title, status: 'queued', progress: 0, error: null, actual_height: null }
    if (fraction < 1) return { video_id: videoId, title: s.title, status: 'running', progress: fraction, error: null, actual_height: null }
    return { video_id: videoId, title: s.title, status: 'done', progress: 1, error: null, actual_height: height }
  })
  const finishedAt = clock + (job.videoIds.length > 1 ? ZIP_MS : 0)
  const progress = items.reduce((n, i) => n + i.progress, 0) / items.length
  const successes = items.filter(i => i.status === 'done')
  const allSettled = items.every(i => i.status === 'done' || i.status === 'failed')
  let status: 'queued' | 'running' | 'zipping' | 'done' | 'failed' = elapsed < job.createdAt ? 'queued' : 'running'
  if (allSettled && successes.length === 0) status = 'failed'
  else if (allSettled && elapsed < finishedAt) status = 'zipping'
  else if (allSettled) status = 'done'
  return { items, status, progress, successes, finishedAt }
}

function sanitize(title: string) {
  return title.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim() || 'video'
}

function fileOf(job: Job, successes: ItemView[]): { name: string, data: Buffer, type: string } {
  const ext = job.format === 'mp3' ? 'mp3' : 'mp4'
  const bytes = job.format === 'mp3' ? AUDIO : VIDEO
  if (job.videoIds.length === 1) {
    const item = successes[0]!
    return { name: `${sanitize(item.title)} [${item.video_id}].${ext}`, data: bytes, type: ext === 'mp3' ? 'audio/mpeg' : 'video/mp4' }
  }
  const data = buildZip(successes.map(i => ({ name: `${sanitize(i.title)} [${i.video_id}].${ext}`, data: bytes })))
  return { name: `cloudy-batch-${job.id.slice(0, 8)}.zip`, data, type: 'application/zip' }
}

const sign = (jobId: string, exp: number) => createHmac('sha256', SIGNING).update(`${jobId}:${exp}`).digest('hex')

// ---------------------------------------------------------------- servidor

/** Paquete OOXML mínimo (tipos de contenido, relaciones y `presentation.xml`): basta para que el navegador lo descargue. */
function minimalPptx(title: string): Buffer {
  const xml = (text: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${text}`)
  const safe = title.replace(/[<&>"]/g, '')
  return buildZip([
    { name: '[Content_Types].xml', data: xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>') },
    { name: '_rels/.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>') },
    { name: 'docProps/core.xml', data: xml(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${safe}</dc:title></cp:coreProperties>`) },
    { name: 'ppt/presentation.xml', data: xml('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>') },
  ])
}

export type StubState = 'up' | 'asleep' | 'degraded'

export interface CloudyStubCalls {
  /** Trabajos creados (`POST /api/jobs` aceptados). */
  jobsCreated: number
  /** Intentos de crear un trabajo (aceptados o no) y sondas de video. */
  createAttempts: number
  probes: number
  /** Peticiones a rutas con clave que llegaron sin la clave correcta. */
  unauthorized: number
  /** Formatos de cada trabajo creado, en orden. */
  formats: string[]
  /** Presentaciones pedidas (`POST /api/lyrics/pptx`, feature 006): título y color de letra recibidos. */
  pptx: { title: string, fontColor: string | null, html: string }[]
  /** Lotes pedidos (`POST /api/lyrics/pptx/batch`): las canciones de cada uno, en orden. */
  pptxBatch: { title: string, fontColor: string | null, html: string }[][]
}

const noCalls = (): CloudyStubCalls =>
  ({ jobsCreated: 0, createAttempts: 0, probes: 0, unauthorized: 0, formats: [], pptx: [], pptxBatch: [] })

export async function startCloudyApiStub(): Promise<{ url: string, close: () => Promise<void> }> {
  const jobs = new Map<string, Job>()
  let state: StubState = 'up'
  let calls = noCalls()
  let base = ''

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url ?? '/', 'http://stub')
    const path = url.pathname
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    const detail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
      json(status, { detail: { code, message, ...extra } })

    // Control del stub (solo los e2e).
    if (req.method === 'POST' && path === '/__stub/state') {
      state = (raw ? (JSON.parse(raw) as { state?: StubState }).state : undefined) ?? 'up'
      return json(200, { state })
    }
    if (req.method === 'POST' && path === '/__stub/reset') {
      state = 'up'
      calls = noCalls()
      jobs.clear()
      return json(200, calls)
    }
    if (req.method === 'GET' && path === '/__stub/calls') return json(200, calls)

    // Dormido: la plataforma responde 502 a todo, como la plataforma (Railway) mientras levanta la instancia.
    if (state === 'asleep') {
      res.writeHead(502, { 'content-type': 'text/plain' })
      return res.end('Bad Gateway')
    }

    if (req.method === 'GET' && path === '/healthz') {
      const ok = state === 'up'
      return json(ok ? 200 : 503, { status: ok ? 'ok' : 'degraded', pytubefix_version: 'stub', pytubefix_node: ok, ffmpeg: ok })
    }

    // Todas las rutas del servicio viven bajo `/api`; cualquier otra (las viejas `/v1`, `/v2`) es el 404 de FastAPI.
    if (!path.startsWith('/api/')) return json(404, { detail: 'Not Found' })
    const route = path.slice('/api'.length)

    const file = /^\/jobs\/([0-9a-f]{32})\/file$/.exec(route)
    if (req.method === 'GET' && file) {
      const exp = Number(url.searchParams.get('exp'))
      const sig = url.searchParams.get('sig') ?? ''
      const jobId = file[1]!
      if (sig !== sign(jobId, exp)) return detail(403, 'invalid_signature', 'Invalid download link')
      if (exp * 1000 < Date.now()) return detail(403, 'link_expired', 'Download link expired, poll the job again')
      const job = jobs.get(jobId)
      if (!job) return detail(404, 'not_found', 'Job not found or expired')
      const v = view(job)
      if (v.status !== 'done') return detail(404, 'not_found', 'Job not found or expired')
      const out = fileOf(job, v.successes)
      const headers: Record<string, string | number> = {
        'content-type': out.type,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.name)}`,
        'accept-ranges': 'bytes',
        // Como el servicio real (`ALLOWED_ORIGINS`): el navegador baja el archivo para guardarlo en el drive.
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'Content-Disposition, Content-Length',
      }
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
      if (range) {
        const start = range[1] ? Number(range[1]) : 0
        const end = range[2] ? Math.min(Number(range[2]), out.data.length - 1) : out.data.length - 1
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${out.data.length}`, 'content-length': end - start + 1 })
        return res.end(out.data.subarray(start, end + 1))
      }
      res.writeHead(200, { ...headers, 'content-length': out.data.length })
      return res.end(out.data)
    }

    // A partir de aquí todo exige la clave.
    if (req.headers['x-api-key'] !== STUB_API_KEY) {
      calls.unauthorized++
      return detail(401, 'unauthorized', 'Invalid or missing API key')
    }

    // Presentación de una letra (feature 006, research D9). Escenarios por el título: «vacia» → 422 no_lyrics,
    // «demasiado larga» → 422 lyrics_too_long, «respaldo» → reparto de respaldo; un cuerpo sin `html` → 422 de validación.
    if (req.method === 'POST' && route === '/lyrics/pptx') {
      const body = (raw ? JSON.parse(raw) : {}) as { html?: unknown, title?: unknown, font_color?: unknown }
      if (typeof body.html !== 'string' || body.html === '') return json(422, { detail: [{ loc: ['body', 'html'], msg: 'Field required' }] })
      const title = typeof body.title === 'string' && body.title !== '' ? body.title : 'lyrics'
      calls.pptx.push({ title, fontColor: typeof body.font_color === 'string' ? body.font_color : null, html: body.html })
      const key = title.toLowerCase()
      if (key.includes('vacia')) return detail(422, 'no_lyrics', 'No lyrics found in the HTML')
      if (key.includes('demasiado larga')) return detail(422, 'lyrics_too_long', 'Too many lines')
      const slides = Math.max(1, (body.html.match(/<p>/g) ?? []).length)
      const data = minimalPptx(title)
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'content-disposition': `attachment; filename="${title.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/"/g, '')}.pptx"; filename*=UTF-8''${encodeURIComponent(`${title}.pptx`)}`,
        'x-slide-count': String(slides),
        'x-lyrics-arranged-by': key.includes('respaldo') ? 'fallback' : 'llm',
        'content-length': data.length,
      })
      return res.end(data)
    }

    // Lote de presentaciones (hasta 3): mismos escenarios por título que la suelta. Responde un `.zip` con un `.pptx` por
    // canción lograda y `manifest.json` con el resultado de cada una (índices 0..n-1); si ninguna sale, 422 `all_items_failed`.
    if (req.method === 'POST' && route === '/lyrics/pptx/batch') {
      const body = (raw ? JSON.parse(raw) : {}) as { items?: unknown }
      const items = Array.isArray(body.items) ? body.items as { html?: unknown, title?: unknown, font_color?: unknown }[] : null
      if (!items || items.length === 0 || items.some(item => typeof item?.html !== 'string' || item.html === '')) {
        return json(422, { detail: [{ loc: ['body', 'items'], msg: 'Field required' }] })
      }
      if (items.length > 3) return detail(422, 'batch_too_large', 'At most 3 items per batch')
      const sent = items.map(item => ({
        title: typeof item.title === 'string' && item.title !== '' ? item.title : 'lyrics',
        fontColor: typeof item.font_color === 'string' ? item.font_color : null,
        html: item.html as string,
      }))
      calls.pptxBatch.push(sent)
      const used = new Set<string>()
      const files: { name: string, data: Buffer }[] = []
      const manifest = sent.map(({ title, html }, index) => {
        const key = title.toLowerCase()
        const failure = key.includes('vacia') ? 'no_lyrics' : key.includes('demasiado larga') ? 'lyrics_too_long' : null
        if (failure) return { index, status: 'failed', filename: null, slide_count: null, arranged_by: null, error: { code: failure, message: 'Stub failure' } }
        const base = title.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/[\\/:*?"<>|]/g, '').trim() || 'lyrics'
        let filename = `${base}.pptx`
        for (let n = 2; used.has(filename); n++) filename = `${base} (${n}).pptx`
        used.add(filename)
        files.push({ name: filename, data: minimalPptx(title) })
        return {
          index,
          status: 'done',
          filename,
          slide_count: Math.max(1, (html.match(/<p>/g) ?? []).length),
          arranged_by: key.includes('respaldo') ? 'fallback' : 'llm',
          error: null,
        }
      })
      if (files.length === 0) return detail(422, 'all_items_failed', 'No item could be generated', { items: manifest })
      const data = buildZip([...files, { name: 'manifest.json', data: Buffer.from(JSON.stringify({ items: manifest })) }])
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="lyrics.zip"',
        'content-length': data.length,
      })
      return res.end(data)
    }

    /** El servicio no puede con el video (p. ej. el bloqueo anti-robots): 502 con su código. */
    const serviceFailure = (videoIds: string[]) => videoIds.map(id => scenario(id).serviceError).find(Boolean)

    const video = /^\/videos\/([^/]+)$/.exec(route)
    if (req.method === 'GET' && video) {
      const videoId = decodeURIComponent(video[1]!)
      if (!VIDEO_ID_RE.test(videoId)) return json(422, { detail: [{ loc: ['path', 'video_id'], msg: 'pattern' }] })
      calls.probes++
      const s = scenario(videoId)
      const blocked = serviceFailure([videoId])
      if (blocked) return detail(502, blocked, 'Sign in to confirm you\'re not a bot')
      if (s.probeError) return detail(422, s.probeError, 'Private video. Sign in if you\'ve been granted access')
      return json(200, {
        video_id: videoId,
        title: s.title,
        duration: s.duration,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        channel: s.channel,
        available_heights: s.heights,
        downloadable: s.downloadable,
        reason: s.downloadable ? null : s.reason ?? null,
      })
    }

    if (req.method === 'POST' && route === '/jobs') {
      const body = raw ? JSON.parse(raw) as { video_ids?: unknown, format?: unknown } : {}
      const ids = Array.isArray(body.video_ids) ? [...new Set(body.video_ids as string[])] : []
      const format = body.format as Format
      if (ids.length === 0 || !['mp4_720', 'mp4_1080', 'mp3'].includes(format) || ids.some(id => !VIDEO_ID_RE.test(id))) {
        return json(422, { detail: [{ loc: ['body'], msg: 'invalid' }] })
      }
      if (ids.length > 10) return detail(422, 'batch_too_large', 'At most 10 videos per job')
      calls.createAttempts++
      const blocked = serviceFailure(ids)
      if (blocked) return detail(502, blocked, 'Sign in to confirm you\'re not a bot')
      const problems = ids.flatMap((id) => {
        const s = scenario(id)
        if (s.probeError) return [{ video_id: id, code: s.probeError, message: 'Private video' }]
        if (!s.downloadable) return [{ video_id: id, code: s.reason ?? 'not_downloadable', message: 'Video can\'t be downloaded' }]
        return []
      })
      if (problems.length) return detail(422, 'videos_rejected', 'Some videos can\'t be downloaded', { videos: problems })
      const id = randomBytes(16).toString('hex')
      jobs.set(id, { id, format, createdAt: Date.now(), videoIds: ids, cancelled: false })
      calls.jobsCreated++
      calls.formats.push(format)
      return json(202, { job_id: id, status: 'queued' })
    }

    const jobMatch = /^\/jobs\/([^/]+)$/.exec(route)
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]!)
      if (!job) return detail(404, 'not_found', 'Job not found or expired')
      if (req.method === 'DELETE') {
        jobs.delete(job.id)
        res.writeHead(204)
        return res.end()
      }
      if (req.method === 'GET') {
        const v = view(job)
        const out: Record<string, unknown> = {
          job_id: job.id,
          status: v.status,
          format: job.format,
          progress: Math.round(v.progress * 10_000) / 10_000,
          items: v.items,
        }
        if (v.status === 'done') {
          const exp = Math.floor(Date.now() / 1000) + 600
          const file = fileOf(job, v.successes)
          out.download_url = `${base}/api/jobs/${job.id}/file?exp=${exp}&sig=${sign(job.id, exp)}`
          out.filename = file.name
          out.size_bytes = file.data.length
          out.expires_at = v.finishedAt / 1000 + 1800
        }
        return json(200, out)
      }
    }

    detail(404, 'not_found', 'Not found')
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
  return {
    url: base,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}
