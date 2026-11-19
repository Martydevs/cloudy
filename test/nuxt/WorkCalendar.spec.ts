// `WorkCalendar` es la única frontera con SVAR. Aquí SVAR está simulado (happy-dom no reemplaza a un navegador): se
// comprueba lo que le pasamos (solo lectura, sin su barra, semana en domingo, rejilla de horas, clases por tipo y estado)
// y nuestra barra de navegación; el aspecto real se verifica en el navegador.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WorkCalendar from '~/components/calendar/WorkCalendar.vue'
import { localDate, toCalendarEvents, toIsoDate } from '~/utils/work-calendar'
import type { CalendarView } from '~/utils/work-calendar'
import { workDay } from './calendar-fixtures'

const svar = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  words: null as Record<string, unknown> | null,
  fonts: undefined as boolean | undefined,
  handlers: {} as Record<string, (payload: Record<string, unknown>) => void>,
}))

vi.mock('@svar-ui/vue-calendar', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Calendar: defineComponent({
      props: ['events', 'view', 'date', 'views', 'toolbar', 'eventCss', 'eventContent', 'init', 'readonly'],
      setup(props) {
        props.init?.({ on: (action: string, handler: (payload: Record<string, unknown>) => void) => (svar.handlers[action] = handler) })
        return () => {
          svar.props = { ...props }
          const mode = props.view === 'month' ? 'grid' : 'boxes'
          return h('div', { 'data-svar': props.view }, (props.events as Record<string, unknown>[]).map(event =>
            h('div', { key: event.id as string, class: `wx-event ${props.eventCss({ event, view: props.view, section: 'x', mode })}` }, [h(props.eventContent, { event, mode })])))
        }
      },
    }),
    Willow: defineComponent({
      props: { fonts: { type: Boolean, default: true } },
      setup(props, { slots }) {
        return () => {
          svar.fonts = props.fonts
          return h('div', { class: 'wx-willow-theme' }, slots.default?.())
        }
      },
    }),
  }
})

vi.mock('@svar-ui/vue-core', async () => {
  const { defineComponent } = await import('vue')
  return {
    Locale: defineComponent({
      props: ['words'],
      setup(props, { slots }) {
        return () => {
          svar.words = props.words
          return slots.default?.()
        }
      },
    }),
  }
})

const days = [
  workDay(),
  workDay({ id: 'd2', title: 'Conferencia', date: '2026-11-21', kind: 'special', status: 'in_progress', slots: [{ id: 's3', start: '05:30', end: '08:00' }] }),
  workDay({ id: 'd3', title: 'Ensayo', date: '2026-11-18', kind: 'normal', status: 'finished', slots: [{ id: 's4', start: '19:00', end: '21:00' }] }),
]

async function mount(view: CalendarView = 'month', date = localDate('2026-11-18'), events = toCalendarEvents(days)) {
  const state = { date, view }
  const wrapper = await mountSuspended(WorkCalendar, {
    props: {
      events,
      date,
      view,
      'onUpdate:date': (value: Date) => {
        state.date = value
        wrapper.setProps({ date: value })
      },
      'onUpdate:view': (value: CalendarView) => {
        state.view = value
        wrapper.setProps({ view: value })
      },
    },
  })
  return { wrapper, state }
}

const button = (wrapper: Awaited<ReturnType<typeof mount>>['wrapper'], label: string) =>
  wrapper.findAll('button').find(b => (b.attributes('aria-label') ?? b.text().trim()) === label)!

beforeEach(() => {
  svar.props = null
  svar.handlers = {}
})

describe('WorkCalendar', () => {
  it('monta SVAR en solo lectura, sin su barra, sin pedir sus fuentes y con la semana en domingo y 24 h', async () => {
    const { wrapper } = await mount()
    expect(svar.props).toMatchObject({ readonly: true, toolbar: null, view: 'month' })
    expect(svar.fonts).toBe(false)
    expect(svar.words).toMatchObject({ calendar: { weekStart: 0, clockFormat: 24 }, eventCalendar: { Today: 'Hoy', timeScaleFormat: '%H:%i' } })
    // El tema Cloudy se aplica sobre `.cloudy-calendar .wx-willow-theme`.
    expect(wrapper.find('.cloudy-calendar .wx-willow-theme').exists()).toBe(true)
  })

  it('las vistas son día, semana y mes; la rejilla empieza a la hora del primer rango y el mes no recorta eventos', async () => {
    await mount()
    const views = svar.props!.views as { id: string, sections: Record<string, { yScale?: { startHour: number, endHour: number }, ui?: Record<string, unknown> }> }[]
    expect(views.map(view => view.id)).toEqual(['day', 'week', 'month'])
    expect(views[0]!.sections.timeGrid!.yScale).toMatchObject({ startHour: 5, endHour: 24 })
    expect(views[2]!.sections.month!.ui).toEqual({ eventOverflow: 'expand' })

    await mount('month', localDate('2026-11-18'), toCalendarEvents([workDay()]))
    expect((svar.props!.views as typeof views)[1]!.sections.timeGrid!.yScale).toMatchObject({ startHour: 6 })
  })

  it('cada rango es un evento con las clases de su tipo y estado, y un botón que dice todo sin depender del color', async () => {
    const { wrapper } = await mount()
    const events = wrapper.findAll('.wx-event')
    expect(events).toHaveLength(4)
    expect(events[0]!.classes()).toEqual(expect.arrayContaining(['cloudy-ev', 'cloudy-ev--normal']))
    expect(events[2]!.classes()).toEqual(expect.arrayContaining(['cloudy-ev--special', 'is-in-progress']))
    expect(events[3]!.classes()).toEqual(expect.arrayContaining(['cloudy-ev--normal', 'is-finished']))
    expect(events[2]!.get('button').attributes('aria-label')).toBe('Conferencia, 05:30–08:00, Día especial, En proceso')
    expect(events[0]!.get('button').attributes('aria-label')).toBe('Servicio dominical, 09:00–11:00, Día normal, Sin iniciar')
  })

  it('abrir un evento emite el id de su día (también con el teclado: es un botón)', async () => {
    const { wrapper } = await mount()
    await wrapper.findAll('.wx-event')[2]!.get('button').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['d2']])
  })

  it('nuestra barra: periodo anterior y siguiente, Hoy y el título en español', async () => {
    const { wrapper, state } = await mount()
    expect(wrapper.get('[data-calendar-label]').text()).toBe('noviembre de 2026')
    await button(wrapper, 'Periodo siguiente').trigger('click')
    expect(toIsoDate(state.date)).toBe('2026-12-01')
    expect(wrapper.get('[data-calendar-label]').text()).toBe('diciembre de 2026')
    await button(wrapper, 'Periodo anterior').trigger('click')
    await button(wrapper, 'Periodo anterior').trigger('click')
    expect(toIsoDate(state.date)).toBe('2026-10-01')
    await button(wrapper, 'Hoy').trigger('click')
    expect(toIsoDate(state.date)).toBe(toIsoDate(new Date()))
  })

  it('cambiar de vista marca el botón activo y avanza por día o por semana', async () => {
    const { wrapper, state } = await mount()
    expect(button(wrapper, 'Mes').attributes('aria-pressed')).toBe('true')
    await button(wrapper, 'Semana').trigger('click')
    expect(state.view).toBe('week')
    expect(button(wrapper, 'Semana').attributes('aria-pressed')).toBe('true')
    expect(button(wrapper, 'Mes').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[data-svar]').attributes('data-svar')).toBe('week')
    await button(wrapper, 'Periodo siguiente').trigger('click')
    expect(toIsoDate(state.date)).toBe('2026-11-25')
    await button(wrapper, 'Día').trigger('click')
    await button(wrapper, 'Periodo anterior').trigger('click')
    expect(toIsoDate(state.date)).toBe('2026-11-24')
    // En día y semana el evento muestra su horario y sus textos.
    expect(wrapper.text()).toContain('05:30–08:00')
    expect(wrapper.text()).toContain('Especial')
    expect(wrapper.text()).toContain('En proceso')
    expect(wrapper.text()).toContain('Finalizado')
  })

  it('la navegación que nace dentro del calendario (clic en el número de un día) actualiza la fecha y la vista de fuera', async () => {
    const { wrapper, state } = await mount()
    svar.handlers['navigate-to']!({ date: localDate('2026-11-21'), view: 'day' })
    await wrapper.vm.$nextTick()
    expect(toIsoDate(state.date)).toBe('2026-11-21')
    expect(state.view).toBe('day')
    // Una vista que no ofrecemos se ignora; sin fecha, la fecha se queda.
    svar.handlers['navigate-to']!({ view: 'year' })
    expect(state.view).toBe('day')
    expect(toIsoDate(state.date)).toBe('2026-11-21')
  })

  it('mientras se cargan los días muestra un indicador con nombre', async () => {
    const { wrapper } = await mount()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    await wrapper.setProps({ busy: true })
    expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe('Cargando el calendario')
  })
})
