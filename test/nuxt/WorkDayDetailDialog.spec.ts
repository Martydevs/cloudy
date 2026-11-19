// Detalle de un día: solo lectura para el equipo (cuatro estados, material con enlaces a su página); el estado lo cambia
// quien administra y el editor asignado al día; editar y eliminar (con confirmación), solo quien administra.
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WorkDayDetailDialog from '~/components/calendar/WorkDayDetailDialog.vue'
import { buttonsWithText, calls, failFromServer, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { setMe, toasts, workDayDetail } from './calendar-fixtures'

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  useState('work-calendar-months').value = {}
  setMe('editor')
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/calendario', { items: [] })
  mockApi('GET', '/api/calendario/d1', workDayDetail())
})

const HINT = 'Solo quienes están asignados a este día pueden cambiar su estado.'

/** `canManage` monta como administrador (u9); sin él, como el editor de `beforeEach` (u1, asignado al día de muestra). */
function mount(canManage = false) {
  if (canManage) setMe('admin', 'u9')
  return mountSuspended(WorkDayDetailDialog, { props: { dayId: 'd1', canManage }, attachTo: document.body })
}

describe('WorkDayDetailDialog', () => {
  it('muestra fecha, auditorio, horario, tipo, estado, miembros y quién lo agendó', async () => {
    const wrapper = await mount()
    await flush(10)
    expect(wrapper.get('h2').text()).toBe('Servicio dominical')
    expect(wrapper.text()).toContain('domingo, 22 de noviembre de 2026')
    expect(wrapper.text()).toContain('Skykids Auditorium')
    expect(wrapper.get('[aria-label="Rangos de hora"]').findAll('li').map(li => li.text())).toEqual(['09:00–11:00', '18:00–20:00'])
    expect(wrapper.text()).toContain('Normal')
    expect(wrapper.text()).toContain('Sin iniciar')
    expect(wrapper.get('[aria-label="Miembros asignados"]').findAll('li').map(li => li.text())).toEqual(['Ana', 'Persona inactiva'])
    expect(wrapper.text()).toContain('Agendado por Pastor')
    wrapper.unmount()
  })

  it('el material enlaza a su página: canciones, videos y la carpeta', async () => {
    const wrapper = await mount()
    await flush(10)
    const materials = wrapper.get('[aria-label="Material adjunto"]')
    expect(materials.text()).toContain('Colección de canciones · 60 canciones')
    expect(materials.text()).toContain('Se muestran los primeros 1.')
    expect(materials.text()).toContain('Lista de YouTube · 1 video')
    expect(materials.text()).toContain('Carpeta · 4 elementos')
    const links = materials.findAll('a').map(a => [a.text().trim(), a.attributes('href')])
    expect(links).toEqual([
      ['De Buenas', '/canciones/song-1'],
      ['Cuenta regresiva', '/youtube/okShortVid1'],
      ['Abrir', '/archivos/f1'],
    ])
    wrapper.unmount()
  })

  it('sin miembros ni material lo dice; un autor inactivo no muestra su nombre', async () => {
    mockApi('GET', '/api/calendario/d1', workDayDetail({ members: [], materials: [], createdBy: { userId: 'u9', name: 'Usuario', active: false } }))
    const wrapper = await mount()
    await flush(10)
    expect(wrapper.text()).toContain('Sin miembros asignados')
    expect(wrapper.text()).toContain('Sin material adjunto')
    expect(wrapper.text()).toContain('Agendado por Persona inactiva')
    wrapper.unmount()
  })

  it('el editor asignado al día cambia su estado, pero no edita ni elimina', async () => {
    mockApi('PATCH', '/api/calendario/d1/estado', { id: 'd1', status: 'in_progress' })
    const wrapper = await mount()
    await flush(10)
    expect(wrapper.text()).not.toContain(HINT)
    expect(buttonsWithText(wrapper, 'Editar')).toHaveLength(0)
    expect(buttonsWithText(wrapper, 'Eliminar')).toHaveLength(0)
    const select = wrapper.get('select')
    expect(wrapper.get(`label[for="${select.attributes('id')}"]`).text()).toBe('Estado')
    mockApi('GET', '/api/calendario/d1', workDayDetail({ status: 'in_progress' }))
    await select.setValue('in_progress')
    await flush(10)
    expect(calls.find(call => call.method === 'PATCH')).toEqual({ method: 'PATCH', url: '/api/calendario/d1/estado', body: { status: 'in_progress' } })
    expect(toasts()).toContain('«Servicio dominical» ahora está: En proceso')
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('in_progress')
    wrapper.unmount()
  })

  it('si al guardar ya no está asignado (403), avisa con el texto del servidor y, al refrescar, el control desaparece', async () => {
    mockApi('PATCH', '/api/calendario/d1/estado', failFromServer(403, 'Forbidden', 'Solo quienes están asignados al día pueden cambiar su estado.'))
    const wrapper = await mount()
    await flush(10)
    mockApi('GET', '/api/calendario/d1', workDayDetail({ members: [] }))
    await wrapper.get('select').setValue('finished')
    await flush(10)
    expect(toasts()).toContain('Solo quienes están asignados al día pueden cambiar su estado.')
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain(HINT)
    wrapper.unmount()
  })

  it('el editor que no está asignado solo ve: sin estado, editar ni eliminar, y se le explica por qué', async () => {
    setMe('editor', 'u5')
    const wrapper = await mount()
    await flush(10)
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain(HINT)
    expect(buttonsWithText(wrapper, 'Editar')).toHaveLength(0)
    expect(buttonsWithText(wrapper, 'Eliminar')).toHaveLength(0)
    await wrapper.get('button[aria-label="Cerrar"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('un día que ya no existe lo explica sin reintento; otro fallo ofrece reintentar', async () => {
    mockApi('GET', '/api/calendario/d1', failFromServer(404, 'No encontrado', 'Ese día ya no está en el calendario.'))
    const gone = await mount()
    await flush(10)
    expect(gone.text()).toContain('Ese día ya no está en el calendario.')
    expect(buttonsWithText(gone, 'Reintentar')).toHaveLength(0)
    gone.unmount()

    clearNuxtData()
    mockApi('GET', '/api/calendario/d1', failWith(500))
    const failed = await mount()
    await flush(10)
    expect(failed.get('[role="alert"]').text()).toContain('No pudimos cargar el día')
    mockApi('GET', '/api/calendario/d1', workDayDetail())
    await buttonsWithText(failed, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(failed.get('h2').text()).toBe('Servicio dominical')
    failed.unmount()
  })

  it('quien administra cambia el estado desde el detalle', async () => {
    mockApi('PATCH', '/api/calendario/d1/estado', { id: 'd1', status: 'finished' })
    const wrapper = await mount(true)
    await flush(10)
    expect(wrapper.text()).not.toContain(HINT)
    const select = wrapper.get('select')
    expect((select.element as HTMLSelectElement).value).toBe('not_started')
    expect(select.findAll('option').map(option => option.text())).toEqual(['Sin iniciar', 'En proceso', 'Finalizado'])
    mockApi('GET', '/api/calendario/d1', workDayDetail({ status: 'finished' }))
    await select.setValue('finished')
    await flush(10)
    expect(calls.find(call => call.method === 'PATCH')).toEqual({ method: 'PATCH', url: '/api/calendario/d1/estado', body: { status: 'finished' } })
    expect(toasts()).toContain('«Servicio dominical» ahora está: Finalizado')
    expect(wrapper.text()).toContain('Finalizado')
    wrapper.unmount()
  })

  it('Editar entrega el día cargado al formulario', async () => {
    const wrapper = await mount(true)
    await flush(10)
    await buttonsWithText(wrapper, 'Editar')[0]!.trigger('click')
    expect(wrapper.emitted('edit')![0]).toEqual([workDayDetail()])
    wrapper.unmount()
  })

  it('Eliminar pide confirmación: cancelar no borra; aceptar borra, avisa y cierra', async () => {
    mockApi('DELETE', '/api/calendario/d1', null)
    const wrapper = await mount(true)
    await flush(10)
    await buttonsWithText(wrapper, 'Eliminar')[0]!.trigger('click')
    await flush()
    expect(useConfirm().options.value).toMatchObject({ title: '¿Eliminar «Servicio dominical» del calendario?', confirmLabel: 'Eliminar día', danger: true })
    useConfirm().cancel()
    await flush(10)
    expect(calls.some(call => call.method === 'DELETE')).toBe(false)
    expect(wrapper.emitted('close')).toBeUndefined()

    await buttonsWithText(wrapper, 'Eliminar')[0]!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush(10)
    expect(calls.some(call => call.method === 'DELETE' && call.url === '/api/calendario/d1')).toBe(true)
    expect(toasts()).toContain('Se eliminó «Servicio dominical» del calendario')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('si no se pudo eliminar, avisa y el detalle sigue abierto', async () => {
    mockApi('DELETE', '/api/calendario/d1', failWith(500))
    const wrapper = await mount(true)
    await flush(10)
    await buttonsWithText(wrapper, 'Eliminar')[0]!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush(10)
    expect(toasts()).toContain('No pudimos eliminar el día. Inténtalo de nuevo.')
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })
})
