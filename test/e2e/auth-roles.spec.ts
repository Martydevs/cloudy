// US2 — Registro, inicio de sesión y acceso por rol.
import { neon } from '@neondatabase/serverless'
import { createPage, setup } from '@nuxt/test-utils/e2e'
import { beforeAll, describe, expect, it } from 'vitest'
import { E2E_URL, email, login, registerViaUi, setProfile, testSql } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

describe('US2 · registro y acceso por rol', () => {
  const admin = { name: 'Primera Admin', email: email('us2-admin') }
  const member = { name: 'Segundo Miembro', email: email('us2-member') }

  beforeAll(async () => {
    // El primer perfil del sistema es admin (FR-002): se parte de una tabla vacía.
    await testSql()`TRUNCATE profiles CASCADE`
  })

  it('el primer registro entra como administrador', async () => {
    const page = await createPage('/registro')
    await registerViaUi(page, admin)
    expect(new URL(page.url()).pathname).toBe('/')
    // La sección "Usuarios" llega con US4; aquí se comprueba el rol en Mi perfil.
    await page.goto(`${E2E_URL}/perfil`)
    await expect.poll(() => page.getByText('Administrador').isVisible()).toBe(true)
    await page.close()
  })

  it('el segundo registro queda pendiente de aprobación', async () => {
    const page = await createPage('/registro')
    await registerViaUi(page, member)
    expect(new URL(page.url()).pathname).toBe('/pendiente')
    await expect.poll(() => page.getByText('pendiente de aprobación').isVisible()).toBe(true)

    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await page.waitForURL(url => url.pathname === '/login')
    await page.close()
  })

  it('una vez activado como editor entra al inicio sin ver "Usuarios"', async () => {
    await setProfile(member.email, { status: 'active', role: 'editor' })
    const page = await createPage('/login')
    await login(page, member)
    expect(new URL(page.url()).pathname).toBe('/')
    await expect.poll(() => page.getByRole('link', { name: 'Archivos' }).first().isVisible()).toBe(true)
    expect(await page.getByRole('link', { name: 'Usuarios' }).count()).toBe(0)

    // Cerrar sesión y volver a una ruta privada lleva a login con redirect.
    await page.getByRole('button', { name: 'Menú de usuario' }).click()
    await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
    await page.waitForURL(url => url.pathname === '/login')
    await page.goto(`${E2E_URL}/archivos`)
    await page.waitForURL(url => url.pathname === '/login')
    expect(new URL(page.url()).search).toBe('?redirect=%2Farchivos')
    await page.close()
  })

  it('un usuario desactivado ve el aviso de cuenta desactivada', async () => {
    const page = await createPage('/login')
    await login(page, member)
    await setProfile(member.email, { status: 'disabled', role: 'editor' })
    await page.goto(`${E2E_URL}/`)
    await page.waitForURL(url => url.pathname === '/pendiente')
    await expect.poll(() => page.getByText('desactivada').isVisible()).toBe(true)
    await page.close()
  })

  it('credenciales incorrectas muestran un error claro', async () => {
    const page = await createPage('/login')
    await page.getByLabel('Correo electrónico').fill(admin.email)
    await page.getByLabel('Contraseña').fill('contraseña-equivocada')
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()
    await expect.poll(() => page.getByText('Correo o contraseña incorrectos').isVisible()).toBe(true)
    await page.close()
  })
})
