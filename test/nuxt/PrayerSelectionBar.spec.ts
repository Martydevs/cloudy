// T030 / T049 — Barra de selección de Peticiones (feature 007, contracts/ui.md).
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PrayerSelectionBar from '~/components/prayers/PrayerSelectionBar.vue'
import { buttonsWithText } from './helpers/api'

describe('PrayerSelectionBar', () => {
  it('dice cuántas peticiones y cuántas imágenes', async () => {
    const wrapper = await mountSuspended(PrayerSelectionBar, { props: { count: 5, images: 2 } })
    expect(wrapper.get('[role="status"]').text()).toContain('5 peticiones → 2 imágenes')
    const one = await mountSuspended(PrayerSelectionBar, { props: { count: 1, images: 1 } })
    expect(one.text()).toContain('1 petición → 1 imagen')
  })

  it('avisa del tope de 40', async () => {
    const wrapper = await mountSuspended(PrayerSelectionBar, { props: { count: 40, images: 10, limit: true } })
    expect(wrapper.text()).toContain('Elegiste el máximo de 40 peticiones por generación')
  })

  it('Limpiar emite clear', async () => {
    const wrapper = await mountSuspended(PrayerSelectionBar, { props: { count: 2, images: 1 } })
    await buttonsWithText(wrapper, 'Limpiar')[0]!.trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('«Escribir textos y generar» emite generate; sin peticiones queda deshabilitado con motivo', async () => {
    const wrapper = await mountSuspended(PrayerSelectionBar, { props: { count: 3, images: 1 } })
    await buttonsWithText(wrapper, 'Escribir textos y generar')[0]!.trigger('click')
    expect(wrapper.emitted('generate')).toHaveLength(1)
    const none = await mountSuspended(PrayerSelectionBar, { props: { count: 0, images: 0 } })
    const button = buttonsWithText(none, 'Escribir textos y generar')[0]!
    expect(button.attributes('disabled')).toBeDefined()
    expect(none.get(`#${button.attributes('aria-describedby')}`).text()).toBe('Elige al menos una petición')
  })

  it('botones de tamaño base (≥ 44 px) y área segura inferior', async () => {
    const wrapper = await mountSuspended(PrayerSelectionBar, { props: { count: 2, images: 1 } })
    for (const button of wrapper.findAll('button')) expect(button.classes().some(c => /^btn-(sm|xs)$/.test(c)), button.text()).toBe(false)
    expect(wrapper.get('[role="region"]').attributes('class')).toContain('pb-[max(0.75rem,env(safe-area-inset-bottom))]')
  })
})
