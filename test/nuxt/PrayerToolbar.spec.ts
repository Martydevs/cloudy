// T075 — Barra de filtros de Peticiones (feature 007, contracts/ui.md: `PrayerToolbar`).
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PrayerToolbar from '~/components/prayers/PrayerToolbar.vue'
import { buttonsWithText } from './helpers/api'

const mount = (props: Record<string, unknown> = {}) =>
  mountSuspended(PrayerToolbar, { props: { q: '', preset: 'all', from: '', to: '', dir: 'desc', ...props } })

describe('PrayerToolbar', () => {
  it('es un role="search" con nombre, en columna en teléfono y en fila desde lg', async () => {
    const wrapper = await mount()
    const search = wrapper.get('[role="search"]')
    expect(search.attributes('aria-label')).toBe('Filtrar peticiones')
    const row = search.get('.flex-col')
    expect(row.classes()).toContain('lg:flex-row')
  })

  it('buscador: label.input con icono y aria-label; Limpiar búsqueda solo con texto, vacía q', async () => {
    const wrapper = await mount()
    const input = wrapper.get('input[type="search"]')
    expect(input.attributes('aria-label')).toBe('Buscar por nombre, nota o texto')
    const label = input.element.closest('label')!
    expect(label.className).toContain('input')
    expect(label.className).toContain('min-h-11')
    expect(label.innerHTML).toContain('lucide:search')
    expect(wrapper.find('button[aria-label="Limpiar búsqueda"]').exists()).toBe(false)

    await input.setValue('Ana')
    expect(wrapper.emitted('update:q')).toEqual([['Ana']])
    await wrapper.setProps({ q: 'Ana' })
    const clear = wrapper.get('button[aria-label="Limpiar búsqueda"]')
    expect(clear.classes()).toContain('min-h-11')
    await clear.trigger('click')
    expect(wrapper.emitted('update:q')!.at(-1)).toEqual([''])
  })

  it('presets en un join con estado anunciado; elegir uno emite update:preset', async () => {
    const wrapper = await mount({ preset: 'today' })
    const group = wrapper.get('[role="group"][aria-label="Fecha de aprobación"]')
    expect(group.classes()).toContain('join')
    const buttons = group.findAll('button')
    expect(buttons.map(b => b.text())).toEqual(['Todas', 'Hoy', '7 días', 'Rango'])
    expect(buttons.map(b => b.attributes('aria-pressed'))).toEqual(['false', 'true', 'false', 'false'])
    for (const button of buttons) expect(button.classes()).toEqual(expect.arrayContaining(['btn', 'join-item', 'min-h-11']))
    await buttons[2]!.trigger('click')
    expect(wrapper.emitted('update:preset')).toEqual([['week']])
  })

  it('las fechas solo aparecen con Rango, etiquetadas, y emiten update:from/to', async () => {
    const without = await mount()
    expect(without.findAll('input[type="date"]')).toHaveLength(0)

    const wrapper = await mount({ preset: 'range' })
    const dates = wrapper.findAll('input[type="date"]')
    expect(dates).toHaveLength(2)
    expect(dates.map(d => d.element.closest('label')!.textContent!.trim())).toEqual(['Desde', 'Hasta'])
    for (const date of dates) expect(date.classes()).toContain('min-h-11')
    expect(wrapper.text()).toContain('Elige las dos fechas del rango.')
    await dates[0]!.setValue('2026-11-01')
    await dates[1]!.setValue('2026-11-07')
    expect(wrapper.emitted('update:from')).toEqual([['2026-11-01']])
    expect(wrapper.emitted('update:to')).toEqual([['2026-11-07']])
  })

  it('un rango invertido muestra su error en lugar de la ayuda', async () => {
    const wrapper = await mount({ preset: 'range', from: '2026-11-07', to: '2026-11-01', rangeError: 'La fecha «hasta» no puede ser anterior a «desde»' })
    expect(wrapper.get('[role="alert"]').text()).toBe('La fecha «hasta» no puede ser anterior a «desde»')
    expect(wrapper.text()).not.toContain('Elige las dos fechas del rango.')
  })

  it('select de orden etiquetado con las dos opciones', async () => {
    const wrapper = await mount()
    const select = wrapper.get('select')
    expect(select.element.closest('label')!.textContent).toContain('Orden')
    expect(select.classes()).toContain('min-h-11')
    expect(select.findAll('option').map(o => [o.attributes('value'), o.text()])).toEqual([
      ['desc', 'Más recientes primero'],
      ['asc', 'Más antiguas primero'],
    ])
    await select.setValue('asc')
    expect(wrapper.emitted('update:dir')).toEqual([['asc']])
  })

  it('el resumen del filtro activo se anuncia y Quitar filtros emite reset', async () => {
    const without = await mount()
    expect(buttonsWithText(without, 'Quitar filtros')).toHaveLength(0)

    const wrapper = await mount({ summary: 'Buscando «Ana» · Aprobadas hoy' })
    expect(wrapper.get('[role="status"]').text()).toBe('Buscando «Ana» · Aprobadas hoy')
    const reset = buttonsWithText(wrapper, 'Quitar filtros')[0]!
    expect(reset.classes()).toContain('min-h-11')
    await reset.trigger('click')
    expect(wrapper.emitted('reset')).toHaveLength(1)
  })

  it('enviar el formulario no recarga la página', async () => {
    const wrapper = await mount()
    const event = new Event('submit', { cancelable: true })
    wrapper.get('form').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
