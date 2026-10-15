// US4 — Gestión de usuarios (solo administrador) y registro de actividad.
import { createPage, setup } from '@nuxt/test-utils/e2e'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { E2E_URL, email, ensureAccount, login, setProfile, signedInAs, testSql, waitForHydration } from './setup/fixtures'

await setup({ host: E2E_URL, browser: true })

describe('US4 · gestión de usuarios', () => {
  const member = { name: 'Luis Pendiente', email: email('us4-member') }
  let adminPage: Page
  let adminEmail = ''

  const memberRow = () => adminPage.getByRole('row').filter({ hasText: member.email })

  beforeAll(async () => {
    await ensureAccount(member)
    await setProfile(member.email, { status: 'pending', role: null })
    adminPage = await createPage()
    adminEmail = (await signedInAs(adminPage, 'admin', 'us4-admin')).email
  })

  it('el pendiente aparece destacado, con el contador en el menú, y se activa como editor', async () => {
    // El contador llega por el pulso (≤ 3 s).
    await expect.poll(() => adminPage.getByRole('link', { name: /Usuarios/ }).innerText(), { timeout: 10_000 }).toMatch(/\d/)

    await adminPage.goto(`${E2E_URL}/usuarios`)
    await waitForHydration(adminPage)
    await expect.poll(() => memberRow().isVisible()).toBe(true)
    expect(await memberRow().getByText('Pendiente', { exact: true }).isVisible()).toBe(true)

    await memberRow().getByLabel(`Rol para ${member.name}`).selectOption('editor')
    await memberRow().getByRole('button', { name: 'Activar' }).click()
    await expect.poll(() => adminPage.getByText('ya puede entrar como editor').isVisible()).toBe(true)
    await expect.poll(() => memberRow().getByText('Activo', { exact: true }).isVisible()).toBe(true)

    // El editor entra.
    const memberPage = await createPage()
    await login(memberPage, member)
    expect(new URL(memberPage.url()).pathname).toBe('/')
    await memberPage.close()
  })

  it('al desactivarlo, el editor termina en /pendiente en segundos', async () => {
    const memberPage = await createPage()
    await login(memberPage, member)
    await expect.poll(() => memberPage.getByRole('link', { name: 'Archivos' }).first().isVisible()).toBe(true)

    await memberRow().getByRole('button', { name: 'Desactivar' }).click()
    await expect.poll(() => memberRow().getByText('Desactivado', { exact: true }).isVisible()).toBe(true)
    // El pulso del editor responde 403 y lo lleva a /pendiente sin que navegue.
    await memberPage.waitForURL(url => url.pathname === '/pendiente', { timeout: 10_000 })
    await expect.poll(() => memberPage.getByText('desactivada').isVisible()).toBe(true)
    await memberPage.close()

    await memberRow().getByRole('button', { name: 'Reactivar' }).click()
    await expect.poll(() => memberRow().getByText('Activo', { exact: true }).isVisible()).toBe(true)
  })

  it('cambia el rol de editor a admin y de vuelta', async () => {
    await memberRow().getByLabel(`Rol de ${member.name}`).selectOption('admin')
    await expect.poll(() => adminPage.getByText(`${member.name} ahora es administrador`).isVisible()).toBe(true)
    await expect.poll(() => memberRow().locator('.badge', { hasText: 'Administrador' }).isVisible()).toBe(true)
    await memberRow().getByLabel(`Rol de ${member.name}`).selectOption('editor')
    await expect.poll(() => memberRow().locator('.badge', { hasText: 'Editor' }).isVisible()).toBe(true)
  })

  it('el único administrador activo no puede desactivarse ni quitarse el rol', async () => {
    // Otros archivos de prueba pueden haber creado admins: en la rama de pruebas se convierten en editores.
    await testSql()`UPDATE profiles SET role = 'editor', updated_at = now() WHERE role = 'admin' AND status = 'active' AND email <> ${adminEmail}`
    const selfRow = adminPage.getByRole('row').filter({ hasText: adminEmail })
    await selfRow.getByRole('button', { name: 'Desactivar' }).click()
    await expect.poll(() => adminPage.getByText('Debe existir al menos un administrador activo').isVisible()).toBe(true)
    await expect.poll(() => selfRow.getByText('Activo', { exact: true }).isVisible()).toBe(true)
  })

  it('al eliminarlo, el usuario ve el aviso de cuenta eliminada', async () => {
    const memberPage = await createPage()
    await login(memberPage, member)

    await memberRow().getByRole('button', { name: `Eliminar a ${member.name}` }).click()
    await adminPage.getByRole('button', { name: 'Eliminar cuenta' }).click()
    await expect.poll(() => adminPage.getByText(`La cuenta de ${member.name} fue eliminada`).isVisible()).toBe(true)
    await expect.poll(() => memberRow().count()).toBe(0)

    await memberPage.waitForURL(url => url.pathname === '/pendiente', { timeout: 10_000 })
    await expect.poll(() => memberPage.getByText('Tu cuenta fue eliminada').isVisible()).toBe(true)
    await memberPage.close()
  })

  it('/actividad lista la activación y el cambio de rol', async () => {
    await adminPage.goto(`${E2E_URL}/actividad`)
    await waitForHydration(adminPage)
    const list = adminPage.getByRole('list', { name: 'Actividad' })
    await expect.poll(() => list.getByText(`activó la cuenta de ${member.name}`).first().isVisible()).toBe(true)
    await expect.poll(() => list.getByText(`cambió el rol de ${member.name}`).first().isVisible()).toBe(true)
    await adminPage.getByLabel('Acción').selectOption('user.remove')
    await expect.poll(() => list.getByText(`eliminó la cuenta de ${member.name}`).isVisible()).toBe(true)
    await adminPage.close()
  })
})
