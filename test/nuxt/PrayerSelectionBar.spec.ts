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

  it('Ver elegidas emite review y Limpiar emite clear', async () => {
    const wrapper = await mountSuspended(PrayerSelectionBar, { props: { count: 2, images: 1 } })
    await buttonsWithText(wrapper, 'Ver elegidas')[0]!.trigger('click')
    await buttonsWithText(wrapper, 'Limpiar')[0]!.trigger('click')
    expect(wrapper.emitted('review')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('Generar imágenes emite generate; sin peticiones queda deshabilitado con motivo', async () => {
    const wrapper = await mountSuspended(PrayerSelectionBar, { props: { count: 3, images: 1 } })
    await buttonsWithText(wrapper, 'Generar imágenes')[0]!.trigger('click')
    expect(wrapper.emitted('generate')).toHaveLength(1)
    const none = await mountSuspended(PrayerSelectionBar, { props: { count: 0, images: 0 } })
    const button = buttonsWithText(none, 'Generar imágenes')[0]!
    expect(button.attributes('disabled')).toBeDefined()
    expect(none.get(`#${button.attributes('aria-describedby')}`).text()).toBe('Elige al menos una petición con texto')
  })

  it('avisa de las peticiones con texto ilegible con icono y texto', async () => {
    const wrapper = await mountSuspended(PrayerSelectionBar, { props: { count: 3, images: 1, unreadable: 2 } })
    expect(wrapper.text()).toContain('2 peticiones todavía tienen texto ilegible')
    expect(wrapper.html()).toContain('lucide:triangle-alert')
    const one = await mountSuspended(PrayerSelectionBar, { props: { count: 3, images: 1, unreadable: 1 } })
    expect(one.text()).toContain('1 petición todavía tiene texto ilegible')
    const clean = await mountSuspended(PrayerSelectionBar, { props: { count: 3, images: 1 } })
    expect(clean.text()).not.toContain('ilegible')
  })

  it('botones de tamaño base (≥ 44 px) y área segura inferior', async () => {
    const wrapper = await mountSuspended(PrayerSelectionBar, { props: { count: 2, images: 1 } })
    for (const button of wrapper.findAll('button')) expect(button.classes().some(c => /^btn-(sm|xs)$/.test(c)), button.text()).toBe(false)
    expect(wrapper.get('[role="region"]').attributes('class')).toContain('pb-[max(0.75rem,env(safe-area-inset-bottom))]')
  })
})
