// Utilidades compartidas por los e2e. Las identidades son únicas por corrida (`e2e+<runId>-…`).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { inject } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import { ALLOWED_TYPES, getExtension } from '../../../shared/constants/files'
import { readEnvFile, requireVar } from '../../../scripts/env'
import { E2E_URL } from './constants'
import type { StubCalls, StubMode } from './openrouter-stub'

export { E2E_URL }

export const runId = (): string => inject('runId')

/** Consultas directas a la BD de la rama de pruebas (.env.test), nunca a otra. */
export function testSql() {
  return neon(requireVar(readEnvFile('test'), 'NUXT_DATABASE_URL', 'test'))
}

export const PASSWORD = 'cloudy-e2e-123'

export function email(role: string): string {
  return `e2e+${runId()}-${role}@cloudy.test`
}

export interface Credentials {
  name?: string
  email: string
  password?: string
}

export const viewports = {
  phone: { width: 360, height: 740 },
  desktop: { width: 1280, height: 800 },
} as const

export function fixture(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/files/${name}`, import.meta.url))
}

/** Espera a que Vue monte la app (los clics previos no tendrían efecto). */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__)
}

/**
 * Neon Auth corre Better Auth 1.7, que limita por IP + ruta: `/sign-in/*` y `/sign-up/*` admiten
 * 3 peticiones por ventana de 10 s, y la ventana se reinicia solo cuando pasan 10 s desde la
 * **última petición admitida** (`decideConsume` en `better-auth/api/rate-limiter`); una petición
 * bloqueada no la mueve. Con tráfico continuo cada ~10 s la ventana nunca se reinicia y la cuarta
 * recibe 429. El proxy no reenvía la IP del navegador, así que todos los e2e cuentan como una sola
 * IP, y el estado se comparte entre archivos y corridas en un archivo temporal. Se lleva la misma
 * contabilidad que el servidor, por ruta y con margen para la latencia y el reloj del servidor:
 * hasta 3 seguidas y después una pausa de 12 s desde la última.
 */
const AUTH_WINDOW_MS = 10_000
const AUTH_MARGIN_MS = 2_000
const AUTH_MAX_IN_WINDOW = 3
type AuthPath = 'sign-in' | 'sign-up'
interface PaceState { count: number, last: number }
type PaceFile = Partial<Record<AuthPath, PaceState>>

const paceFile = join(tmpdir(), 'cloudy-e2e-auth.json')

function readPace(): PaceFile {
  try {
    const parsed: unknown = existsSync(paceFile) ? JSON.parse(readFileSync(paceFile, 'utf8')) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PaceFile : {}
  }
  catch {
    return {}
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function paceAuthRequest(path: AuthPath) {
  for (;;) {
    const state = readPace()
    const current = state[path]
    const now = Date.now()
    if (!current || now - current.last >= AUTH_WINDOW_MS + AUTH_MARGIN_MS) state[path] = { count: 1, last: now }
    else if (current.count < AUTH_MAX_IN_WINDOW) state[path] = { count: current.count + 1, last: now }
    else {
      await sleep(current.last + AUTH_WINDOW_MS + AUTH_MARGIN_MS - now)
      continue
    }
    writeFileSync(paceFile, JSON.stringify(state))
    return
  }
}

/** Neon Auth respondió 429 igualmente (p. ej. tráfico ajeno a esta corrida): se asume la ventana llena. */
function markLimited(path: AuthPath) {
  const state = readPace()
  state[path] = { count: AUTH_MAX_IN_WINDOW, last: Date.now() }
  writeFileSync(paceFile, JSON.stringify(state))
}

export async function registerViaUi(page: Page, { name = 'Persona de prueba', email, password = PASSWORD }: Credentials) {
  await page.goto(`${E2E_URL}/registro`)
  await waitForHydration(page)
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByLabel('Confirmar contraseña').fill(password)
  await paceAuthRequest('sign-up')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  const alert = page.getByRole('alert')
  await Promise.race([
    page.waitForURL(url => !url.pathname.startsWith('/registro')),
    alert.waitFor({ state: 'visible' }).then(async () => {
      throw new Error(`El registro de ${email} falló: ${await alert.innerText()}`)
    }),
  ])
}

export async function login(page: Page, { email, password = PASSWORD }: Credentials, path = '/login') {
  await page.goto(`${E2E_URL}${path}`)
  await waitForHydration(page)
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña').fill(password)
  const alert = page.getByRole('alert')
  // `path` puede traer query (`/login?redirect=…`): se compara solo la ruta.
  const loginPath = new URL(path, E2E_URL).pathname
  for (let attempt = 0; ; attempt++) {
    await paceAuthRequest('sign-in')
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()
    // Si el servidor responde con un error, se informa su texto en vez de esperar 30 s a ciegas.
    const failure = await Promise.race([
      page.waitForURL(url => !url.pathname.startsWith(loginPath)).then(() => null),
      alert.waitFor({ state: 'visible' }).then(() => alert.innerText()),
    ])
    if (failure === null) return
    // Un 429 de Neon Auth se reintenta una vez tras esperar su ventana; cualquier otro error es real.
    // La página traduce el 429 en app/utils/auth-errors.ts («Demasiados intentos, …»).
    if (attempt === 0 && failure.includes('Demasiados intentos')) {
      markLimited('sign-in')
      continue
    }
    throw new Error(`El login de ${email} falló: ${failure}`)
  }
}

/** Cambia el estado/rol directamente en la BD de pruebas (simula la aprobación del admin). */
export async function setProfile(targetEmail: string, values: { status: 'pending' | 'active' | 'disabled' | 'removed', role: 'admin' | 'editor' | null }) {
  const sql = testSql()
  await sql`UPDATE profiles SET status = ${values.status}, role = ${values.role}, updated_at = now() WHERE email = ${targetEmail}`
}

/** id de Neon Auth del perfil con ese correo; existe desde la primera petición autenticada. */
export async function profileUserId(targetEmail: string): Promise<string> {
  const [row] = await testSql()`SELECT user_id FROM profiles WHERE email = ${targetEmail}`
  if (!row) throw new Error(`No existe el perfil ${targetEmail}`)
  return row.user_id as string
}

export async function seedFolder(name: string, owner: string, parentId: string | null = null): Promise<string> {
  const [row] = await testSql()`INSERT INTO folders (name, parent_id, created_by) VALUES (${name}, ${parentId}, ${owner}) RETURNING id`
  return row!.id as string
}

/** Extensiones variadas para que las listas sembradas mezclen todas las categorías. */
const SEED_EXTENSIONS = ['jpg', 'png', 'mp3', 'wav', 'mp4', 'mov', 'pptx', 'pdf', 'docx', 'txt']

/**
 * Siembra `count` filas `ready` en una sola consulta, sin bytes en el bucket. Sin `thumb_key`, las
 * tarjetas muestran el icono de la categoría y nunca piden `/thumbnail`, así que no hay 404.
 * Los nombres son `<label> <n>.<ext>` y las claves de storage van bajo `e2e/<runId>/`. Con `textContent`
 * (feature 002) cada fila con texto queda leída (`text_status = 'ready'`), como una imagen ya procesada.
 */
export async function seedFiles(
  owner: string,
  folderId: string | null,
  count: number,
  label: string,
  { textContent }: { textContent?: (index: number) => string | null } = {},
): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID())
  const names = ids.map((_, i) => `${label} ${String(i + 1).padStart(3, '0')}.${SEED_EXTENSIONS[i % SEED_EXTENSIONS.length]}`)
  const exts = names.map(getExtension)
  const types = exts.map(ext => ALLOWED_TYPES[ext]!)
  await testSql().query(
    `INSERT INTO files (id, folder_id, name, extension, mime_type, category, size_bytes, storage_key, upload_status, origin, uploaded_by,
       text_content, text_status)
     SELECT id::uuid, $2::uuid, name, extension, mime_type, category::file_category, size_bytes, storage_key, 'ready', 'team', $9,
       text_content, CASE WHEN text_content IS NULL THEN NULL ELSE 'ready'::image_text_status END
     FROM unnest($1::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::text[], $10::text[])
       AS t(id, name, extension, mime_type, category, size_bytes, storage_key, text_content)`,
    [
      ids,
      folderId,
      names,
      exts,
      types.map(type => type.mimes[0]),
      types.map(type => type.category),
      ids.map((_, i) => 1000 + i),
      ids.map(id => `e2e/${runId()}/files/${id}`),
      owner,
      ids.map((_, i) => textContent?.(i) ?? null),
    ],
  )
  return ids
}

function cookieHeader(res: Response): string {
  return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

async function authPost(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${E2E_URL}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: E2E_URL },
    body: JSON.stringify(body),
  })
}

/**
 * Crea la identidad en Neon Auth (o reutiliza la existente) y su perfil en la BD de pruebas,
 * sin pasar por la UI. Devuelve la cookie de sesión.
 */
export async function ensureAccount({ name = 'Persona de prueba', email, password = PASSWORD }: Credentials): Promise<string> {
  // Con un 429 de Neon Auth se espera su ventana y se reintenta una vez (ver paceAuthRequest).
  const post = async (path: AuthPath, body: Record<string, string>) => {
    await paceAuthRequest(path)
    let res = await authPost(`${path}/email`, body)
    if (res.status === 429) {
      markLimited(path)
      await paceAuthRequest(path)
      res = await authPost(`${path}/email`, body)
    }
    return res
  }
  let res = await post('sign-up', { name, email, password })
  if (!res.ok) res = await post('sign-in', { email, password })
  if (!res.ok) throw new Error(`No se pudo preparar la cuenta ${email}: ${res.status}`)
  const cookie = cookieHeader(res)
  // La primera petición autenticada crea el perfil (FR-002).
  await fetch(`${E2E_URL}/api/me`, { headers: { cookie } })
  return cookie
}

/**
 * Sesiones ya abiertas por `signedInAs` en este proceso (archivo de pruebas), por correo. Además de la ventana de
 * 3 por 10 s, Neon Auth corta `sign-in` por varios minutos cuando hay muchos seguidos (observado: 429 con
 * `retry-after` ≈ 250 s, que el reintento de `login` no puede esperar). Por eso cada cuenta se prepara e inicia
 * sesión por la UI una sola vez por archivo y las pruebas siguientes reutilizan sus cookies. El rol y el estado se
 * leen de `profiles` en cada petición, así que `setProfile` sigue valiendo con la sesión reutilizada.
 */
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>()

/** Prepara una cuenta activa con el rol indicado y deja `page` con su sesión, en la portada como tras el login. */
export async function signedInAs(page: Page, role: 'admin' | 'editor', label: string = role): Promise<Credentials> {
  const creds = { name: `E2E ${label}`, email: email(label) }
  const saved = sessions.get(creds.email)
  if (!saved) await ensureAccount(creds)
  await setProfile(creds.email, { status: 'active', role })
  const context = page.context()
  await context.clearCookies()
  if (saved) {
    await context.addCookies(saved)
    // Si otra prueba cerró esa sesión, se inicia una nueva por la UI.
    if ((await page.request.get(`${E2E_URL}/api/me`)).ok()) {
      await page.goto(`${E2E_URL}/`)
      await waitForHydration(page)
      return creds
    }
    await context.clearCookies()
  }
  await login(page, creds)
  sessions.set(creds.email, await context.cookies())
  return creds
}

// ---------------------------------------------------------------- texto de las imágenes (feature 002)

/** Control del stub de OpenRouter que levanta `global-setup.ts` (research A9). */
async function stubRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${inject('aiStubUrl')}${path}`, body === undefined
    ? {}
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return res.json() as Promise<T>
}

export type { PrayerCall, StubCalls, StubMode } from './openrouter-stub'

export const stubCalls = () => stubRequest<StubCalls>('/__stub/calls')
/** Generaciones de imágenes de peticiones (feature 007) que recibió el stub, en orden. */
export const prayerCalls = async () => (await stubCalls()).prayer
/** Reemplaza el modo entero (lo omitido vuelve a su valor por defecto). */
export const setStubMode = (mode: Partial<StubMode>) => stubRequest('/__stub/mode', mode)
export const resetStub = () => stubRequest('/__stub/reset', {})

// ---------------------------------------------------------------- YouTube (feature 005)

async function cloudyStubRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${inject('cloudyStubUrl')}${path}`, body === undefined
    ? {}
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return res.json() as Promise<T>
}

/** Lo que el stub recibió (`cloudy-api-stub.ts`): trabajos aceptados por motor y el orden de los intentos (v2 → v1). */
export interface CloudyStubCalls {
  jobsCreated: { v1: number, v2: number }
  createAttempts: ('v1' | 'v2')[]
  probes: ('v1' | 'v2')[]
  unauthorized: number
  formats: string[]
  /** Presentaciones pedidas (feature 006): título y color de letra recibidos. */
  pptx: { title: string, fontColor: string | null, html: string }[]
  /** Lotes pedidos (`POST /v1/lyrics/pptx/batch`): las canciones de cada uno, en orden. */
  pptxBatch: { title: string, fontColor: string | null, html: string }[][]
}

/** `asleep`: el stub responde 502 a todo, como Render mientras levanta la instancia. */
export const setCloudyStubState = (state: 'up' | 'asleep' | 'degraded' | 'v2-missing') => cloudyStubRequest('/__stub/state', { state })
export const cloudyStubCalls = () => cloudyStubRequest<CloudyStubCalls>('/__stub/calls')
export const resetCloudyStub = () => cloudyStubRequest('/__stub/reset', {})

/**
 * Las miniaturas apuntan a `i.ytimg.com` como las reales; en los e2e se sirven desde un fixture local para que el
 * navegador nunca contacte a YouTube.
 */
export async function routeYoutubeThumbnails(page: Page | BrowserContext) {
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ path: fixture('foto.jpg'), contentType: 'image/jpeg' }))
}

/**
 * El reproductor incrusta `youtube-nocookie.com/embed/<id>`; en los e2e el iframe responde una página mínima local
 * (con el ID visible) para que el navegador nunca contacte a YouTube.
 */
/** Con un `BrowserContext` también cubre las ventanas que abra la página (se instala antes de que existan). */
export async function routeYoutubeEmbed(page: Page | BrowserContext) {
  await page.route('https://www.youtube-nocookie.com/embed/**', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>embed</title><p id="embed-id">${id}</p>` })
  })
}

/** Siembra `count` videos en el historial con `viewer` como quien los abrió (más reciente primero). */
export async function seedYoutubeHistory(viewer: string, count: number, prefix = 'seed'): Promise<string[]> {
  const ids = Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(11 - prefix.length, '0')}`.slice(0, 11))
  await testSql().query(
    `INSERT INTO youtube_videos (video_id, title, channel, duration_seconds, thumbnail_url, last_viewed_at, last_viewed_by)
     SELECT id, 'Video ' || id, 'Canal Cloudy', 95, 'https://i.ytimg.com/vi/' || id || '/hqdefault.jpg', now() - (n || ' seconds')::interval, $2
     FROM unnest($1::text[]) WITH ORDINALITY AS t(id, n)
     ON CONFLICT (video_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at, last_viewed_by = excluded.last_viewed_by`,
    [ids, viewer],
  )
  return ids
}

/** Deja en el historial un video concreto (un escenario del stub, p. ej. `bothBotChk1`) como lo más reciente. */
export async function seedYoutubeVideo(viewer: string, videoId: string, title: string): Promise<void> {
  await testSql().query(
    `INSERT INTO youtube_videos (video_id, title, channel, duration_seconds, thumbnail_url, last_viewed_at, last_viewed_by)
     VALUES ($1, $2, 'Canal Cloudy', 95, 'https://i.ytimg.com/vi/' || $1 || '/hqdefault.jpg', now(), $3)
     ON CONFLICT (video_id) DO UPDATE SET title = excluded.title, last_viewed_at = excluded.last_viewed_at, last_viewed_by = excluded.last_viewed_by`,
    [videoId, title, viewer],
  )
}

/**
 * Siembra una imagen `ready` como las subidas antes de la feature (`text_status` en `NULL`): sube los
 * bytes del fixture al bucket de pruebas bajo `e2e/<runId>/` y crea la fila. Con `withBytes: false`
 * solo crea la fila (p. ej. una HEIC sin copia, que nunca se descarga).
 */
export async function seedImage(owner: string, fixtureName: string, { withBytes = true }: { withBytes?: boolean } = {}): Promise<string> {
  const id = randomUUID()
  const extension = getExtension(fixtureName)
  const type = ALLOWED_TYPES[extension]!
  const storageKey = `e2e/${runId()}/files/${id}`
  const bytes = readFileSync(fixture(fixtureName))
  if (withBytes) {
    const env = readEnvFile('test')
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({
      endpoint: env.NUXT_AWS_ENDPOINT_URL_S3,
      region: env.NUXT_AWS_REGION || 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: env.NUXT_AWS_ACCESS_KEY_ID ?? '', secretAccessKey: env.NUXT_AWS_SECRET_ACCESS_KEY ?? '' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    await s3.send(new PutObjectCommand({ Bucket: env.NUXT_S3_BUCKET, Key: storageKey, Body: bytes, ContentType: type.mimes[0] }))
  }
  await testSql()`
    INSERT INTO files (id, name, extension, mime_type, category, size_bytes, storage_key, upload_status, origin, uploaded_by)
    VALUES (${id}, ${`${id.slice(0, 8)}-${fixtureName}`}, ${extension}, ${type.mimes[0]}, ${type.category}, ${bytes.byteLength},
      ${storageKey}, 'ready', 'team', ${owner})
  `
  return id
}

/** Columnas `text_*` de un archivo, para afirmar sobre la reclamación y los intentos. */
export async function textColumns(fileId: string): Promise<{ text_status: string | null, text_attempts: number, text_content: string | null }> {
  const [row] = await testSql()`SELECT text_status, text_attempts, text_content FROM files WHERE id = ${fileId}`
  return row as { text_status: string | null, text_attempts: number, text_content: string | null }
}

// ---------------------------------------------------------------- Peticiones (feature 007)

export interface PrayerSeed {
  status?: 'approved' | 'pending' | 'rejected'
  sentAt?: Date
  /** Por defecto, ahora: lo recién sembrado sale primero en el orden por aprobación. */
  reviewedAt?: Date
  senderName?: string
  note?: string | null
  text?: string | null
  textStatus?: 'ready' | 'empty' | 'failed' | 'pending' | 'reading'
  fixtureName?: string
  deleted?: boolean
}

/** Carpeta de la corrida para las fotos de peticiones, una por dueño y proceso. */
const prayerFolders = new Map<string, Promise<string>>()

/**
 * Siembra una petición como la deja la aprobación (feature 003 + 002): un `guest_submissions` y su fila de `files` con
 * `submission_id`, `origin = 'guest'` y el texto ya leído. La foto se sube como en `seedImage`. Solo en la rama de pruebas.
 * Va a una carpeta propia («Peticiones <runId>»), como al aprobar hacia una carpeta: en la raíz, decenas de `<hex>-foto.jpg`
 * desplazaban de la primera página de Archivos (orden por nombre, 60 por página) lo que suben otros archivos e2e.
 */
export async function seedPrayerRequest(owner: string, {
  status = 'approved',
  sentAt = new Date(Date.now() - 3_600_000),
  reviewedAt = new Date(),
  senderName = `Invitado ${runId()}`,
  note = null,
  text = 'Oremos por la familia',
  textStatus = 'ready',
  fixtureName = 'foto.jpg',
  deleted = false,
}: PrayerSeed = {}): Promise<{ fileId: string, submissionId: string }> {
  const sql = testSql()
  const reviewed = status === 'pending' ? null : reviewedAt.toISOString()
  const [submission] = await sql`
    INSERT INTO guest_submissions (sender_name, note, status, sender_key, created_at, completed_at, reviewed_by, reviewed_at)
    VALUES (${senderName}, ${note}, ${status}, ${`e2e-${runId()}`}, ${sentAt.toISOString()}, ${sentAt.toISOString()},
      ${reviewed ? owner : null}, ${reviewed})
    RETURNING id
  ` as { id: string }[]
  const fileId = await seedImage(owner, fixtureName)
  // Sufijo aleatorio: cada archivo e2e es otro proceso (otro caché) y el nombre en la raíz es único.
  if (!prayerFolders.has(owner)) prayerFolders.set(owner, seedFolder(`Peticiones ${runId()} ${randomUUID().slice(0, 8)}`, owner))
  const folderId = await prayerFolders.get(owner)!
  const stored = textStatus === 'pending' ? null : textStatus
  await sql`
    UPDATE files SET folder_id = ${folderId}, origin = 'guest', uploaded_by = NULL, guest_name = ${senderName}, submission_id = ${submission!.id},
      text_status = ${stored}::image_text_status, text_content = ${textStatus === 'ready' ? text : null},
      text_started_at = ${textStatus === 'reading' ? new Date().toISOString() : null},
      text_read_at = ${textStatus === 'ready' || textStatus === 'empty' || textStatus === 'failed' ? new Date().toISOString() : null},
      text_error = ${textStatus === 'failed' ? 'provider' : null},
      deleted_at = ${deleted ? new Date().toISOString() : null}, deleted_by = ${deleted ? owner : null}, trash_root_id = ${deleted ? fileId : null}
    WHERE id = ${fileId}
  `
  return { fileId, submissionId: submission!.id }
}

// ---------------------------------------------------------------- Canciones (feature 006)

async function apifyStubRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${inject('apifyStubUrl')}${path}`, body === undefined
    ? {}
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return res.json() as Promise<T>
}

export interface ApifyStubCalls {
  /** Enlace (`query`) de cada run creado, en orden. */
  runs: string[]
  aborts: number
}

export const apifyStubCalls = () => apifyStubRequest<ApifyStubCalls>('/__stub/calls')
export const resetApifyStub = () => apifyStubRequest('/__stub/reset', {})
