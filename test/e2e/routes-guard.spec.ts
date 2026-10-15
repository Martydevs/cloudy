// US6 — Protección de rutas, retorno tras login, acceso denegado y 404.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { E2E_URL, ensureAccount, email, login, setProfile, signedInAs } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

// /papelera se agrega con su historia (US7).
const PRIVATE_ROUTES = ['/', '/archivos', '/archivos/ver/00000000-0000-0000-0000-000000000000', '/perfil', '/usuarios', '/actividad', '/pendientes']

describe('US6 · protección de rutas', () => {
  it.each(PRIVATE_ROUTES)('sin sesión, %s lleva a login con redirect', async (path) => {
    const page = await createPage()
    await page.goto(`${E2E_URL}${path}`)
    await page.waitForURL(url => url.pathname === '/login')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe(path)
    await page.close()
  })

  it('una ruta profunda se conserva tras iniciar sesión', async () => {
    const creds = { name: 'E2E guard', email: email('guard-deep') }
    await ensureAccount(creds)
    await setProfile(creds.email, { status: 'active', role: 'editor' })

    const page = await createPage()
    const deep = '/archivos?q=domingo'
    await page.goto(`${E2E_URL}${deep}`)
    await page.waitForURL(url => url.pathname === '/login')
    await login(page, creds, new URL(page.url()).pathname + new URL(page.url()).search)
    await page.waitForURL(url => url.pathname === '/archivos')
    expect(new URL(page.url()).searchParams.get('q')).toBe('domingo')
    await page.close()
  })

  it('con sesión, /login y /registro llevan al inicio', async () => {
    const page = await createPage()
    await signedInAs(page, 'editor', 'guard-editor')
    for (const path of ['/login', '/registro']) {
      await page.goto(`${E2E_URL}${path}`)
      await page.waitForURL(url => url.pathname === '/')
    }
    await page.close()
  })

  it('un editor en una ruta de admin ve "Acceso denegado" y las APIs de admin responden 403 (T127)', async () => {
    const page = await createPage()
    await signedInAs(page, 'editor', 'guard-editor')
    for (const path of ['/usuarios', '/actividad']) {
      await page.goto(`${E2E_URL}${path}`)
      await page.waitForURL(url => url.pathname === '/acceso-denegado')
      await expect.poll(() => page.getByText('No tienes permiso para ver esta página').isVisible()).toBe(true)
    }
    await page.getByRole('link', { name: 'Volver al inicio' }).click()
    await page.waitForURL(url => url.pathname === '/')

    const cookie = (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ')
    for (const path of ['/api/users', '/api/activity']) {
      expect((await fetch(`${E2E_URL}${path}`, { headers: { cookie } })).status).toBe(403)
    }
    await page.close()
  })

  it('una ruta inexistente muestra "Página no encontrada"', async () => {
    const page = await createPage()
    const res = await page.goto(`${E2E_URL}/no-existe`)
    expect(res?.status()).toBe(404)
    await expect.poll(() => page.getByRole('heading', { name: 'Página no encontrada' }).isVisible()).toBe(true)
    await page.close()
  })

  it('un redirect externo se ignora', async () => {
    const creds = { name: 'E2E guard evil', email: email('guard-evil') }
    await ensureAccount(creds)
    await setProfile(creds.email, { status: 'active', role: 'editor' })
    const page = await createPage()
    await login(page, creds, '/login?redirect=//evil.com')
    expect(new URL(page.url()).origin).toBe(E2E_URL)
    expect(new URL(page.url()).pathname).toBe('/')
    await page.close()
  })

  it('las APIs protegidas responden 401 sin sesión y 403 con cuenta pendiente', async () => {
    expect((await fetch(`${E2E_URL}/api/me`)).status).toBe(401)
    expect((await fetch(`${E2E_URL}/api/dashboard`)).status).toBe(401)
    expect((await fetch(`${E2E_URL}/api/folders/root/children`)).status).toBe(401)

    const creds = { name: 'E2E guard pending', email: email('guard-pending') }
    const cookie = await ensureAccount(creds)
    await setProfile(creds.email, { status: 'pending', role: null })
    const res = await fetch(`${E2E_URL}/api/dashboard`, { headers: { cookie } })
    expect(res.status).toBe(403)
    expect((await res.json()).data.reason).toBe('pending')
  })
})
