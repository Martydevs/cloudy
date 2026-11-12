// US4 — páginas Usuarios y Actividad (solo admin).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { nextTick } from 'vue'
import type { ActivityEntry, Me, Profile } from '#shared/types/api'
import ActividadPage from '~/pages/actividad.vue'
import UsuariosPage from '~/pages/usuarios.vue'
import { activityDetail, activityIcon, activityLabel } from '~/utils/activity-labels'
import type { Queryable, QueryableWithGet } from './helpers/api'
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
    await nextTick()
    useConfirm().accept()
    await flush()
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'error', message: 'Debe existir al menos un administrador activo' })
  })

  // Regresión: «Desactivar» sobre la propia cuenta cerraba la sesión al primer toque, sin confirmar.
  it('desactivar o eliminar la propia cuenta pide confirmación; a otra persona no se le pregunta al desactivar', async () => {
    mockApi('GET', '/api/users', { items: [me.profile, user({ status: 'active', role: 'editor' })], total: 2 })
    mockApi('PATCH', '/api/users/u1', me.profile)
    mockApi('PATCH', '/api/users/u2', user({ status: 'disabled', role: 'editor' }))
    const wrapper = await mountSuspended(UsuariosPage)
    await flush()
    const table = wrapper.get('table')
    const rowOf = (name: string) => table.findAll('tbody tr').find(r => r.text().includes(name))!

    await buttonsWithText(rowOf('Ana'), 'Desactivar')[0]!.trigger('click')
    await nextTick()
    expect(useConfirm().options.value).toMatchObject({ title: '¿Desactivar tu propia cuenta?', confirmLabel: 'Desactivar mi cuenta', danger: true })
    useConfirm().cancel()
    await flush()
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)

    await rowOf('Ana').get('button[aria-label="Eliminar a Ana"]').trigger('click')
    await nextTick()
    expect(useConfirm().options.value?.title).toBe('¿Eliminar tu propia cuenta?')
    useConfirm().cancel()
    await flush()
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)

    await buttonsWithText(rowOf('Luis'), 'Desactivar')[0]!.trigger('click')
    await flush()
    expect(calls.filter(c => c.method === 'PATCH').at(-1)).toMatchObject({ url: '/api/users/u2', body: { status: 'disabled' } })
  })

  // Regresión: a 360 px el nombre de la tarjeta móvil se cortaba («QA Cloudy …»).
  it('la tarjeta móvil no recorta el nombre', async () => {
    mockApi('GET', '/api/users', { items: [user({ name: 'Persona con un nombre muy largo de verdad' })], total: 1 })
    const wrapper = await mountSuspended(UsuariosPage)
    await flush()
    const name = wrapper.get('ul[aria-label="Usuarios"] li span.font-medium')
    expect(name.text()).toBe('Persona con un nombre muy largo de verdad')
    expect(name.classes()).not.toContain('truncate')
    expect(name.classes()).toEqual(expect.arrayContaining(['basis-full', 'break-words']))
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
    await wrapper.find('button[aria-label="Página anterior"]').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Persona 1')
    expect(wrapper.text()).toContain('Página 1 de 3')
  })

  it('la tabla de escritorio ofrece las mismas acciones que las tarjetas y resume los pendientes en plural', async () => {
    const pending = [user(), user({ userId: 'u3', email: 'eva@iglesia.org', name: 'Eva' })]
    const active = user({ userId: 'u4', email: 'leo@iglesia.org', name: 'Leo', status: 'active', role: 'editor' })
    mockApi('GET', '/api/users', { items: [...pending, active], total: 3 })
    mockApi('PATCH', '/api/users/u2', user({ status: 'active', role: 'editor' }))
    mockApi('PATCH', '/api/users/u4', active)
    mockApi('DELETE', '/api/users/u4', null)
    const wrapper = await mountSuspended(UsuariosPage)
    await flush()
    expect(wrapper.text()).toContain('2 cuentas esperan aprobación')

    // Los controles de la tabla (las tarjetas móviles repiten los mismos).
    const table = wrapper.get('table')
    const inTable = (selector: string) => table.get(selector)
    const tableButton = (text: string) => buttonsWithText(table, text)[0]!

    await inTable('select[aria-label="Rol para Luis"]').setValue('admin')
    await tableButton('Activar').trigger('click')
    await flush()
    expect(calls.filter(c => c.method === 'PATCH').at(-1)).toMatchObject({ url: '/api/users/u2', body: { status: 'active', role: 'admin' } })

    await inTable('select[aria-label="Rol de Leo"]').setValue('admin')
    await flush()
    expect(calls.filter(c => c.method === 'PATCH').at(-1)).toMatchObject({ url: '/api/users/u4', body: { role: 'admin' } })

    await tableButton('Desactivar').trigger('click')
    await flush()
    expect(calls.filter(c => c.method === 'PATCH').at(-1)).toMatchObject({ url: '/api/users/u4', body: { status: 'disabled' } })

    await inTable('button[aria-label="Eliminar a Leo"]').trigger('click')
    await nextTick()
    useConfirm().accept()
    await flush()
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/users/u4')).toBe(true)

    mockApi('GET', '/api/users', { items: [user({ userId: 'u4', name: 'Leo', status: 'disabled', role: 'editor' })], total: 1 })
    clearNuxtData()
    const disabled = await mountSuspended(UsuariosPage)
    await flush()
    await buttonsWithText(disabled.get('table'), 'Reactivar')[0]!.trigger('click')
    await flush()
    expect(calls.filter(c => c.method === 'PATCH').at(-1)?.body).toEqual({ status: 'active' })
  })
})

describe('Usuarios · selección múltiple', () => {
  const luis = user({ status: 'active', role: 'editor' })
  const eva = user({ userId: 'u3', email: 'eva@iglesia.org', name: 'Eva', status: 'active', role: 'editor' })
  const batchPosts = () => calls.filter(c => c.method === 'POST' && c.url === '/api/users/batch')
  const bar = (wrapper: Queryable) => wrapper.findAll('[role="region"][aria-label="Selección"]')[0]
  const toast = () => useToast().toasts.value.at(-1)

  /** Monta la página y marca en la tabla las cuentas con esos nombres. */
  async function mountWithSelection(names: string[]) {
    const wrapper = await mountSuspended(UsuariosPage, { route: '/usuarios' })
    await flush()
    const table = wrapper.get('table')
    for (const name of names) await table.get(`input[aria-label="Seleccionar a ${name}"]`).setValue(true)
    // La barra es un componente `Lazy`: su chunk llega aparte.
    await vi.waitFor(() => expect(bar(wrapper)).toBeDefined())
    return wrapper
  }

  beforeEach(() => {
    mockApi('GET', '/api/users', { items: [me.profile, luis, eva], total: 3 })
    mockApi('POST', '/api/users/batch', { updated: ['u2', 'u3'], skipped: [] })
  })

  it('cada cuenta tiene su casilla con nombre (tabla y tarjetas) y la cabecera marca toda la página', async () => {
    const wrapper = await mountSuspended(UsuariosPage)
    await flush()
    const table = wrapper.get('table')
    const labels = ['Seleccionar a Ana', 'Seleccionar a Luis', 'Seleccionar a Eva']
    expect(table.findAll('tbody input[type="checkbox"]').map(box => box.attributes('aria-label'))).toEqual(labels)
    expect(wrapper.get('ul[aria-label="Usuarios"]').findAll('input[type="checkbox"]').map(box => box.attributes('aria-label'))).toEqual(labels)
    // Siempre visibles y con área táctil de 44 px.
    for (const box of wrapper.findAll('input[type="checkbox"]')) expect(box.element.parentElement!.className).toContain('size-11')
    expect(bar(wrapper)).toBeUndefined()

    const all = table.get('input[aria-label="Seleccionar todas las cuentas de esta página"]')
    const allState = () => all.element as HTMLInputElement
    await table.get('input[aria-label="Seleccionar a Luis"]').setValue(true)
    await vi.waitFor(() => expect(bar(wrapper)).toBeDefined())
    expect(bar(wrapper)!.get('[role="status"]').text()).toBe('1 seleccionado')
    // Con parte de la página marcada, la casilla de la cabecera queda en estado intermedio.
    expect([allState().checked, allState().indeterminate]).toEqual([false, true])
    // La tarjeta móvil de la misma cuenta refleja la selección.
    expect((wrapper.get('ul[aria-label="Usuarios"] input[aria-label="Seleccionar a Luis"]').element as HTMLInputElement).checked).toBe(true)

    await all.setValue(true)
    expect(bar(wrapper)!.get('[role="status"]').text()).toBe('3 seleccionados')
    expect([allState().checked, allState().indeterminate]).toEqual([true, false])
    // Regresión: con `pb-40` la barra (tres acciones apiladas en teléfono, ~208 px) tapaba 24 px de la última cuenta.
    expect(wrapper.element.classList).toContain('pb-56')
    expect(wrapper.element.classList).toContain('sm:pb-24')

    await all.setValue(false)
    await flush()
    expect(bar(wrapper)).toBeUndefined()
    expect(wrapper.element.classList).not.toContain('pb-56')
  })

  it('Desactivar manda la selección en una petición, sin preguntar si son cuentas ajenas, avisa y limpia la selección', async () => {
    const wrapper = await mountWithSelection(['Luis', 'Eva'])
    mockApi('GET', '/api/users', { items: [me.profile, { ...luis, status: 'disabled' }, { ...eva, status: 'disabled' }], total: 3 })
    await buttonsWithText(bar(wrapper)!, 'Desactivar')[0]!.trigger('click')
    await flush(10)
    expect(useConfirm().options.value).toBeNull()
    expect(batchPosts().map(c => c.body)).toEqual([{ ids: ['u2', 'u3'], action: 'disable' }])
    expect(toast()).toMatchObject({ type: 'success', message: '2 cuentas actualizadas.' })
    expect(bar(wrapper)).toBeUndefined()
    // La lista se recarga con el estado nuevo.
    expect(wrapper.get('table').text()).toContain('Desactivado')
  })

  it('lo que se marca mientras la lista se recarga tras un cambio en lote sigue marcado (regresión)', async () => {
    const wrapper = await mountWithSelection(['Luis'])
    // La recarga queda en vilo: el aviso ya salió, pero `admin.bulk` aún no devuelve el control a la página.
    let finishReload!: () => void
    mockApi('GET', '/api/users', () => new Promise((resolve) => {
      finishReload = () => resolve({ items: [me.profile, { ...luis, status: 'disabled' }, eva], total: 3 })
    }))
    mockApi('POST', '/api/users/batch', { updated: ['u2'], skipped: [] })
    await buttonsWithText(bar(wrapper)!, 'Desactivar')[0]!.trigger('click')
    await flush(10)
    expect(toast()).toMatchObject({ type: 'success', message: '1 cuenta actualizada.' })

    await wrapper.get('table input[aria-label="Seleccionar a Eva"]').setValue(true)
    finishReload()
    await flush(10)
    // Luis ya se atendió y sale de la selección; Eva, marcada durante la recarga, se conserva.
    expect(bar(wrapper)!.get('[role="status"]').text()).toBe('1 seleccionado')
    expect((wrapper.get('table input[aria-label="Seleccionar a Eva"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.get('table input[aria-label="Seleccionar a Luis"]').element as HTMLInputElement).checked).toBe(false)
  })

  it('Cambiar rol abre un menú con los roles y aplica el elegido a la selección', async () => {
    const wrapper = await mountWithSelection(['Luis', 'Eva'])
    const trigger = buttonsWithText(bar(wrapper)!, 'Cambiar rol')[0]!
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await trigger.trigger('click')
    await flush()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const options = bar(wrapper)!.findAll('[role="menuitem"]')
    expect(options.map(option => option.text())).toEqual(['Editor', 'Administrador'])
    await options[1]!.trigger('click')
    await flush(10)
    expect(batchPosts().map(c => c.body)).toEqual([{ ids: ['u2', 'u3'], action: 'role', role: 'admin' }])
    expect(toast()?.message).toBe('2 cuentas actualizadas.')
  })

  it('Eliminar pide confirmación: cancelar no cambia nada y conserva la selección; confirmar elimina', async () => {
    const wrapper = await mountWithSelection(['Luis', 'Eva'])
    await buttonsWithText(bar(wrapper)!, 'Eliminar')[0]!.trigger('click')
    await nextTick()
    expect(useConfirm().options.value).toMatchObject({
      title: '¿Eliminar 2 cuentas?',
      message: 'Perderán el acceso a Cloudy. Sus archivos y su historial se conservan.',
      confirmLabel: 'Eliminar cuentas',
      danger: true,
    })
    useConfirm().cancel()
    await flush()
    expect(batchPosts()).toHaveLength(0)
    expect(bar(wrapper)!.get('[role="status"]').text()).toBe('2 seleccionados')

    await buttonsWithText(bar(wrapper)!, 'Eliminar')[0]!.trigger('click')
    await nextTick()
    useConfirm().accept()
    await flush(10)
    expect(batchPosts().map(c => c.body)).toEqual([{ ids: ['u2', 'u3'], action: 'remove' }])
    expect(bar(wrapper)).toBeUndefined()
  })

  it('con la propia cuenta en la selección, desactivar y eliminar avisan como al hacerlo de una en una', async () => {
    const wrapper = await mountWithSelection(['Ana', 'Luis'])
    await buttonsWithText(bar(wrapper)!, 'Desactivar')[0]!.trigger('click')
    await nextTick()
    expect(useConfirm().options.value).toMatchObject({
      title: '¿Desactivar 2 cuentas, incluida la tuya?',
      message: 'Perderás el acceso a Cloudy en cuanto confirmes. Solo otro administrador podrá reactivar tu cuenta.',
      danger: true,
    })
    useConfirm().cancel()
    await flush()
    expect(batchPosts()).toHaveLength(0)

    await buttonsWithText(bar(wrapper)!, 'Eliminar')[0]!.trigger('click')
    await nextTick()
    expect(useConfirm().options.value?.message).toContain('Tu propia cuenta está en la selección: perderás el acceso en cuanto confirmes.')
    useConfirm().cancel()
    await flush()
    expect(batchPosts()).toHaveLength(0)
  })

  it('solo la propia cuenta: el aviso es el de «tu propia cuenta»', async () => {
    const wrapper = await mountWithSelection(['Ana'])
    await buttonsWithText(bar(wrapper)!, 'Desactivar')[0]!.trigger('click')
    await nextTick()
    expect(useConfirm().options.value).toMatchObject({ title: '¿Desactivar tu propia cuenta?', confirmLabel: 'Desactivar mi cuenta' })
    useConfirm().cancel()
    await flush()
  })

  it('si el servidor se salta cuentas, el aviso dice cuántas cambiaron y nombra la regla del último administrador', async () => {
    mockApi('POST', '/api/users/batch', { updated: ['u2'], skipped: [{ id: 'u1', reason: 'last_admin' }, { id: 'u3', reason: 'unchanged' }] })
    const wrapper = await mountWithSelection(['Ana', 'Luis', 'Eva'])
    const trigger = buttonsWithText(bar(wrapper)!, 'Cambiar rol')[0]!
    await trigger.trigger('click')
    await flush()
    await bar(wrapper)!.findAll('[role="menuitem"]')[0]!.trigger('click')
    await flush(10)
    expect(batchPosts()[0]!.body).toEqual({ ids: ['u1', 'u2', 'u3'], action: 'role', role: 'editor' })
    expect(toast()).toMatchObject({
      type: 'success',
      message: '1 cuenta actualizada. 1 no se cambió: debe existir al menos un administrador activo. 1 ya estaba así o ya no existe.',
    })
    // La propia cuenta no cambió: no hay redirección.
    expect(navigateToMock).not.toHaveBeenCalled()

    mockApi('POST', '/api/users/batch', { updated: [], skipped: [{ id: 'u1', reason: 'last_admin' }] })
    const table = wrapper.get('table')
    await table.get('input[aria-label="Seleccionar a Ana"]').setValue(true)
    await vi.waitFor(() => expect(bar(wrapper)).toBeDefined())
    await buttonsWithText(bar(wrapper)!, 'Cambiar rol')[0]!.trigger('click')
    await flush()
    await bar(wrapper)!.findAll('[role="menuitem"]')[0]!.trigger('click')
    await flush(10)
    expect(toast()).toMatchObject({ type: 'info', message: '0 cuentas actualizadas. 1 no se cambió: debe existir al menos un administrador activo.' })
  })

  it('si el cambio alcanzó a la propia cuenta, refresca el perfil y sigue la matriz de acceso', async () => {
    mockApi('POST', '/api/users/batch', { updated: ['u1', 'u2'], skipped: [] })
    mockApi('GET', '/api/me', { ...me, profile: { ...me.profile, role: 'editor' } })
    const wrapper = await mountWithSelection(['Ana', 'Luis'])
    await buttonsWithText(bar(wrapper)!, 'Cambiar rol')[0]!.trigger('click')
    await flush()
    await bar(wrapper)!.findAll('[role="menuitem"]')[0]!.trigger('click')
    await flush(10)
    expect(useMe().me.value?.profile.role).toBe('editor')
    expect(navigateToMock).toHaveBeenCalledWith('/acceso-denegado')
  })

  it('si la petición falla avisa y conserva la selección', async () => {
    mockApi('POST', '/api/users/batch', failWith(500))
    const wrapper = await mountWithSelection(['Luis'])
    await buttonsWithText(bar(wrapper)!, 'Desactivar')[0]!.trigger('click')
    await flush(10)
    expect(toast()).toMatchObject({ type: 'error', message: 'No pudimos cambiar las cuentas seleccionadas. Inténtalo de nuevo.' })
    expect(bar(wrapper)!.get('[role="status"]').text()).toBe('1 seleccionado')
  })

  it('Limpiar desmarca todo; cambiar de página empieza una selección nueva', async () => {
    mockApi('GET', '/api/users', (event) => {
      const page = Number(new URL(event.path, 'http://x').searchParams.get('page') ?? '1')
      return { items: [user({ userId: `p${page}`, name: `Persona ${page}`, status: 'active', role: 'editor' })], total: 45 }
    })
    const wrapper = await mountWithSelection(['Persona 1'])
    await buttonsWithText(bar(wrapper)!, 'Limpiar')[0]!.trigger('click')
    await flush()
    expect(bar(wrapper)).toBeUndefined()

    await wrapper.get('table input[aria-label="Seleccionar a Persona 1"]').setValue(true)
    await vi.waitFor(() => expect(bar(wrapper)).toBeDefined())
    await wrapper.find('button[aria-label="Página siguiente"]').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Persona 2')
    expect(bar(wrapper)).toBeUndefined()
    expect((wrapper.get('table input[aria-label="Seleccionar a Persona 2"]').element as HTMLInputElement).checked).toBe(false)
  })

  it('una cuenta marcada que ya no está en la lista al recargar sale de la selección', async () => {
    const wrapper = await mountWithSelection(['Luis', 'Eva'])
    expect(bar(wrapper)!.get('[role="status"]').text()).toBe('2 seleccionados')

    // Otra persona eliminó a Eva; la lista se recarga tras un cambio en la fila de Luis.
    mockApi('GET', '/api/users', { items: [me.profile, { ...luis, role: 'admin' }], total: 2 })
    mockApi('PATCH', '/api/users/u2', { ...luis, role: 'admin' })
    await select(wrapper, 'Rol de Luis').setValue('admin')
    await flush(10)
    expect(wrapper.get('table').text()).not.toContain('Eva')
    expect(bar(wrapper)!.get('[role="status"]').text()).toBe('1 seleccionado')
    expect((wrapper.get('table input[aria-label="Seleccionar a Luis"]').element as HTMLInputElement).checked).toBe(true)

    // Lo que se envía después es solo lo que sigue a la vista.
    await buttonsWithText(bar(wrapper)!, 'Desactivar')[0]!.trigger('click')
    await flush(10)
    expect(batchPosts().map(c => c.body)).toEqual([{ ids: ['u2'], action: 'disable' }])
  })

  it('la casilla de la tarjeta (teléfono) marca la misma selección; la fila marcada se resalta y la pendiente conserva su aviso', async () => {
    const pau = user({ userId: 'u4', email: 'pau@iglesia.org', name: 'Pau' })
    mockApi('GET', '/api/users', { items: [pau, me.profile, luis], total: 3 })
    const wrapper = await mountSuspended(UsuariosPage, { route: '/usuarios' })
    await flush()
    const cards = wrapper.get('ul[aria-label="Usuarios"]')
    const table = wrapper.get('table')
    const rowOf = (name: string) => table.findAll('tbody tr').find(row => row.text().includes(name))!
    const checked = (scope: QueryableWithGet, name: string) =>
      (scope.get(`input[aria-label="Seleccionar a ${name}"]`).element as HTMLInputElement).checked

    await cards.get('input[aria-label="Seleccionar a Luis"]').setValue(true)
    await cards.get('input[aria-label="Seleccionar a Pau"]').setValue(true)
    await vi.waitFor(() => expect(bar(wrapper)).toBeDefined())
    expect(bar(wrapper)!.get('[role="status"]').text()).toBe('2 seleccionados')
    // La tabla (escritorio) refleja lo marcado en las tarjetas.
    expect([checked(table, 'Luis'), checked(table, 'Pau'), checked(table, 'Ana')]).toEqual([true, true, false])
    expect(rowOf('Luis').classes()).toContain('bg-primary/10')
    expect(rowOf('Ana').classes()).not.toContain('bg-primary/10')
    // Una cuenta pendiente marcada conserva su fondo de aviso (no se mezclan los dos).
    expect(rowOf('Pau').classes()).toContain('bg-warning/10')
    expect(rowOf('Pau').classes()).not.toContain('bg-primary/10')
    // Las tarjetas marcadas llevan el anillo de Peticiones; la pendiente conserva su borde de aviso.
    const cardOf = (name: string) => cards.findAll('li').find(card => card.text().includes(name))!
    expect(cardOf('Luis').classes()).toEqual(expect.arrayContaining(['border-primary', 'ring-2', 'ring-primary']))
    expect(cardOf('Pau').classes()).toEqual(expect.arrayContaining(['border-warning', 'ring-2', 'ring-primary']))
    expect(cardOf('Ana').classes()).not.toContain('ring-2')

    // Y al revés: desmarcar en la tabla desmarca la tarjeta.
    await table.get('input[aria-label="Seleccionar a Luis"]').setValue(false)
    expect(checked(cards, 'Luis')).toBe(false)
    expect(rowOf('Luis').classes()).not.toContain('bg-primary/10')
    expect(bar(wrapper)!.get('[role="status"]').text()).toBe('1 seleccionado')
  })

  it('con el cambio en curso las acciones de la barra se deshabilitan y un segundo clic no manda otra petición', async () => {
    let release: ((value: unknown) => void) | undefined
    mockApi('POST', '/api/users/batch', () => new Promise((resolve) => {
      release = resolve
    }))
    const wrapper = await mountWithSelection(['Luis', 'Eva'])
    const action = (text: string) => buttonsWithText(bar(wrapper)!, text)[0]!
    const disabled = () => ['Desactivar', 'Cambiar rol', 'Eliminar'].map(text => action(text).attributes('disabled') !== undefined)
    expect(disabled()).toEqual([false, false, false])

    await action('Desactivar').trigger('click')
    await vi.waitFor(() => expect(release).toBeDefined())
    await flush()
    expect(disabled()).toEqual([true, true, true])
    expect(action('Limpiar').attributes('disabled')).toBeUndefined()

    await action('Desactivar').trigger('click')
    await action('Eliminar').trigger('click')
    await flush()
    expect(useConfirm().options.value).toBeNull()
    expect(batchPosts()).toHaveLength(1)

    release!({ updated: ['u2', 'u3'], skipped: [] })
    await flush(10)
    expect(toast()).toMatchObject({ type: 'success', message: '2 cuentas actualizadas.' })
    expect(bar(wrapper)).toBeUndefined()
  })
})

describe('Actividad', () => {
  const CREATED_AT = '2026-10-14T10:00:00.000Z'
  const entry = (changes: Partial<ActivityEntry> = {}): ActivityEntry => ({
    id: 1, actorId: 'u1', actorLabel: 'Ana', action: 'user.activate', targetType: 'user', targetId: 'u2', targetLabel: 'Luis',
    meta: { role: 'editor' }, createdAt: CREATED_AT, ...changes,
  })
  const params = (event: H3Event) => new URL(event.path, 'http://x').searchParams

  beforeEach(() => {
    mockApi('GET', '/api/users', { items: [me.profile], total: 1 })
  })

  it('lista la actividad traducida, con la hora exacta, filtros y carga más por cursor', async () => {
    mockApi('GET', '/api/activity', (event) => {
      if (params(event).get('cursor') === '2') return { items: [entry({ id: 1, action: 'file.upload', targetType: 'file', targetLabel: 'foto.jpg', meta: null })], nextCursor: null }
      if (params(event).get('action') === 'user.role_change') return { items: [entry({ id: 3, action: 'user.role_change', meta: { from: 'editor', to: 'admin' } })], nextCursor: null }
      return { items: [entry({ id: 2 })], nextCursor: '2' }
    })
    const wrapper = await mountSuspended(ActividadPage)
    await flush()
    expect(wrapper.text()).toContain('Ana activó la cuenta de Luis')
    expect(wrapper.text()).toContain('como Editor')
    // Un registro de auditoría muestra la hora exacta como texto visible, no solo la relativa.
    expect(wrapper.get('time').attributes('datetime')).toBe(CREATED_AT)
    expect(wrapper.get('time').text()).toBe(formatDateTime(CREATED_AT))

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

    clearNuxtData()
    mockApi('GET', '/api/activity', failWith(500))
    const wrapper = await mountSuspended(ActividadPage)
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar la actividad')

    mockApi('GET', '/api/activity', { items: [], nextCursor: null })
    await button(wrapper, 'Reintentar').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('Sin actividad todavía')
  })

  it('vacío por filtros: lo dice y ofrece quitarlos', async () => {
    mockApi('GET', '/api/activity', event => params(event).get('action')
      ? { items: [], nextCursor: null }
      : { items: [entry()], nextCursor: null })
    const wrapper = await mountSuspended(ActividadPage)
    await flush()
    const actionSelect = () => wrapper.findAll('select')[0]!.element as HTMLSelectElement
    await wrapper.findAll('select')[0]!.setValue('user.role_change')
    await flush()
    expect(wrapper.text()).toContain('No hay actividad con estos filtros')
    expect(wrapper.text()).not.toContain('Sin actividad todavía')

    await button(wrapper, 'Quitar filtros').trigger('click')
    await flush()
    expect(actionSelect().value).toBe('')
    expect(wrapper.text()).toContain('Ana activó la cuenta de Luis')
  })

  it('si falla la página siguiente avisa en línea y deja reintentar sin perder lo cargado', async () => {
    let failNext = true
    mockApi('GET', '/api/activity', (event) => {
      if (params(event).get('cursor') !== '2') return { items: [entry({ id: 2 })], nextCursor: '2' }
      if (failNext) return failWith(500)(event)
      return { items: [entry({ id: 1, action: 'file.upload', targetType: 'file', targetLabel: 'foto.jpg', meta: null })], nextCursor: null }
    })
    const wrapper = await mountSuspended(ActividadPage)
    await flush()
    await button(wrapper, 'Cargar más').trigger('click')
    await flush()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar más.')
    expect(wrapper.text()).toContain('Ana activó la cuenta de Luis')

    failNext = false
    await button(wrapper, 'Reintentar').trigger('click')
    await flush()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Ana subió el archivo foto.jpg')
  })

  it('filtra por persona y «Quitar filtros» también limpia ese filtro', async () => {
    mockApi('GET', '/api/activity', event => params(event).get('actor') === 'u1'
      ? { items: [], nextCursor: null }
      : { items: [entry()], nextCursor: null })
    const wrapper = await mountSuspended(ActividadPage)
    await flush()
    await wrapper.findAll('select')[1]!.setValue('u1')
    await flush()
    expect(calls.at(-1)?.url).toBe('/api/activity')
    expect(wrapper.text()).toContain('No hay actividad con estos filtros')

    await button(wrapper, 'Quitar filtros').trigger('click')
    await flush()
    expect((wrapper.findAll('select')[1]!.element as HTMLSelectElement).value).toBe('')
    expect(wrapper.text()).toContain('Ana activó la cuenta de Luis')
  })

  it('si falla la lista de personas, ese filtro se desactiva y lo explica sin ocultar la actividad', async () => {
    mockApi('GET', '/api/users', failWith(500))
    mockApi('GET', '/api/activity', { items: [entry()], nextCursor: null })
    const wrapper = await mountSuspended(ActividadPage)
    await flush()
    const people = wrapper.findAll('select')[1]!
    expect((people.element as HTMLSelectElement).disabled).toBe(true)
    expect(wrapper.text()).toContain('No pudimos cargar la lista de personas')
    expect(wrapper.text()).toContain('Ana activó la cuenta de Luis')
  })

  it('etiquetas: todas las acciones tienen texto, ícono por tipo y detalle según meta', () => {
    expect(activityLabel('x.y')).toBe('x.y')
    // Feature 002: la corrección del texto de una imagen; su meta solo trae la longitud, sin detalle visible.
    expect(activityLabel('file.text_edit')).toBe('corrigió el texto de la imagen')
    expect(activityIcon('file.text_edit')).toBe('lucide:file')
    expect(activityDetail('file.text_edit', { length: 14 })).toBe('')
    expect(activityDetail('file.upload', { size: 10 })).toBe('')
    expect(activityDetail('file.upload', { size: 10, source: 'youtube', videoId: 'okShortVid1', format: 'mp3' })).toBe('desde YouTube (Audio MP3)')
    expect(activityDetail('file.upload', { source: 'youtube' })).toBe('desde YouTube')
    expect(activityIcon('folder.create')).toBe('lucide:folder')
    expect(activityIcon('x')).toBe('lucide:activity')
    expect(activityDetail('file.rename', { from: 'a.jpg' })).toBe('antes «a.jpg»')
    expect(activityDetail('submission.reject', { reason: 'borrosa' })).toBe('motivo: borrosa')
    expect(activityDetail('comment.admin_delete', { author: 'Ana' })).toBe('escrito por Ana')
    expect(activityDetail('comment.admin_delete', { author: null })).toBe('')
    expect(activityDetail('user.role_change', { from: null, to: 'editor' })).toBe('Sin rol → Editor')
    expect(activityDetail('file.upload', null)).toBe('')
    expect(activityDetail('file.upload', { x: 1 })).toBe('')
  })
})
