// Página /calendario por rol y con sus estados: la lista «Próximos días» (carga, vacío, error con reintento, contenido),
// el calendario diferido (SVAR simulado: happy-dom no reemplaza a un navegador) con su carga por meses y su caché, y los
// diálogos de detalle y de formulario. Los editores solo ven; los administradores agendan y cambian el estado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import type { H3Event } from 'h3'
import CalendarioPage from '~/pages/calendario.vue'
import { buttonsWithText, calls, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { setMe, toasts, workDay, workDayDetail } from './calendar-fixtures'

vi.mock('@svar-ui/vue-calendar', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Calendar: defineComponent({
      props: ['events', 'view', 'date', 'views', 'toolbar', 'eventCss', 'eventContent', 'init', 'readonly'],
      setup(props) {
        return () => h('div', { 'data-svar': props.view }, (props.events as Record<string, unknown>[]).map(event =>
          h('div', { key: event.id as string, class: 'wx-event' }, [h(props.eventContent, { event, mode: 'grid' })])))
      },
    }),
    Willow: defineComponent({ props: ['fonts'], setup: (_, { slots }) => () => h('div', { class: 'wx-willow-theme' }, slots.default?.()) }),
  }
})
vi.mock('@svar-ui/vue-core', async () => {
  const { defineComponent } = await import('vue')
  return { Locale: defineComponent({ props: ['words'], setup: (_, { slots }) => () => slots.default?.() }) }
})

type Wrapper = Awaited<ReturnType<typeof mount>>

/** Rangos pedidos a `GET /api/calendario`, en orden. */
const ranges: { from: string, to: string }[] = []
let byMonth: Record<string, unknown> = {}
let wide = true

/** La lista pide 30 días desde «hoy»; el calendario, meses completos. */
function calendarApi(event: H3Event) {
  const { from, to } = getQuery(event) as { from: string, to: string }
  ranges.push({ from, to })
  const reply = from.endsWith('-01') ? byMonth[from.slice(0, 7)] ?? { items: [] } : byMonth.upcoming ?? { items: [] }
  if (typeof reply === 'function') return (reply as (event: H3Event) => unknown)(event)
  return reply
}

/** Los componentes diferidos (`Lazy*`) llegan en otro trozo: la primera vez tardan unos ciclos más. */
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 60 && !check(); i++) await flush(5)
}

async function mount() {
  const wrapper = await mountSuspended(CalendarioPage, { attachTo: document.body })
  await waitFor(() => wrapper.find('[data-svar]').exists())
  await flush(20)
  return wrapper
}

const monthRanges = () => ranges.filter(range => range.from.endsWith('-01')).map(range => `${range.from}…${range.to}`)
const calendarButton = (wrapper: Wrapper, label: string) => wrapper.findAll('.cloudy-calendar button').find(b => (b.attributes('aria-label') ?? b.text().trim()) === label)!

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 10, 18, 12, 0), toFake: ['Date'] })
  clearNuxtData()
  resetCalls()
  ranges.length = 0
  wide = true
  vi.stubGlobal('matchMedia', () => ({ matches: wide }))
  useToast().toasts.value = []
  useState('work-calendar-months').value = {}
  useState('work-calendar-today').value = '2026-11-18'
  setMe('editor')
  byMonth = {
    'upcoming': { items: [workDay(), workDay({ id: 'd2', title: 'Conferencia', date: '2026-12-05', kind: 'special', slots: [{ id: 's3', start: '10:00', end: '12:00' }] })] },
    '2026-11': { items: [workDay()] },
    '2026-12': { items: [workDay({ id: 'd2', title: 'Conferencia', date: '2026-12-05', kind: 'special', slots: [{ id: 's3', start: '10:00', end: '12:00' }] })] },
  }
  mockApi('GET', '/api/me', () => useMe().me.value)
  mockApi('GET', '/api/calendario', calendarApi)
  mockApi('GET', '/api/calendario/d1', workDayDetail())
  mockApi('GET', '/api/calendario/miembros', { items: [] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('/calendario', () => {
  it('el editor ve el título, la lista y el calendario, pero no «Agendar día»', async () => {
    const wrapper = await mount()
    expect(wrapper.get('h1').text()).toBe('Calendario')
    expect(wrapper.findAll('h2').map(h => h.text())).toEqual(['Próximos días', 'Calendario'])
    expect(buttonsWithText(wrapper, 'Agendar día')).toHaveLength(0)
    const list = wrapper.get('ul[aria-label="Próximos días"]')
    expect(list.findAll(':scope > li')).toHaveLength(2)
    expect(buttonsWithText(wrapper, 'Iniciar')).toHaveLength(0)
    expect(wrapper.find('[data-svar]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('la lista pide 30 días desde hoy (en la zona de la iglesia)', async () => {
    const wrapper = await mount()
    expect(ranges).toContainEqual({ from: '2026-11-18', to: '2026-12-17' })
    wrapper.unmount()
  })

  it('el calendario pide el mes visible y precarga el anterior y el siguiente, completos', async () => {
    const wrapper = await mount()
    expect(monthRanges().sort()).toEqual(['2026-10-01…2026-10-31', '2026-11-01…2026-11-30', '2026-12-01…2026-12-31'])
    // Un evento por rango de cada día conocido (los dos de noviembre y el de diciembre, ya precargado).
    expect(wrapper.findAll('.wx-event')).toHaveLength(3)
    wrapper.unmount()
  })

  it('pasar a un mes ya precargado no vuelve a pedirlo: solo trae el nuevo vecino', async () => {
    const wrapper = await mount()
    ranges.length = 0
    await calendarButton(wrapper, 'Periodo siguiente').trigger('click')
    await flush(20)
    expect(monthRanges()).toEqual(['2027-01-01…2027-01-31'])
    expect(wrapper.get('[data-calendar-label]').text()).toBe('diciembre de 2026')
    wrapper.unmount()
  })

  it('desde 640 px abre en mes; por debajo, en día', async () => {
    const desktop = await mount()
    expect(desktop.get('[data-svar]').attributes('data-svar')).toBe('month')
    desktop.unmount()
    wide = false
    const phone = await mount()
    expect(phone.get('[data-svar]').attributes('data-svar')).toBe('day')
    phone.unmount()
  })

  it('un periodo sin días lo dice en una región de estado', async () => {
    byMonth['2026-11'] = { items: [] }
    const wrapper = await mount()
    expect(wrapper.findAll('[role="status"]').some(status => status.text() === 'No hay días agendados en este periodo.')).toBe(true)
    wrapper.unmount()
  })

  it('si el mes no carga muestra el error con reintento, y reintentar lo trae', async () => {
    byMonth['2026-11'] = failWith(500)
    const wrapper = await mount()
    expect(wrapper.findAll('[role="alert"]').some(alert => alert.text().includes('No pudimos cargar el calendario'))).toBe(true)
    byMonth['2026-11'] = { items: [workDay()] }
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    await flush(20)
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(0)
    expect(wrapper.findAll('.wx-event')).toHaveLength(3)
    wrapper.unmount()
  })

  it('lista vacía: lo explica; lista con error: reintento', async () => {
    byMonth.upcoming = { items: [] }
    const empty = await mount()
    expect(empty.text()).toContain('No hay días agendados en los próximos 30 días')
    empty.unmount()

    clearNuxtData()
    byMonth.upcoming = failWith(500)
    const failed = await mount()
    expect(failed.text()).toContain('No pudimos cargar los próximos días')
    byMonth.upcoming = { items: [workDay()] }
    await buttonsWithText(failed, 'Reintentar')[0]!.trigger('click')
    await flush(20)
    expect(failed.find('ul[aria-label="Próximos días"]').exists()).toBe(true)
    failed.unmount()
  })

  it('abrir un día desde la lista o desde un evento del calendario muestra su detalle (sin acciones para el editor)', async () => {
    const wrapper = await mount()
    await wrapper.get('ul[aria-label="Próximos días"] button').trigger('click')
    const dialog = () => wrapper.find('dialog')
    await waitFor(() => wrapper.find('dialog h2').exists() && wrapper.get('dialog h2').text() === 'Servicio dominical')
    expect(dialog().get('h2').text()).toBe('Servicio dominical')
    expect(buttonsWithText(dialog(), 'Editar')).toHaveLength(0)
    await dialog().get('button[aria-label="Cerrar"]').trigger('click')
    await flush()
    expect(dialog().exists()).toBe(false)

    await wrapper.get('.wx-event button').trigger('click')
    await waitFor(() => wrapper.find('dialog h2').exists() && wrapper.get('dialog h2').text() === 'Servicio dominical')
    expect(dialog().get('h2').text()).toBe('Servicio dominical')
    wrapper.unmount()
  })
})

describe('/calendario — administrador', () => {
  beforeEach(() => setMe('admin', 'u9'))

  it('«Agendar día» abre el formulario con la fecha que muestra el calendario', async () => {
    const wrapper = await mount()
    await calendarButton(wrapper, 'Periodo siguiente').trigger('click')
    await buttonsWithText(wrapper, 'Agendar día')[0]!.trigger('click')
    await waitFor(() => wrapper.find('dialog').exists())
    await flush(20)
    const dialog = wrapper.get('dialog')
    expect(dialog.get('h2').text()).toBe('Agendar día')
    expect((dialog.get('input[type="date"]').element as HTMLInputElement).value).toBe('2026-12-01')
    await buttonsWithText(dialog, 'Cancelar')[0]!.trigger('click')
    await flush()
    expect(wrapper.find('dialog').exists()).toBe(false)
    wrapper.unmount()
  })

  it('con la lista vacía, el botón del estado vacío también agenda', async () => {
    byMonth.upcoming = { items: [] }
    const wrapper = await mount()
    expect(buttonsWithText(wrapper, 'Agendar día')).toHaveLength(2)
    await buttonsWithText(wrapper, 'Agendar día')[1]!.trigger('click')
    await waitFor(() => wrapper.find('dialog').exists())
    await flush(20)
    expect((wrapper.get('dialog input[type="date"]').element as HTMLInputElement).value).toBe('2026-11-18')
    wrapper.unmount()
  })

  it('cambia el estado con un toque desde la lista y refresca la lista y los meses conocidos', async () => {
    mockApi('PATCH', '/api/calendario/d1/estado', { id: 'd1', status: 'in_progress' })
    const wrapper = await mount()
    ranges.length = 0
    byMonth.upcoming = { items: [workDay({ status: 'in_progress' })] }
    await buttonsWithText(wrapper, 'Iniciar')[0]!.trigger('click')
    await flush(20)
    expect(calls.find(call => call.method === 'PATCH')).toEqual({ method: 'PATCH', url: '/api/calendario/d1/estado', body: { status: 'in_progress' } })
    expect(toasts()).toContain('«Servicio dominical» ahora está: En proceso')
    expect(ranges).toContainEqual({ from: '2026-11-18', to: '2026-12-17' })
    expect(monthRanges().sort()).toEqual(['2026-10-01…2026-10-31', '2026-11-01…2026-11-30', '2026-12-01…2026-12-31'])
    expect(buttonsWithText(wrapper, 'Finalizar')).toHaveLength(1)
    wrapper.unmount()
  })

  it('si el cambio de estado falla, avisa y la lista queda igual', async () => {
    mockApi('PATCH', '/api/calendario/d1/estado', failWith(500))
    const wrapper = await mount()
    await buttonsWithText(wrapper, 'Iniciar')[0]!.trigger('click')
    await flush(20)
    expect(toasts()).toContain('No pudimos cambiar el estado. Inténtalo de nuevo.')
    expect(buttonsWithText(wrapper, 'Iniciar')).toHaveLength(2)
    wrapper.unmount()
  })

  it('del detalle a «Editar»: se cierra el detalle y abre el formulario con el día; al guardar se cierra', async () => {
    mockApi('PATCH', '/api/calendario/d1', workDayDetail())
    const wrapper = await mount()
    await wrapper.get('ul[aria-label="Próximos días"] button').trigger('click')
    await waitFor(() => buttonsWithText(wrapper, 'Editar').length > 0)
    await buttonsWithText(wrapper.get('dialog'), 'Editar')[0]!.trigger('click')
    await waitFor(() => wrapper.find('dialog h2').exists() && wrapper.get('dialog h2').text() === 'Editar día')
    await flush(20)
    expect(wrapper.findAll('dialog')).toHaveLength(1)
    expect(wrapper.get('dialog h2').text()).toBe('Editar día')
    await wrapper.get('dialog form').trigger('submit')
    await flush(20)
    expect(calls.some(call => call.method === 'PATCH' && call.url === '/api/calendario/d1')).toBe(true)
    expect(wrapper.find('dialog').exists()).toBe(false)
    wrapper.unmount()
  })

  it('al volver a la página, los meses guardados se ven al instante y se vuelven a pedir', async () => {
    const first = await mount()
    first.unmount()
    ranges.length = 0
    const again = await mount()
    expect(again.findAll('.wx-event')).toHaveLength(3)
    expect(monthRanges().sort()).toEqual(['2026-10-01…2026-10-31', '2026-11-01…2026-11-30', '2026-12-01…2026-12-31'])
    again.unmount()
  })
})
