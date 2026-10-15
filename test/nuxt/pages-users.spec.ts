// US4 — páginas Usuarios y Actividad (solo admin).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { setResponseStatus } from 'h3'
import { nextTick } from 'vue'
import type { ActivityEntry, Me, Profile } from '#shared/types/api'
import ActividadPage from '~/pages/actividad.vue'
import UsuariosPage from '~/pages/usuarios.vue'
import { activityDetail, activityIcon, activityLabel } from '~/utils/activity-labels'
import type { Queryable } from './helpers/api'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const user = (changes: Partial<Profile> = {}): Profile => ({
  userId: 'u2', email: 'luis@iglesia.org', name: 'Luis', role: null, status: 'pending', createdAt: new Date().toISOString(), ...changes,
})
const me: Me = {
  user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
  profile: user({ userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'admin', status: 'active' }),
}
const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]!
/** Primera coincidencia: la vista móvil (tarjetas) y la tabla renderizan los mismos controles. */
const select = (wrapper: Queryable, label: string) => wrapper.findAll(`select[aria-label="${label}"]`)[0]!

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  navigateToMock.mockReset()
  useToast().toasts.value = []
  useMe().me.value = { ...me, profile: { ...me.profile } }
  mockApi('GET', '/api/me', () => useMe().me.value)
})

describe('Usuarios', () => {
  it('lista con los pendientes destacados y activa con el rol elegido', async () => {
    mockApi('GET', '/api/users', { items: [user(), me.profile], total: 2 })
    mockApi('PATCH', '/api/users/u2', user({ status: 'active', role: 'editor' }))
    const wrapper = await mountSuspended(UsuariosPage)
    await flush()
    expect(wrapper.text()).toContain('1 cuenta espera aprobación')
    expect(wrapper.find('table tr.bg-warning\\/10').text()).toContain('Luis')
    expect(wrapper.text()).toContain('Esta es tu cuenta')

    await select(wrapper, 'Rol para Luis').setValue('admin')
    await button(wrapper, 'Activar').trigger('click')
    await flush()
    expect(calls.find(c => c.method === 'PATCH')).toMatchObject({ url: '/api/users/u2', body: { status: 'active', role: 'admin' } })
    expect(useToast().toasts.value.at(-1)?.message).toBe('Luis ya puede entrar como administrador')
    // Se vuelve a pedir la lista.
    expect(calls.filter(c => c.url === '/api/users').length).toBeGreaterThanOrEqual(2)
  })

  it('desactiva, reactiva y cambia el rol', async () => {
    mockApi('GET', '/api/users', { items: [user({ status: 'active', role: 'editor' })], total: 1 })
    mockApi('PATCH', '/api/users/u2', user({ status: 'active', role: 'editor' }))
    const wrapper = await mountSuspended(UsuariosPage)
    await flush()

    await select(wrapper, 'Rol de Luis').setValue('admin')
    await flush()
    expect(calls.at(-2)).toMatchObject({ method: 'PATCH', body: { role: 'admin' } })
    expect(useToast().toasts.value.at(-1)?.message).toBe('Luis ahora es administrador')

    await button(wrapper, 'Desactivar').trigger('click')
    await flush()
    expect(calls.filter(c => c.method === 'PATCH').at(-1)?.body).toEqual({ status: 'disabled' })

    mockApi('GET', '/api/users', { items: [user({ status: 'disabled', role: 'editor' })], total: 1 })
    clearNuxtData()
    const disabled = await mountSuspended(UsuariosPage)
    await flush()
    await button(disabled, 'Reactivar').trigger('click')
    await flush()
    expect(calls.filter(c => c.method === 'PATCH').at(-1)?.body).toEqual({ status: 'active' })
    expect(useToast().toasts.value.at(-1)?.message).toBe('La cuenta de Luis vuelve a estar activa')
  })

  it('un 409 muestra el mensaje del servidor', async () => {
    mockApi('GET', '/api/users', { items: [me.profile], total: 1 })
    // `failWith` no transmite `message`: se responde el cuerpo que envía el servidor real.
    mockApi('PATCH', '/api/users/u1', (event) => {
      setResponseStatus(event, 409)
      return { statusCode: 409, message: 'Debe existir al menos un administrador activo' }
    })
    const wrapper = await mountSuspended(UsuariosPage)
    await flush()
    await button(wrapper, 'Desactivar').trigger('click')
    await flush()
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'error', message: 'Debe existir al menos un administrador activo' })
  })

  it('eliminar pide confirmación y, al confirmar, llama a DELETE', async () => {
    mockApi('GET', '/api/users', { items: [user({ status: 'active', role: 'editor' })], total: 1 })
    mockApi('DELETE', '/api/users/u2', null)
    const wrapper = await mountSuspended(UsuariosPage)
    await flush()

    await wrapper.find('button[aria-label="Eliminar a Luis"]').trigger('click')
    await nextTick()
    expect(useConfirm().options.value?.title).toBe('¿Eliminar la cuenta de Luis?')
    useConfirm().cancel()
    await flush()
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)

    await wrapper.find('button[aria-label="Eliminar a Luis"]').trigger('click')
    await nextTick()
    useConfirm().accept()
    await flush()
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/users/u2')).toBe(true)
    expect(useToast().toasts.value.at(-1)?.message).toBe('La cuenta de Luis fue eliminada')
  })

  it('si el admin se cambia a sí mismo, refresca su perfil y sigue la matriz de acceso', async () => {
    mockApi('GET', '/api/users', { items: [me.profile], total: 1 })
    mockApi('PATCH', '/api/users/u1', me.profile)
    mockApi('GET', '/api/me', { ...me, profile: { ...me.profile, role: 'editor' } })
    const wrapper = await mountSuspended(UsuariosPage, { route: '/usuarios' })
    await flush()
    await select(wrapper, 'Rol de Ana').setValue('editor')
    await flush()
    expect(useMe().me.value?.profile.role).toBe('editor')
    expect(navigateToMock).toHaveBeenCalledWith('/acceso-denegado')
  })

  it('estados de carga, error y vacío', async () => {
    mockApi('GET', '/api/users', () => new Promise(() => {}))
    const loading = await mountSuspended(UsuariosPage)
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)

    clearNuxtData()
    mockApi('GET', '/api/users', failWith(500))
    const error = await mountSuspended(UsuariosPage)
    await flush()
    expect(error.get('[role="alert"]').text()).toContain('No pudimos cargar los usuarios')

    clearNuxtData()
    mockApi('GET', '/api/users', { items: [], total: 0 })
    const empty = await mountSuspended(UsuariosPage)
    await flush()
    expect(empty.text()).toContain('Todavía no hay otras cuentas')
  })

  it('pagina con botones anterior/siguiente', async () => {
    mockApi('GET', '/api/users', (event) => {
      const page = Number(new URL(event.path, 'http://x').searchParams.get('page') ?? '1')
      return { items: [user({ userId: `p${page}`, name: `Persona ${page}`, status: 'active', role: 'editor' })], total: 45 }
    })
    const wrapper = await mountSuspended(UsuariosPage)
    await flush()
    expect(wrapper.text()).toContain('Página 1 de 3')
    expect((wrapper.find('button[aria-label="Página anterior"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.find('button[aria-label="Página siguiente"]').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Persona 2')
    expect(wrapper.text()).toContain('Página 2 de 3')
  })
})

describe('Actividad', () => {
  const entry = (changes: Partial<ActivityEntry> = {}): ActivityEntry => ({
    id: 1, actorId: 'u1', actorLabel: 'Ana', action: 'user.activate', targetType: 'user', targetId: 'u2', targetLabel: 'Luis',
    meta: { role: 'editor' }, createdAt: new Date().toISOString(), ...changes,
  })

  beforeEach(() => {
    mockApi('GET', '/api/users', { items: [me.profile], total: 1 })
  })

  it('lista la actividad traducida con filtros y carga más por cursor', async () => {
    mockApi('GET', '/api/activity', (event) => {
      const params = new URL(event.path, 'http://x').searchParams
      if (params.get('cursor') === '2') return { items: [entry({ id: 1, action: 'file.upload', targetType: 'file', targetLabel: 'foto.jpg', meta: null })], nextCursor: null }
      if (params.get('action') === 'user.role_change') return { items: [entry({ id: 3, action: 'user.role_change', meta: { from: 'editor', to: 'admin' } })], nextCursor: null }
      return { items: [entry({ id: 2 })], nextCursor: '2' }
    })
    const wrapper = await mountSuspended(ActividadPage)
    await flush()
    expect(wrapper.text()).toContain('Ana activó la cuenta de Luis')
    expect(wrapper.text()).toContain('como Editor')

    await button(wrapper, 'Cargar más').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Ana subió el archivo foto.jpg')
    expect(buttonsWithText(wrapper, 'Cargar más')).toHaveLength(0)

    await wrapper.findAll('select')[0]!.setValue('user.role_change')
    await flush()
    expect(wrapper.text()).toContain('Editor → Administrador')
    expect(calls.at(-1)?.url).toBe('/api/activity')
    expect(wrapper.findAll('select')[1]!.findAll('option').map(o => o.text())).toContain('Ana')
  })

  it('estados de carga, error con reintento y vacío', async () => {
    mockApi('GET', '/api/activity', () => new Promise(() => {}))
    const loading = await mountSuspended(ActividadPage)
    await nextTick()
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)

    mockApi('GET', '/api/activity', failWith(500))
    const wrapper = await mountSuspended(ActividadPage)
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar la actividad')

    mockApi('GET', '/api/activity', { items: [], nextCursor: null })
    await button(wrapper, 'Reintentar').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Sin actividad todavía')
  })

  it('etiquetas: todas las acciones tienen texto, ícono por tipo y detalle según meta', () => {
    expect(activityLabel('x.y')).toBe('x.y')
    expect(activityIcon('folder.create')).toBe('lucide:folder')
    expect(activityIcon('x')).toBe('lucide:activity')
    expect(activityDetail('file.rename', { from: 'a.jpg' })).toBe('antes «a.jpg»')
    expect(activityDetail('submission.reject', { reason: 'borrosa' })).toBe('motivo: borrosa')
    expect(activityDetail('user.role_change', { from: null, to: 'editor' })).toBe('Sin rol → Editor')
    expect(activityDetail('file.upload', null)).toBe('')
    expect(activityDetail('file.upload', { x: 1 })).toBe('')
  })
})
