// Lista «Próximos días» (cuatro estados, alternativa accesible al calendario, estado con un toque para quien administra),
// las insignias de tipo y estado y el contenido de un evento del calendario.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import UpcomingWorkDays from '~/components/calendar/UpcomingWorkDays.vue'
import WorkCalendarEvent from '~/components/calendar/WorkCalendarEvent.vue'
import WorkDayBadges from '~/components/calendar/WorkDayBadges.vue'
import { OPEN_WORK_DAY, toCalendarEvents } from '~/utils/work-calendar'
import { buttonsWithText } from './helpers/api'
import { workDay } from './calendar-fixtures'

describe('UpcomingWorkDays', () => {
  it('cargando: esqueleto', async () => {
    const wrapper = await mountSuspended(UpcomingWorkDays, { props: { days: null, pending: true } })
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
  })

  it('error: mensaje con reintento', async () => {
    const wrapper = await mountSuspended(UpcomingWorkDays, { props: { days: null, error: new Error('x') } })
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar los próximos días')
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('vacío: el editor sabe que alguien más agenda; quien administra tiene el botón', async () => {
    const editor = await mountSuspended(UpcomingWorkDays, { props: { days: [] } })
    expect(editor.text()).toContain('No hay días agendados en los próximos 30 días')
    expect(editor.text()).toContain('Cuando un administrador agende uno, aparecerá aquí.')
    expect(buttonsWithText(editor, 'Agendar día')).toHaveLength(0)

    const admin = await mountSuspended(UpcomingWorkDays, { props: { days: [], canManage: true } })
    await buttonsWithText(admin, 'Agendar día')[0]!.trigger('click')
    expect(admin.emitted('schedule')).toHaveLength(1)
  })

  it('contenido: fecha, horarios, tipo, estado, auditorio, miembros (los inactivos sin nombre) y adjuntos, todo como texto', async () => {
    const days = [workDay(), workDay({ id: 'd2', title: 'Conferencia', kind: 'special', status: 'in_progress', members: [], materialCount: 0 })]
    const wrapper = await mountSuspended(UpcomingWorkDays, { props: { days } })
    const [first, second] = wrapper.findAll('li')
    expect(first!.text()).toContain('domingo, 22 de noviembre · 09:00–11:00 · 18:00–20:00')
    expect(first!.text()).toContain('Servicio dominical')
    expect(first!.text()).toContain('Normal')
    expect(first!.text()).toContain('Sin iniciar')
    expect(first!.text()).toContain('Skykids Auditorium')
    expect(first!.text()).toContain('Ana, Persona inactiva')
    expect(first!.text()).toContain('2 adjuntos')
    expect(second!.text()).toContain('Especial')
    expect(second!.text()).toContain('En proceso')
    expect(second!.text()).toContain('Sin miembros asignados')
    expect(second!.text()).not.toContain('adjunto')
    // Sin permiso sobre ningún día no hay botones de estado.
    expect(buttonsWithText(wrapper, 'Iniciar')).toHaveLength(0)

    await first!.get('button').trigger('click')
    expect(wrapper.emitted('open')![0]).toEqual([days[0]])
  })

  it('el botón de estado sale solo en los días que la persona puede cambiar (el editor, los suyos)', async () => {
    const days = [workDay(), workDay({ id: 'd2', title: 'Conferencia', members: [] }), workDay({ id: 'd3', status: 'in_progress', members: [] })]
    const canChangeStatus = (day: { members: { userId: string }[] }) => day.members.some(member => member.userId === 'u1')
    const wrapper = await mountSuspended(UpcomingWorkDays, { props: { days, canChangeStatus } })
    expect(buttonsWithText(wrapper, 'Iniciar').map(button => button.attributes('aria-label'))).toEqual(['Iniciar Servicio dominical (ahora: Sin iniciar)'])
    expect(buttonsWithText(wrapper, 'Finalizar')).toHaveLength(0)
    await buttonsWithText(wrapper, 'Iniciar')[0]!.trigger('click')
    expect(wrapper.emitted('status')![0]).toEqual([days[0], 'in_progress'])
  })

  it('quien administra avanza el estado con un toque: Iniciar → Finalizar, y un día finalizado ya no ofrece nada', async () => {
    const days = [workDay(), workDay({ id: 'd2', status: 'in_progress' }), workDay({ id: 'd3', status: 'finished' })]
    const wrapper = await mountSuspended(UpcomingWorkDays, { props: { days, canManage: true, canChangeStatus: () => true, busyId: 'd2' } })
    const start = buttonsWithText(wrapper, 'Iniciar')
    const finish = buttonsWithText(wrapper, 'Finalizar')
    expect(start).toHaveLength(1)
    expect(finish).toHaveLength(1)
    expect(start[0]!.attributes('aria-label')).toBe('Iniciar Servicio dominical (ahora: Sin iniciar)')
    await start[0]!.trigger('click')
    expect(wrapper.emitted('status')![0]).toEqual([days[0], 'in_progress'])
    // El que se está guardando queda deshabilitado.
    expect(finish[0]!.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('li')[2]!.findAll('button')).toHaveLength(1)
  })
})

describe('WorkDayBadges', () => {
  it.each([
    ['normal', 'not_started', 'Normal', 'Sin iniciar'],
    ['special', 'in_progress', 'Especial', 'En proceso'],
    ['special', 'finished', 'Especial', 'Finalizado'],
  ] as const)('%s / %s lleva texto e icono', async (kind, status, kindLabel, statusLabel) => {
    const wrapper = await mountSuspended(WorkDayBadges, { props: { kind, status } })
    const badges = wrapper.findAll('.badge')
    expect(badges.map(badge => badge.text())).toEqual([kindLabel, statusLabel])
    expect(badges[0]!.classes()).toContain(kind === 'special' ? 'badge-primary' : 'badge-secondary')
  })
})

describe('WorkCalendarEvent', () => {
  const [event] = toCalendarEvents([workDay({ kind: 'special', status: 'finished' })])

  it('en día y semana muestra título, horario y los textos de tipo y estado', async () => {
    const opened: string[] = []
    const wrapper = await mountSuspended(WorkCalendarEvent, {
      props: { event: event!, mode: 'boxes' },
      global: { provide: { [OPEN_WORK_DAY as symbol]: (id: string) => opened.push(id) } },
    })
    expect(wrapper.text()).toContain('Servicio dominical')
    expect(wrapper.text()).toContain('09:00–11:00')
    expect(wrapper.text()).toContain('Especial')
    expect(wrapper.text()).toContain('Finalizado')
    expect(wrapper.get('button').attributes('title')).toBeUndefined()
    await wrapper.get('button').trigger('click')
    expect(opened).toEqual(['d1'])
  })

  it('en el mes va en una línea: hora, título e iconos, con todo el texto en su nombre accesible', async () => {
    const wrapper = await mountSuspended(WorkCalendarEvent, { props: { event: event!, mode: 'grid' } })
    const button = wrapper.get('button')
    expect(button.classes()).toContain('cloudy-ev__btn--grid')
    expect(button.text()).toContain('09:00')
    expect(button.text()).toContain('Servicio dominical')
    expect(button.attributes('aria-label')).toBe('Servicio dominical, 09:00–11:00, Día especial, Finalizado')
    expect(button.attributes('title')).toBe(button.attributes('aria-label'))
    // Sin proveedor (fuera del calendario) el clic no falla.
    await button.trigger('click')

    const [running] = toCalendarEvents([workDay({ status: 'in_progress' })])
    const dot = await mountSuspended(WorkCalendarEvent, { props: { event: running!, mode: 'grid' } })
    expect(dot.find('.cloudy-ev__dot').exists()).toBe(true)
  })

  it('un día normal sin iniciar no lleva etiquetas extra', async () => {
    const [plain] = toCalendarEvents([workDay()])
    const wrapper = await mountSuspended(WorkCalendarEvent, { props: { event: plain!, mode: 'boxes' } })
    expect(wrapper.text()).not.toContain('Especial')
    expect(wrapper.text()).not.toContain('Sin iniciar')
    expect(wrapper.find('.cloudy-ev__dot').exists()).toBe(false)
  })
})
