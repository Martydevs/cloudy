// Utilidades compartidas por los e2e. Las identidades son únicas por corrida (`e2e+<runId>-…`).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { inject } from 'vitest'
import type { Page } from 'playwright-core'
import { ALLOWED_TYPES, getExtension } from '../../../shared/constants/files'
import { readEnvFile, requireVar } from '../../../scripts/env'
import { E2E_URL } from './constants'

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

/** Prepara una cuenta activa con el rol indicado e inicia sesión con ella en `page` por la UI. */
export async function signedInAs(page: Page, role: 'admin' | 'editor', label: string = role): Promise<Credentials> {
  const creds = { name: `E2E ${label}`, email: email(label) }
  await ensureAccount(creds)
  await setProfile(creds.email, { status: 'active', role })
  await page.context().clearCookies()
  await login(page, creds)
  return creds
}

// ---------------------------------------------------------------- texto de las imágenes (feature 002)

/** Control del stub de OpenAI que levanta `global-setup.ts` (research A9). */
async function stubRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${inject('openaiStubUrl')}${path}`, body === undefined
    ? {}
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return res.json() as Promise<T>
}

export interface StubCalls {
  total: number
  byImage: Record<string, number>
}

export const stubCalls = () => stubRequest<StubCalls>('/__stub/calls')
export const setStubMode = (mode: { fail?: boolean, delayMs?: number }) => stubRequest('/__stub/mode', mode)
export const resetStub = () => stubRequest('/__stub/reset', {})

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
