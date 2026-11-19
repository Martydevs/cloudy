// Formulario de un día de trabajo: tipo obligatorio y sin preselección (con la pista de miércoles y domingo, que no
// elige nada), repetidor de rangos con errores por fila, auditorio y estado por defecto, miembros con filtro, material
// que se pide al abrir su pestaña y edición. Es contenido de página: al guardar vuelve al calendario (en el mes del día)
// y, con cambios sin guardar, pregunta antes de salir (navegación interna) y avisa al cerrar o recargar la pestaña.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { H3Event } from 'h3'
import WorkDayForm from '~/components/calendar/WorkDayForm.vue'
import { buttonsWithText, calls, failFromServer, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { setMe, toasts, workDayDetail } from './calendar-fixtures'

type Wrapper = Awaited<ReturnType<typeof mount>>

const members = [
  { id: 'u1', name: 'Ana', role: 'editor' },
  { id: 'u2', name: 'Luis', role: 'editor' },
  { id: 'u9', name: 'Pastor', role: 'admin' },
]

/** Dónde quedó la navegación (`mount` deja cada prueba en la página de agendar). */
const location = () => useRouter().currentRoute.value.fullPath
/** Tras guardar se navega al calendario, cuya página llega en otro trozo la primera vez. */
const backAtCalendar = () => vi.waitUntil(() => location() === '/calendario?fecha=2026-11-22', { timeout: 5000 })

beforeEach(async () => {
  clearNuxtData()
  resetCalls()
  useToast().toasts.value = []
  useState('work-calendar-months').value = {}
  setMe('admin', 'u9')
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/calendario', { items: [] })
  mockApi('GET', '/api/calendario/miembros', { items: members })
  mockApi('GET', '/api/songs/collections', { items: [{ id: 'c1', name: 'Domingo' }, { id: 'c2', name: 'Ensayo' }] })
  mockApi('GET', '/api/youtube/playlists', { items: [{ id: 'p1', name: 'Entrada' }] })
  mockApi('GET', '/api/folders/tree', [
    { id: 'f2', name: 'Navidad', parentId: 'f1' },
    { id: 'f1', name: 'Eventos', parentId: null },
    { id: 'f3', name: 'Huérfana', parentId: 'no-existe' },
  ])
  mockApi('POST', '/api/calendario', (event: H3Event) => {
    event.node.res.statusCode = 201
    return workDayDetail({ title: 'Conferencia' })
  })
})

async function mount(props: Record<string, unknown> = { initialDate: '2026-11-20' }) {
  const wrapper = await mountSuspended(WorkDayForm, { props, attachTo: document.body, route: '/calendario/nuevo?fecha=2026-11-20' })
  await flush(10)
  return wrapper
}

const field = (wrapper: Wrapper, label: string) => {
  const found = wrapper.findAll('label').find(l => l.text().trim().startsWith(label))!
  return wrapper.get(`[id="${found.attributes('for')}"]`)
}
const radios = (wrapper: Wrapper) => wrapper.findAll('input[type="radio"]')
const times = (wrapper: Wrapper) => wrapper.findAll('input[type="time"]')
const tab = (wrapper: Wrapper, label: string) => wrapper.findAll('[role="tab"]').find(t => t.text().trim() === label)!
const checkbox = (wrapper: Wrapper, name: string) => wrapper.findAll('label').find(l => l.text().trim() === name)!.get('input[type="checkbox"]')
const hint = (wrapper: Wrapper) => wrapper.get('fieldset [role="status"]').text()
const posted = () => calls.find(call => call.method === 'POST' && call.url === '/api/calendario')?.body

async function fill(wrapper: Wrapper) {
  await field(wrapper, 'Título del evento').setValue('  Conferencia  ')
  await radios(wrapper)[1]!.setValue(true)
  await times(wrapper)[0]!.setValue('18:00')
  await times(wrapper)[1]!.setValue('20:00')
}

describe('WorkDayForm — agendar', () => {
  it('abre con la fecha del calendario, sin tipo elegido, «Skykids Auditorium» y «Sin iniciar»', async () => {
    const wrapper = await mount()
    expect(wrapper.get('h1').text()).toBe('Agendar día')
    expect((field(wrapper, 'Fecha').element as HTMLInputElement).value).toBe('2026-11-20')
    expect(radios(wrapper).map(radio => (radio.element as HTMLInputElement).checked)).toEqual([false, false])
    expect((field(wrapper, 'Auditorio').element as HTMLInputElement).value).toBe('Skykids Auditorium')
    expect((field(wrapper, 'Estado').element as HTMLSelectElement).value).toBe('not_started')
    expect(times(wrapper)).toHaveLength(2)
    // El material no se pide con el formulario.
    expect(calls.some(call => ['/api/songs/collections', '/api/youtube/playlists', '/api/folders/tree'].includes(call.url))).toBe(false)
    wrapper.unmount()
  })

  it('en miércoles o domingo muestra la pista, pero no elige el tipo; otro día no la muestra', async () => {
    const wrapper = await mount()
    expect(hint(wrapper)).toBe('')
    for (const date of ['2026-11-18', '2026-11-22']) {
      await field(wrapper, 'Fecha').setValue(date)
      expect(hint(wrapper)).toBe('Los miércoles y domingos suelen ser días normales')
      expect(radios(wrapper).map(radio => (radio.element as HTMLInputElement).checked)).toEqual([false, false])
    }
    await field(wrapper, 'Fecha').setValue('2026-11-19')
    expect(hint(wrapper)).toBe('')
    wrapper.unmount()
  })

  it('enviar vacío marca cada campo con su motivo y no llama al servidor', async () => {
    const wrapper = await mount({})
    await field(wrapper, 'Auditorio').setValue('')
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(wrapper.text()).toContain('Este campo es obligatorio')
    expect(wrapper.text()).toContain('Elige una fecha válida')
    expect(wrapper.text()).toContain('Elige si es un día normal o especial')
    expect(wrapper.text()).toContain('Escribe una hora válida')
    expect(field(wrapper, 'Título del evento').attributes('aria-invalid')).toBe('true')
    expect(posted()).toBeUndefined()
    expect(location()).toBe('/calendario/nuevo?fecha=2026-11-20')
    wrapper.unmount()
  })

  it('rangos de hora: se agregan hasta 6, se quitan (nunca el último) y cada fila dice su error', async () => {
    const wrapper = await mount()
    const remove = () => wrapper.findAll('button').filter(b => b.attributes('aria-label')?.startsWith('Quitar el rango'))
    expect(remove()[0]!.attributes('disabled')).toBeDefined()
    for (let i = 0; i < 5; i++) await buttonsWithText(wrapper, 'Agregar rango')[0]!.trigger('click')
    expect(times(wrapper)).toHaveLength(12)
    expect(buttonsWithText(wrapper, 'Agregar rango')[0]!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Máximo 6 rangos por día')
    for (let i = 0; i < 3; i++) await remove()[5 - i]!.trigger('click')
    expect(times(wrapper)).toHaveLength(6)

    // Una fila a medias no se queja; al completarla aparece su error.
    await times(wrapper)[0]!.setValue('10:00')
    expect(wrapper.text()).not.toContain('La hora de fin debe ser posterior')
    await times(wrapper)[1]!.setValue('09:00')
    expect(wrapper.text()).toContain('La hora de fin debe ser posterior a la de inicio')
    await times(wrapper)[1]!.setValue('12:00')
    await times(wrapper)[2]!.setValue('11:00')
    await times(wrapper)[3]!.setValue('13:00')
    expect(wrapper.findAll('p.text-error').map(p => p.text())).toEqual(['Este rango se cruza con otro', 'Este rango se cruza con otro'])
    expect(times(wrapper)[0]!.attributes('aria-invalid')).toBe('true')
    // La tercera fila sigue vacía: sin error hasta enviar.
    expect(times(wrapper)[4]!.attributes('aria-invalid')).toBeUndefined()
    wrapper.unmount()
  })

  it('miembros: lista de casillas con filtro por nombre', async () => {
    const wrapper = await mount()
    const list = () => wrapper.get('[aria-label="Personas del equipo"]').findAll('li').map(li => li.text().trim())
    expect(list()).toEqual(['Ana', 'Luis', 'Pastor'])
    await wrapper.get('input[type="search"]').setValue('  lu ')
    expect(list()).toEqual(['Luis'])
    await checkbox(wrapper, 'Luis').setValue(true)
    await wrapper.get('input[type="search"]').setValue('zzz')
    expect(wrapper.text()).toContain('Nadie coincide con la búsqueda.')
    await wrapper.get('input[type="search"]').setValue('')
    expect((checkbox(wrapper, 'Luis').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('(1 de 30)')
    wrapper.unmount()
  })

  it('si los miembros no cargan, ofrece reintentar', async () => {
    mockApi('GET', '/api/calendario/miembros', failWith(500))
    const wrapper = await mount()
    expect(wrapper.text()).toContain('No pudimos cargar a los miembros')
    mockApi('GET', '/api/calendario/miembros', { items: members })
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.find('[aria-label="Personas del equipo"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('material: cada lista se pide al abrir su pestaña y lo elegido queda como insignia que se puede quitar', async () => {
    const wrapper = await mount()
    expect(wrapper.text()).toContain('Sin material adjunto. Elige una pestaña para adjuntar.')
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false)

    await tab(wrapper, 'Canciones').trigger('click')
    await flush(10)
    expect(calls.filter(call => call.url === '/api/songs/collections')).toHaveLength(1)
    expect(calls.some(call => call.url === '/api/youtube/playlists')).toBe(false)
    expect(tab(wrapper, 'Canciones').attributes('aria-selected')).toBe('true')
    await checkbox(wrapper, 'Domingo').setValue(true)

    await tab(wrapper, 'Carpetas').trigger('click')
    await flush(10)
    // Las carpetas se muestran con su ruta, ordenadas.
    expect(wrapper.get('[role="tabpanel"]').findAll('li').map(li => li.text().trim())).toEqual(['Eventos', 'Eventos / Navidad', 'Huérfana'])
    await checkbox(wrapper, 'Eventos / Navidad').setValue(true)

    // Volver a una pestaña ya abierta no la pide de nuevo.
    await tab(wrapper, 'Canciones').trigger('click')
    await flush(10)
    expect(calls.filter(call => call.url === '/api/songs/collections')).toHaveLength(1)
    expect((checkbox(wrapper, 'Domingo').element as HTMLInputElement).checked).toBe(true)

    const chips = () => wrapper.get('[aria-label="Material adjunto"]').findAll('button').map(b => b.attributes('aria-label'))
    expect(chips()).toEqual(['Quitar Domingo (Canciones)', 'Quitar Eventos / Navidad (Carpetas)'])
    await wrapper.get('[aria-label="Quitar Domingo (Canciones)"]').trigger('click')
    expect(chips()).toEqual(['Quitar Eventos / Navidad (Carpetas)'])
    expect((checkbox(wrapper, 'Domingo').element as HTMLInputElement).checked).toBe(false)
    // Desmarcar la casilla también lo quita.
    await tab(wrapper, 'Carpetas').trigger('click')
    await checkbox(wrapper, 'Eventos / Navidad').setValue(false)
    expect(wrapper.find('[aria-label="Material adjunto"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('material: lista vacía y fallo con reintento', async () => {
    mockApi('GET', '/api/youtube/playlists', { items: [] })
    mockApi('GET', '/api/songs/collections', failWith(500))
    const wrapper = await mount()
    await tab(wrapper, 'YouTube').trigger('click')
    await flush(10)
    expect(wrapper.get('[role="tabpanel"]').text()).toBe('Aún no hay listas de YouTube.')
    await tab(wrapper, 'Canciones').trigger('click')
    await flush(10)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('No pudimos cargar las colecciones')
    mockApi('GET', '/api/songs/collections', { items: [{ id: 'c1', name: 'Domingo' }] })
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(10)
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Domingo')
    wrapper.unmount()
  })

  it('agenda el día con todo lo elegido, avisa y vuelve al calendario en el mes del día', async () => {
    const wrapper = await mount()
    await fill(wrapper)
    await buttonsWithText(wrapper, 'Agregar rango')[0]!.trigger('click')
    await times(wrapper)[2]!.setValue('09:00')
    await times(wrapper)[3]!.setValue('11:30')
    await checkbox(wrapper, 'Ana').setValue(true)
    await tab(wrapper, 'YouTube').trigger('click')
    await flush(10)
    await checkbox(wrapper, 'Entrada').setValue(true)
    await field(wrapper, 'Estado').setValue('in_progress')
    await wrapper.get('form').trigger('submit')
    await flush(15)
    expect(posted()).toEqual({
      title: 'Conferencia',
      date: '2026-11-20',
      kind: 'special',
      status: 'in_progress',
      auditorium: 'Skykids Auditorium',
      // Ordenados por hora de inicio.
      slots: [{ start: '09:00', end: '11:30' }, { start: '18:00', end: '20:00' }],
      memberIds: ['u1'],
      songCollectionIds: [],
      youtubePlaylistIds: ['p1'],
      folderIds: [],
    })
    expect(toasts()).toContain('Se agendó «Conferencia»')
    // Con el formulario lleno, pero ya guardado: sale sin preguntar, a la fecha del día guardado.
    expect(useConfirm().options.value).toBeNull()
    await backAtCalendar()
    wrapper.unmount()
  })

  it('si el servidor rechaza, muestra su motivo y el formulario sigue en pantalla con lo escrito', async () => {
    mockApi('POST', '/api/calendario', failFromServer(409, 'Conflict', 'Parte del material elegido ya no existe. Revísalo e inténtalo de nuevo.', { code: 'material_unavailable', ids: [] }))
    const wrapper = await mount()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flush(15)
    expect(toasts()).toContain('Parte del material elegido ya no existe. Revísalo e inténtalo de nuevo.')
    expect(location()).toBe('/calendario/nuevo?fecha=2026-11-20')
    expect((field(wrapper, 'Título del evento').element as HTMLInputElement).value).toBe('  Conferencia  ')
    wrapper.unmount()
  })

  it('sin cambios sale directo, a la fecha con la que se abrió; con cambios pregunta antes de perderlos', async () => {
    const clean = await mount()
    expect(clean.get('a').text()).toBe('Volver al calendario')
    await buttonsWithText(clean, 'Cancelar')[0]!.trigger('click')
    await flush(10)
    expect(useConfirm().options.value).toBeNull()
    expect(location()).toBe('/calendario?fecha=2026-11-20')
    clean.unmount()

    const wrapper = await mount()
    await field(wrapper, 'Título del evento').setValue('Borrador')
    await buttonsWithText(wrapper, 'Cancelar')[0]!.trigger('click')
    await flush()
    expect(useConfirm().options.value).toMatchObject({ title: '¿Salir sin guardar?', confirmLabel: 'Salir sin guardar', danger: true })
    useConfirm().cancel()
    await flush(10)
    expect(location()).toBe('/calendario/nuevo?fecha=2026-11-20')
    expect((field(wrapper, 'Título del evento').element as HTMLInputElement).value).toBe('Borrador')
    // Cualquier otra salida (el menú, el enlace de volver) pasa por la misma pregunta.
    const leaving = useRouter().push('/perfil')
    await flush()
    useConfirm().accept()
    await leaving
    expect(location()).toBe('/perfil')
    wrapper.unmount()
  })

  it('al cerrar o recargar la pestaña, el navegador avisa solo si hay cambios sin guardar', async () => {
    const wrapper = await mount()
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(unload()).toBe(false)
    await field(wrapper, 'Título del evento').setValue('Borrador')
    expect(unload()).toBe(true)
    wrapper.unmount()
    // Desmontado, el guardián ya no pregunta.
    await useRouter().push('/perfil')
    expect(useConfirm().options.value).toBeNull()
    expect(unload()).toBe(false)
  })

  it('mientras guarda no se sale ni se envía dos veces', async () => {
    let release: (() => void) | undefined
    mockApi('POST', '/api/calendario', () => new Promise(resolve => (release = () => resolve(workDayDetail()))))
    const wrapper = await mount()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flush(10)
    expect(wrapper.get('[role="status"].sr-only').text()).toBe('Guardando…')
    expect(buttonsWithText(wrapper, 'Cancelar')[0]!.attributes('disabled')).toBeDefined()
    await useRouter().push('/perfil')
    await wrapper.get('form').trigger('submit')
    await flush(5)
    expect(useConfirm().options.value).toBeNull()
    expect(location()).toBe('/calendario/nuevo?fecha=2026-11-20')
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
    release!()
    await flush(15)
    await backAtCalendar()
    wrapper.unmount()
  })
})

describe('WorkDayForm — editar', () => {
  const day = workDayDetail({ kind: 'special', status: 'in_progress', auditorium: 'Auditorio B' })

  it('llega con los datos del día, sus rangos, miembros (el inactivo como «Persona inactiva») y material', async () => {
    const wrapper = await mount({ day })
    expect(wrapper.get('h1').text()).toBe('Editar día')
    expect((field(wrapper, 'Título del evento').element as HTMLInputElement).value).toBe('Servicio dominical')
    expect(radios(wrapper).map(radio => (radio.element as HTMLInputElement).checked)).toEqual([false, true])
    expect(times(wrapper).map(input => (input.element as HTMLInputElement).value)).toEqual(['09:00', '11:00', '18:00', '20:00'])
    expect((field(wrapper, 'Auditorio').element as HTMLInputElement).value).toBe('Auditorio B')
    expect((field(wrapper, 'Estado').element as HTMLSelectElement).value).toBe('in_progress')
    expect(wrapper.get('[aria-label="Personas del equipo"]').findAll('li').map(li => li.text().trim())).toEqual(['Ana', 'Luis', 'Pastor', 'Persona inactiva'])
    expect((checkbox(wrapper, 'Persona inactiva').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.get('[aria-label="Material adjunto"]').findAll('button').map(b => b.text().trim())).toEqual(['Domingo', 'Entrada', 'Fotos del evento'])
    wrapper.unmount()
  })

  it('guarda con PATCH reemplazando todo y avisa', async () => {
    mockApi('PATCH', '/api/calendario/d1', workDayDetail({ title: 'Servicio de jóvenes' }))
    const wrapper = await mount({ day })
    await field(wrapper, 'Título del evento').setValue('Servicio de jóvenes')
    await checkbox(wrapper, 'Persona inactiva').setValue(false)
    await wrapper.get('[aria-label="Quitar Entrada (YouTube)"]').trigger('click')
    // Doble envío seguido (doble clic): solo sale una petición.
    await buttonsWithText(wrapper, 'Guardar cambios')[0]!.trigger('click')
    await wrapper.get('form').trigger('submit')
    await flush(15)
    expect(calls.filter(call => call.method === 'PATCH')).toHaveLength(1)
    expect(calls.find(call => call.method === 'PATCH')).toEqual({
      method: 'PATCH',
      url: '/api/calendario/d1',
      body: {
        title: 'Servicio de jóvenes',
        date: '2026-11-22',
        kind: 'special',
        status: 'in_progress',
        auditorium: 'Auditorio B',
        slots: [{ start: '09:00', end: '11:00' }, { start: '18:00', end: '20:00' }],
        memberIds: ['u1'],
        songCollectionIds: ['c1'],
        youtubePlaylistIds: [],
        folderIds: ['f1'],
      },
    })
    expect(toasts()).toContain('Se guardaron los cambios de «Servicio de jóvenes»')
    await backAtCalendar()
    wrapper.unmount()
  })

  it('si no se pudo guardar, avisa con el texto de edición', async () => {
    mockApi('PATCH', '/api/calendario/d1', failWith(500))
    const wrapper = await mount({ day })
    await wrapper.get('form').trigger('submit')
    await flush(15)
    expect(toasts()).toContain('No pudimos guardar los cambios. Inténtalo de nuevo.')
    expect(location()).toBe('/calendario/nuevo?fecha=2026-11-20')
    wrapper.unmount()
  })
})
