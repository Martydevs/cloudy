import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import type { DashboardSummary, Me } from '#shared/types/api'
import AccesoDenegadoPage from '~/pages/acceso-denegado.vue'
import App from '~/app.vue'
import AppTopbar from '~/components/app/AppTopbar.vue'
import AuthLayout from '~/layouts/auth.vue'
import DashboardLayout from '~/layouts/dashboard.vue'
import ErrorPage from '~/error.vue'
import HomePage from '~/pages/index.vue'
import LoginPage from '~/pages/login.vue'
import PendientePage from '~/pages/pendiente.vue'
import PerfilPage from '~/pages/perfil.vue'
import PublicLayout from '~/layouts/public.vue'
import RecuperarPage from '~/pages/recuperar.vue'
import RegistroPage from '~/pages/registro.vue'
import RestablecerPage from '~/pages/restablecer.vue'
import authMiddleware from '~/middleware/auth.global'
import { AuthRequestError } from '~/composables/useAuthClient'
import type { Queryable, QueryableWithGet } from './helpers/api'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const { navigateToMock, clearErrorMock, client, loggingOut } = await vi.hoisted(async () => ({
  navigateToMock: vi.fn(),
  clearErrorMock: vi.fn(),
  client: {
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    logout: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
    updateUser: vi.fn(),
  },
  loggingOut: (await import('vue')).ref(false),
}))
mockNuxtImport('navigateTo', () => navigateToMock)
mockNuxtImport('clearError', () => clearErrorMock)
mockNuxtImport('useAuthClient', () => () => ({ ...client, loggingOut }))

const profile = (changes: Partial<Me['profile']> = {}): Me['profile'] => ({
  userId: 'u1', email: 'ana@iglesia.org', name: 'Ana Pérez', role: 'editor', status: 'active', createdAt: '', ...changes,
})
const setMe = (changes: Partial<Me['profile']> = {}) => {
  useMe().me.value = { user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana Pérez' }, profile: profile(changes) }
}

const summary = (changes: Partial<DashboardSummary> = {}): DashboardSummary => ({
  recentFiles: [],
  pendingCount: 0,
  openAccessRequests: 0,
  totalsByCategory: {
    image: { count: 3, bytes: 3072 }, audio: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 },
    presentation: { count: 0, bytes: 0 }, document: { count: 0, bytes: 0 },
  },
  storage: { activeBytes: 3072, trashBytes: 1024 },
  ...changes,
})

async function fill(wrapper: QueryableWithGet, label: string, value: string) {
  const labelEl = wrapper.findAll('label').find(l => l.text().trim() === label)!
  await wrapper.get(`#${labelEl.attributes('for')}`).setValue(value)
}

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]!

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  navigateToMock.mockReset()
  clearErrorMock.mockReset()
  for (const fn of Object.values(client)) fn.mockReset()
  loggingOut.value = false
  useToast().toasts.value = []
  setMe()
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/realtime/pulse', { cursor: '2026-10-14T10:00:00.000Z', pendingCount: 0, newSubmissions: [] })
})

describe('Inicio', () => {
  it('saluda y muestra resumen, tipos y estado vacío de recientes', async () => {
    mockApi('GET', '/api/dashboard', summary({ pendingCount: 2 }))
    const wrapper = await mountSuspended(HomePage)
    await flush()
    expect(wrapper.get('h1').text()).toBe('Hola, Ana')
    expect(wrapper.text()).toContain('Solicitudes por atender')
    expect(wrapper.findAll('a[href="/solicitudes"]').map(a => a.text())).toEqual(expect.arrayContaining(['Ver solicitudes']))
    expect(wrapper.text()).toContain('3 KB')
    expect(wrapper.text()).toContain('Imágenes')
    expect(wrapper.text()).toContain('Sube tu primer archivo')
    await button(wrapper, 'Subir archivo').trigger('click')
    expect(useUploadDialog()).toMatchObject({ isOpen: { value: true }, folderId: { value: null } })
    useUploadDialog().close()
  })

  it('lista los archivos recientes', async () => {
    mockApi('GET', '/api/dashboard', summary({
      recentFiles: [{
        id: 'f1', folderId: null, name: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 10,
        hasThumbnail: false, origin: 'team', uploadedBy: null, guestName: null, createdAt: new Date().toISOString(), updatedAt: '',
      }],
    }))
    const wrapper = await mountSuspended(HomePage)
    await flush()
    expect(wrapper.find('a[aria-label="Abrir foto.jpg"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/archivos"]').text()).toBe('Ver todos')
  })

  it('el contador usa el resumen hasta el primer pulso y desde entonces el pulso, que también baja; sin perfil saluda a secas', async () => {
    usePulse().cursor.value = null
    mockApi('GET', '/api/dashboard', summary({ pendingCount: 2 }))
    usePulse().pendingCount.value = 5
    const wrapper = await mountSuspended(HomePage)
    await flush()
    // Sin pulso todavía (cursor nulo) manda el resumen del servidor.
    expect(wrapper.get('.stat-value').text()).toBe('2')

    // Con el primer pulso manda el pulso.
    usePulse().cursor.value = '2026-10-14T10:00:00.000Z'
    await nextTick()
    expect(wrapper.get('.stat-value').text()).toBe('5')
    // Bajar a 0 (se atendieron o caducaron) se ve: el resumen viejo no lo tapa.
    usePulse().pendingCount.value = 0
    await nextTick()
    expect(wrapper.get('.stat-value').text()).toBe('0')

    // "Solicitudes por atender" suma envíos por revisar y solicitudes de acceso (feature 003).
    usePulse().openAccessRequests.value = 4
    await nextTick()
    expect(wrapper.get('.stat-value').text()).toBe('4')
    usePulse().openAccessRequests.value = 0
    usePulse().cursor.value = null
    clearNuxtData()
    mockApi('GET', '/api/dashboard', summary({ pendingCount: 2, openAccessRequests: 3 }))
    const summed = await mountSuspended(HomePage)
    await flush()
    expect(summed.get('.stat-value').text()).toBe('5')

    useMe().me.value = null
    clearNuxtData()
    const anonymous = await mountSuspended(HomePage)
    await flush()
    expect(anonymous.get('h1').text()).toBe('Hola')
  })

  it('carga, error con reintento y copiar el enlace de invitados', async () => {
    mockApi('GET', '/api/dashboard', () => new Promise(() => {}))
    const loading = await mountSuspended(HomePage)
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)

    clearNuxtData()
    mockApi('GET', '/api/dashboard', failWith(500))
    const wrapper = await mountSuspended(HomePage)
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar el resumen')

    await button(wrapper, 'Copiar enlace para invitados').trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)?.message).toBe('Enlace para invitados copiado')
    expect(await navigator.clipboard.readText()).toMatch(/\/enviar$/)
  })
})

describe('Mi perfil', () => {
  it('muestra correo y rol y guarda el nombre en Cloudy y en Neon Auth', async () => {
    mockApi('PATCH', '/api/me', profile({ name: 'Ana María' }))
    client.updateUser.mockResolvedValue(undefined)
    const wrapper = await mountSuspended(PerfilPage)
    expect(wrapper.text()).toContain('ana@iglesia.org')
    expect(wrapper.text()).toContain('Editor')

    await fill(wrapper, 'Nombre', 'Ana María')
    await wrapper.findAll('form')[0]!.trigger('submit')
    await flush()
    expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ name: 'Ana María' })
    expect(client.updateUser).toHaveBeenCalledWith({ name: 'Ana María' })
    expect(useMe().me.value?.profile.name).toBe('Ana María')
    expect(useToast().toasts.value.at(-1)?.message).toBe('Nombre actualizado')
  })

  it('si Neon Auth no guarda su copia del nombre, Cloudy lo conserva igual y avisa', async () => {
    mockApi('PATCH', '/api/me', profile({ name: 'Ana María' }))
    client.updateUser.mockRejectedValue(new Error('red'))
    const wrapper = await mountSuspended(PerfilPage)
    await fill(wrapper, 'Nombre', 'Ana María')
    await wrapper.findAll('form')[0]!.trigger('submit')
    await flush()
    expect(useMe().me.value?.profile.name).toBe('Ana María')
    expect(useToast().toasts.value.at(-1)?.message).toBe('Nombre actualizado')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('si falla guardar el nombre lo dice en el formulario', async () => {
    mockApi('PATCH', '/api/me', failWith(500))
    const wrapper = await mountSuspended(PerfilPage)
    await wrapper.findAll('form')[0]!.trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('No pudimos guardar el nombre')
  })

  it('si el servidor rechaza el nombre, muestra su motivo en el formulario', async () => {
    mockApi('PATCH', '/api/me', failWith(422, { errors: { name: 'Ese nombre ya lo usa otra cuenta' } }))
    const wrapper = await mountSuspended(PerfilPage)
    await fill(wrapper, 'Nombre', 'Ana María')
    await wrapper.findAll('form')[0]!.trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('Ese nombre ya lo usa otra cuenta')
  })

  it('cambia la contraseña y explica si la actual es incorrecta', async () => {
    setMe({ role: 'admin' })
    const wrapper = await mountSuspended(PerfilPage)
    expect(wrapper.text()).toContain('Administrador')
    const form = () => wrapper.findAll('form')[1]!

    client.changePassword.mockRejectedValueOnce(new AuthRequestError('bad', 400, 'INVALID_PASSWORD'))
    await fill(wrapper, 'Contraseña actual', 'vieja')
    await fill(wrapper, 'Nueva contraseña', '12345678')
    await fill(wrapper, 'Confirmar contraseña', '12345678')
    await form().trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('La contraseña actual no es correcta.')

    client.changePassword.mockResolvedValueOnce(undefined)
    await form().trigger('submit')
    await flush()
    expect(client.changePassword).toHaveBeenLastCalledWith({ currentPassword: 'vieja', newPassword: '12345678' })
    expect(useToast().toasts.value.at(-1)?.message).toBe('Contraseña actualizada')
  })
})

describe('inicio de sesión y registro', () => {
  it('login lleva al redirect seguro, a / o a /pendiente', async () => {
    client.signIn.mockResolvedValue({ profile: profile() })
    const wrapper = await mountSuspended(LoginPage, { route: '/login?redirect=/archivos%3Fq%3Ddom' })
    await fill(wrapper, 'Correo electrónico', 'ana@iglesia.org')
    await fill(wrapper, 'Contraseña', 'secreta')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(client.signIn).toHaveBeenCalledWith({ email: 'ana@iglesia.org', password: 'secreta' })
    expect(navigateToMock).toHaveBeenLastCalledWith('/archivos?q=dom')

    const evil = await mountSuspended(LoginPage, { route: '/login?redirect=//evil.com' })
    await fill(evil, 'Correo electrónico', 'ana@iglesia.org')
    await fill(evil, 'Contraseña', 'secreta')
    await evil.get('form').trigger('submit')
    await flush()
    expect(navigateToMock).toHaveBeenLastCalledWith('/')

    client.signIn.mockResolvedValue({ profile: profile({ status: 'pending', role: null }) })
    await evil.get('form').trigger('submit')
    await flush()
    expect(navigateToMock).toHaveBeenLastCalledWith('/pendiente')
  })

  it('login ofrece a los invitados "Enviar archivos" hacia /upload (feature 003, FR-001)', async () => {
    const wrapper = await mountSuspended(LoginPage)
    expect(wrapper.text()).toContain('¿Eres invitado?')
    const link = wrapper.get('a[href="/upload"]')
    expect(link.text()).toBe('Enviar archivos')
    expect(link.classes()).toEqual(expect.arrayContaining(['btn', 'btn-outline', 'btn-block']))
  })

  it('login muestra el error traducido', async () => {
    client.signIn.mockRejectedValue(new AuthRequestError('x', 429))
    const wrapper = await mountSuspended(LoginPage)
    await fill(wrapper, 'Correo electrónico', 'ana@iglesia.org')
    await fill(wrapper, 'Contraseña', 'secreta')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('Demasiados intentos')
  })

  it('registro: activo va a /, pendiente a /pendiente, error en el formulario', async () => {
    const wrapper = await mountSuspended(RegistroPage)
    await fill(wrapper, 'Nombre', 'Ana')
    await fill(wrapper, 'Correo electrónico', 'ana@iglesia.org')
    await fill(wrapper, 'Contraseña', '12345678')
    await fill(wrapper, 'Confirmar contraseña', '12345678')

    client.signUp.mockResolvedValueOnce({ profile: profile() })
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(client.signUp).toHaveBeenCalledWith({ name: 'Ana', email: 'ana@iglesia.org', password: '12345678' })
    expect(navigateToMock).toHaveBeenLastCalledWith('/')

    client.signUp.mockResolvedValueOnce({ profile: profile({ status: 'pending', role: null }) })
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(navigateToMock).toHaveBeenLastCalledWith('/pendiente')

    client.signUp.mockRejectedValueOnce(new AuthRequestError('exists', 422, 'USER_ALREADY_EXISTS'))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('Ya existe una cuenta con ese correo')
  })

  it('recuperar muestra siempre el mensaje neutro salvo el límite de intentos', async () => {
    const wrapper = await mountSuspended(RecuperarPage)
    await fill(wrapper, 'Correo electrónico', 'ana@iglesia.org')
    client.requestPasswordReset.mockRejectedValueOnce(new AuthRequestError('x', 429))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('Demasiados intentos')

    client.requestPasswordReset.mockRejectedValueOnce(new AuthRequestError('no existe', 404))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.text()).toContain('Si el correo existe, te enviamos un enlace')
    expect(client.requestPasswordReset.mock.calls[0]![0]).toMatchObject({ email: 'ana@iglesia.org', redirectTo: expect.stringMatching(/\/restablecer$/) })
  })

  it('recuperar con éxito', async () => {
    client.requestPasswordReset.mockResolvedValue(undefined)
    const wrapper = await mountSuspended(RecuperarPage)
    await fill(wrapper, 'Correo electrónico', 'ana@iglesia.org')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('h1').text()).toBe('Revisa tu correo')
  })

  it('restablecer: éxito, enlace caducado y otros errores', async () => {
    const wrapper = await mountSuspended(RestablecerPage, { route: '/restablecer?token=abc' })
    await fill(wrapper, 'Nueva contraseña', '12345678')
    await fill(wrapper, 'Confirmar contraseña', '12345678')

    client.resetPassword.mockRejectedValueOnce(new AuthRequestError('x', 500))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('no responde')

    client.resetPassword.mockResolvedValueOnce(undefined)
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(client.resetPassword).toHaveBeenLastCalledWith({ newPassword: '12345678', token: 'abc' })
    expect(navigateToMock).toHaveBeenLastCalledWith('/login')
    expect(useToast().toasts.value.at(-1)?.message).toContain('Contraseña actualizada')

    client.resetPassword.mockRejectedValueOnce(new AuthRequestError('x', 400, 'INVALID_TOKEN'))
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(wrapper.get('h1').text()).toBe('El enlace caducó o ya se usó')

    const noToken = await mountSuspended(RestablecerPage, { route: '/restablecer' })
    expect(noToken.get('a[href="/recuperar"]').text()).toBe('Pedir un enlace nuevo')
  })
})

describe('cuenta pendiente, acceso denegado y errores', () => {
  it.each([
    ['pending', 'Tu cuenta está pendiente de aprobación'],
    ['disabled', 'Tu cuenta fue desactivada'],
    ['removed', 'Tu cuenta fue eliminada'],
  ] as const)('pendiente (%s)', async (status, title) => {
    setMe({ status, role: null })
    const wrapper = await mountSuspended(PendientePage)
    expect(wrapper.get('h1').text()).toBe(title)
    await button(wrapper, 'Cerrar sesión').trigger('click')
    expect(client.logout).toHaveBeenCalled()
  })

  it('pendiente: mientras se cierra la sesión el botón muestra el progreso y no admite más clics', async () => {
    setMe({ status: 'pending', role: null })
    loggingOut.value = true
    const wrapper = await mountSuspended(PendientePage)
    const logout = wrapper.get('button')
    expect(logout.text()).toBe('Cerrando sesión…')
    // Sin `disabled` (se vería gris e ilegible): los clics repetidos los ignora `logout()` (composables.spec).
    expect(logout.attributes('disabled')).toBeUndefined()
    expect(logout.attributes('aria-disabled')).toBe('true')
    expect(logout.attributes('aria-busy')).toBe('true')
    expect(logout.find('.loading').exists()).toBe(true)

    loggingOut.value = false
    await nextTick()
    expect(logout.text()).toBe('Cerrar sesión')
    expect(logout.attributes('aria-disabled')).toBeUndefined()
    expect(logout.attributes('aria-busy')).toBe('false')
  })

  it('acceso denegado usa el dashboard con sesión activa y la tarjeta sin ella', async () => {
    const active = await mountSuspended(AccesoDenegadoPage)
    expect(active.text()).toContain('No tienes permiso para ver esta página')
    expect(active.find('nav[aria-label="Secciones"]').exists()).toBe(true)

    useMe().me.value = null
    const anonymous = await mountSuspended(AccesoDenegadoPage)
    expect(anonymous.find('nav[aria-label="Secciones"]').exists()).toBe(false)
    expect(anonymous.findAll('a[href="/"]').some(a => a.text().includes('Volver al inicio'))).toBe(true)
  })

  it('error.vue distingue 404 del resto y vuelve al inicio', async () => {
    const notFound = await mountSuspended(ErrorPage, { props: { error: { statusCode: 404 } as never } })
    expect(notFound.get('h1').text()).toBe('Página no encontrada')
    await notFound.get('button').trigger('click')
    expect(clearErrorMock).toHaveBeenCalledWith({ redirect: '/' })
    const other = await mountSuspended(ErrorPage, { props: { error: { statusCode: 500 } as never } })
    expect(other.get('h1').text()).toBe('Algo salió mal')
  })
})

describe('shell', () => {
  it('app.vue monta los avisos y el diálogo de confirmación compartido', async () => {
    const wrapper = await mountSuspended(App)
    expect(wrapper.find('[role="status"][aria-live="polite"]').exists()).toBe(true)
    const pending = useConfirm().confirm({ title: '¿Seguro?' })
    await nextTick()
    expect(wrapper.find('dialog h2').text()).toBe('¿Seguro?')
    useConfirm().cancel()
    expect(await pending).toBe(false)
    // Si queda montada, sus metas (`useSeoMeta`) siguen en `document.head` para las pruebas siguientes.
    wrapper.unmount()
  })

  it('app.vue publica las metas Open Graph con la imagen absoluta, y la omite sin URL pública', async () => {
    const config = useRuntimeConfig()
    const meta = (selector: string) => document.head.querySelector(selector)?.getAttribute('content') ?? null
    expect(config.public.siteUrl).toMatch(/^https?:\/\//)

    const wrapper = await mountSuspended(App)
    await flush()
    expect(meta('meta[property="og:title"]')).toBe('Cloudy')
    expect(meta('meta[property="og:type"]')).toBe('website')
    expect(meta('meta[property="og:description"]')).toContain('disco multimedia')
    expect(meta('meta[name="description"]')).toContain('disco multimedia')
    expect(meta('meta[name="twitter:card"]')).toBe('summary_large_image')
    expect(meta('meta[property="og:image"]')).toBe(`${config.public.siteUrl}/og-cloudy.png`)
    wrapper.unmount()
    await flush()

    // Los rastreadores exigen una URL absoluta: sin `siteUrl` no se publica una imagen relativa.
    const siteUrl = config.public.siteUrl
    config.public.siteUrl = ''
    try {
      expect(config.public.siteUrl).toBe('')
      const bare = await mountSuspended(App)
      await flush()
      expect(meta('meta[property="og:image"]')).toBeNull()
      expect(meta('meta[property="og:title"]')).toBe('Cloudy')
      bare.unmount()
    }
    finally {
      config.public.siteUrl = siteUrl
    }
  })

  it('app.vue cambia el theme-color con el tema', async () => {
    const wrapper = await mountSuspended(App)
    await flush()
    const themeColor = () => document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')
    expect(themeColor()).toBe('#0a0a0a')
    useTheme().set('cloudy-light')
    await flush()
    expect(themeColor()).toBe('#fcfbf9')
    useTheme().set('cloudy')
    await flush()
    expect(themeColor()).toBe('#0a0a0a')
    wrapper.unmount()
  })

  it('layouts de autenticación y público', async () => {
    const auth = await mountSuspended(AuthLayout, { slots: { default: () => 'contenido' } })
    expect(auth.text()).toContain('contenido')
    expect(auth.find('button[aria-label="Cambiar a tema claro"]').exists()).toBe(true)
    const pub = await mountSuspended(PublicLayout, { slots: { default: () => 'público' } })
    expect(pub.get('main#contenido').text()).toBe('público')
  })

  it('dashboard: barra lateral, salto al contenido y contraer', async () => {
    const wrapper = await mountSuspended(DashboardLayout, { slots: { default: () => 'página' } })
    expect(wrapper.get('main#contenido').text()).toBe('página')
    expect(wrapper.get('a[href="#contenido"]').text()).toBe('Saltar al contenido')

    const toggle = wrapper.get('input.drawer-toggle').element as HTMLInputElement
    await wrapper.get('button[aria-label="Abrir menú"]').trigger('click')
    expect(toggle.checked).toBe(true)
    await wrapper.get('button[aria-label="Cerrar menú"]').trigger('click')
    expect(toggle.checked).toBe(false)
    await wrapper.get('button[aria-label="Abrir menú"]').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(toggle.checked).toBe(false)

    wrapper.unmount()
  })

  it('topbar: búsqueda, atajo "/" y menú; la cuenta y el tema ya no viven aquí', async () => {
    const wrapper = await mountSuspended(AppTopbar, { attachTo: document.body, route: '/archivos?q=coro' })
    const search = wrapper.get('input[aria-label="Buscar archivos"]')
    expect((search.element as HTMLInputElement).value).toBe('coro')

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    expect(document.activeElement).toBe(search.element)
    // Mientras se escribe en un campo, "/" no roba el foco.
    search.element.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    expect(wrapper.get('kbd').text()).toBe('/')

    await search.setValue('  domingo ')
    await wrapper.get('form[role="search"]').trigger('submit')
    expect(navigateToMock).toHaveBeenLastCalledWith({ path: '/archivos', query: { q: 'domingo' } })
    await search.setValue('')
    await wrapper.get('form[role="search"]').trigger('submit')
    expect(navigateToMock).toHaveBeenLastCalledWith({ path: '/archivos', query: {} })

    await wrapper.get('button[aria-label="Abrir menú"]').trigger('click')
    expect(wrapper.emitted('toggleMenu')).toHaveLength(1)

    // El menú de usuario y el tema se movieron al pie de la barra lateral.
    expect(wrapper.find('button[aria-label="Menú de usuario"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Cambiar a tema"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('middleware de rutas', () => {
  const route = (path: string, meta: Record<string, unknown>, matched = 1) =>
    ({ path, fullPath: path, meta, matched: Array.from({ length: matched }) }) as never

  it('carga el perfil una vez y aplica la matriz de acceso', async () => {
    useMe().me.value = null
    useMe().loaded.value = false
    mockApi('GET', '/api/me', failWith(401))
    await authMiddleware(route('/archivos', { access: 'private' }), route('/', {}))
    expect(navigateToMock).toHaveBeenLastCalledWith('/login?redirect=%2Farchivos')
    expect(useMe().loaded.value).toBe(true)

    navigateToMock.mockReset()
    await authMiddleware(route('/login', { access: 'guest-only' }), route('/', {}))
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('las rutas inexistentes pasan para que se muestre el 404', async () => {
    await authMiddleware(route('/no-existe', {}, 0), route('/', {}))
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
