// Utilidades compartidas por los e2e. Las identidades son únicas por corrida (`e2e+<runId>-…`).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'
import { inject } from 'vitest'
import type { Page } from 'playwright-core'
import { E2E_URL } from './constants'

export { E2E_URL }

export const runId = (): string => inject('runId')

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
 * Neon Auth (Better Auth) limita sign-up/sign-in por IP del lado del servidor y el proxy no le
 * reenvía la IP del navegador: todas las peticiones de los e2e cuentan como una sola IP. Se
 * espacian para no superar ese límite (≈3 cada 10 s). El registro se comparte entre archivos.
 */
const AUTH_WINDOW_MS = 10_000
const AUTH_MAX_IN_WINDOW = 2

export async function paceAuthRequest() {
  const file = join(tmpdir(), `cloudy-e2e-${runId()}-auth.json`)
  for (;;) {
    const now = Date.now()
    const recent = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as number[] : [])
      .filter(t => now - t < AUTH_WINDOW_MS)
    if (recent.length < AUTH_MAX_IN_WINDOW) {
      writeFileSync(file, JSON.stringify([...recent, now]))
      return
    }
    await new Promise(resolve => setTimeout(resolve, AUTH_WINDOW_MS - (now - recent[0]!) + 50))
  }
}

export async function registerViaUi(page: Page, { name = 'Persona de prueba', email, password = PASSWORD }: Credentials) {
  await page.goto(`${E2E_URL}/registro`)
  await waitForHydration(page)
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByLabel('Confirmar contraseña').fill(password)
  await paceAuthRequest()
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
  await paceAuthRequest()
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  // Si el servidor responde con un error, se informa su texto en vez de esperar 30 s a ciegas.
  const alert = page.getByRole('alert')
  await Promise.race([
    page.waitForURL(url => !url.pathname.startsWith('/login')),
    alert.waitFor({ state: 'visible' }).then(async () => {
      throw new Error(`El login de ${email} falló: ${await alert.innerText()}`)
    }),
  ])
}

/** Cambia el estado/rol directamente en la BD de pruebas (simula la aprobación del admin). */
export async function setProfile(targetEmail: string, values: { status: 'pending' | 'active' | 'disabled' | 'removed', role: 'admin' | 'editor' | null }) {
  const sql = neon(process.env.NUXT_TEST_DATABASE_URL!)
  await sql`UPDATE profiles SET status = ${values.status}, role = ${values.role}, updated_at = now() WHERE email = ${targetEmail}`
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
  await paceAuthRequest()
  let res = await authPost('sign-up/email', { name, email, password })
  if (!res.ok) {
    await paceAuthRequest()
    res = await authPost('sign-in/email', { email, password })
  }
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
