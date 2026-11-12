// US6 — Protección de rutas, retorno tras login, acceso denegado y 404.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { E2E_URL, ensureAccount, email, login, setProfile, signedInAs } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

const PRIVATE_ROUTES = [
  '/', '/archivos', '/archivos/ver/00000000-0000-0000-0000-000000000000', '/perfil', '/usuarios', '/actividad', '/solicitudes', '/papelera',
  // Página YouTube (feature 005).
  '/youtube', '/youtube/okShortVid1', '/youtube/okShortVid1/ventana',
  // Página Canciones (feature 006).
  '/canciones', '/canciones/00000000-0000-0000-0000-000000000000',
  // Página Peticiones (feature 007).
  '/peticiones',
]

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
    // Los cambios de varias cuentas a la vez también son solo de administradores (y se rechazan antes de validar).
    const batch = (headers: Record<string, string>) => fetch(`${E2E_URL}/api/users/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ ids: ['nadie'], action: 'disable' }),
    })
    expect((await batch({ cookie })).status).toBe(403)
    expect((await batch({})).status).toBe(401)
    await page.close()
  })

  it('feature 003: /upload es pública y de un solo paso, /enviar redirige a /upload, /solicitudes manda a /pendiente con cuenta pendiente y /pendientes redirige', async () => {
    const anonymous = await createPage()
    const res = await anonymous.goto(`${E2E_URL}/upload`)
    expect(res?.status()).toBe(200)
    expect(new URL(anonymous.url()).pathname).toBe('/upload')
    await expect.poll(() => anonymous.getByLabel('Elegir archivos', { exact: true }).count()).toBe(1)
    expect(await anonymous.getByRole('button', { name: 'Pedir acceso' }).count()).toBe(0)
    await anonymous.close()

    // El enlace antiguo para invitados sigue funcionando: 301 permanente hacia /upload.
    const legacy = await fetch(`${E2E_URL}/enviar`, { redirect: 'manual' })
    expect(legacy.status).toBe(301)
    expect(new URL(legacy.headers.get('location') ?? '', E2E_URL).pathname).toBe('/upload')
    // La solicitud de acceso se retiró: sus endpoints públicos ya no existen.
    expect((await fetch(`${E2E_URL}/api/public/access/current`)).status).toBe(404)

    const creds = { name: 'E2E guard pending page', email: email('guard-pending-page') }
    await ensureAccount(creds)
    await setProfile(creds.email, { status: 'pending', role: null })
    const pending = await createPage()
    await login(pending, creds)
    await pending.goto(`${E2E_URL}/solicitudes`)
    await pending.waitForURL(url => url.pathname === '/pendiente')
    await pending.close()

    // La ruta vieja redirige con 301 (FR-024) y, con sesión, llega a la página nueva.
    const moved = await fetch(`${E2E_URL}/pendientes`, { redirect: 'manual' })
    expect(moved.status).toBe(301)
    expect(new URL(moved.headers.get('location')!, E2E_URL).pathname).toBe('/solicitudes')
    const editor = await createPage()
    await signedInAs(editor, 'editor', 'guard-editor')
    await editor.goto(`${E2E_URL}/pendientes`)
    await editor.waitForURL(url => url.pathname === '/solicitudes')
    await expect.poll(() => editor.getByRole('heading', { name: 'Solicitudes', exact: true }).isVisible()).toBe(true)
    await editor.close()
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

    // Comentarios (US8): sin sesión 401 y con cuenta pendiente 403, antes de validar nada.
    const id = '00000000-0000-0000-0000-000000000000'
    const commentRoutes = [
      ['GET', `/api/files/${id}/comments`],
      ['POST', `/api/files/${id}/comments`],
      ['PATCH', `/api/comments/${id}`],
      ['DELETE', `/api/comments/${id}`],
      // Selección múltiple de Archivos.
      ['POST', '/api/items/trash'],
      // Texto de las imágenes (feature 002).
      ['GET', `/api/files/${id}/text`],
      ['POST', `/api/files/${id}/text`],
      ['PATCH', `/api/files/${id}/text`],
      ['GET', `/api/submissions/${id}/files/${id}/text`],
      ['POST', `/api/submissions/${id}/files/${id}/text`],
      // Página YouTube (feature 005).
      ['GET', '/api/youtube/health'],
      ['GET', '/api/youtube/videos/okShortVid1'],
      ['POST', '/api/youtube/jobs'],
      ['GET', `/api/youtube/jobs/${'a'.repeat(32)}`],
      ['DELETE', `/api/youtube/jobs/${'a'.repeat(32)}`],
      ['GET', '/api/youtube/history'],
      ['DELETE', '/api/youtube/history/okShortVid1'],
      ['GET', '/api/youtube/downloads'],
      ['POST', '/api/youtube/downloads'],
      ['GET', '/api/youtube/playlists'],
      ['POST', '/api/youtube/playlists'],
      ['GET', `/api/youtube/playlists/${id}`],
      ['PATCH', `/api/youtube/playlists/${id}`],
      ['DELETE', `/api/youtube/playlists/${id}`],
      ['POST', `/api/youtube/playlists/${id}/items`],
      ['DELETE', `/api/youtube/playlists/${id}/items/okShortVid1`],
      // Página Canciones (feature 006): los 13 endpoints.
      ['POST', '/api/songs/fetch'],
      ['GET', `/api/songs/${id}`],
      ['POST', `/api/songs/${id}/refresh`],
      ['POST', `/api/songs/${id}/pptx`],
      ['GET', '/api/songs/history'],
      ['DELETE', `/api/songs/history/${id}`],
      ['GET', '/api/songs/collections'],
      ['POST', '/api/songs/collections'],
      ['GET', `/api/songs/collections/${id}`],
      ['PATCH', `/api/songs/collections/${id}`],
      ['DELETE', `/api/songs/collections/${id}`],
      ['POST', `/api/songs/collections/${id}/items`],
      ['DELETE', `/api/songs/collections/${id}/items/${id}`],
      // Página Peticiones (feature 007).
      ['GET', '/api/peticiones'],
      ['POST', '/api/peticiones/imagenes'],
    ] as const
    for (const [method, path] of commentRoutes) {
      const init: { method: string, headers: Record<string, string>, body?: string } = method === 'GET' || method === 'DELETE'
        ? { method, headers: {} }
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Hola' }) }
      expect((await fetch(`${E2E_URL}${path}`, init)).status, `${method} ${path} sin sesión`).toBe(401)
      const pending = await fetch(`${E2E_URL}${path}`, { ...init, headers: { ...init.headers, cookie } })
      expect(pending.status, `${method} ${path} pendiente`).toBe(403)
    }
  })
})
