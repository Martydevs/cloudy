// T028 / T065 — Tarjeta seleccionable de Peticiones (feature 007, contracts/ui.md § Tarjeta seleccionable).
import { describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import PrayerCard from '~/components/prayers/PrayerCard.vue'
import { prayer, prayerText } from './prayer-fixtures'

// happy-dom no tiene IntersectionObserver: la cercanía de la tarjeta se controla a mano.
const { near } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { near: ref(false) }
})
mockNuxtImport('useElementVisibility', () => () => near)

const mount = (props: Partial<InstanceType<typeof PrayerCard>['$props']> = {}) =>
  mountSuspended(PrayerCard, { props: { request: prayer(1, { senderName: 'Ana', note: 'para el domingo' }), ...props } })

describe('PrayerCard', () => {
  it('es un article con nombre, aprobación, envío, nota y transcripción como texto', async () => {
    const wrapper = await mount()
    expect(wrapper.get('article').attributes('aria-label')).toBe('Petición de Ana')
    expect(wrapper.text()).toContain('Ana')
    expect(wrapper.text()).toMatch(/Aprobada hace/)
    expect(wrapper.text()).toContain('Enviada el')
    expect(wrapper.find('time').attributes('datetime')).toBe(prayer(1).sentAt)
    expect(wrapper.text()).toContain('para el domingo')
    expect(wrapper.text()).toContain('Petición número 1')
  })

  it('la casilla es real, circular y con nombre accesible', async () => {
    const wrapper = await mount({ selected: true })
    const input = wrapper.get('input[type="checkbox"]')
    expect(input.attributes('aria-label')).toBe('Elegir la petición de Ana')
    expect(input.classes()).toContain('radio')
    expect((input.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.get('article').classes()).toContain('ring-2')
    expect(wrapper.text()).toContain('elegida')
    expect(wrapper.html()).toContain('lucide:check')
  })

  it('no elegida: casilla sin marcar y sin la marca', async () => {
    const wrapper = await mount()
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).not.toContain('elegida')
  })

  it('cambiar la casilla emite toggle', async () => {
    const wrapper = await mount()
    await wrapper.get('input[type="checkbox"]').trigger('change')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('Abrir foto está encima de la etiqueta, abre en otra pestaña y no emite toggle', async () => {
    const wrapper = await mount()
    const link = wrapper.findAll('a').find(a => a.text().includes('Abrir foto'))!
    expect(link.attributes('href')).toBe(prayer(1).previewUrl)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.element.closest('.z-10')).not.toBeNull()
    expect(link.element.closest('label')).toBeNull()
    await link.trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('deshabilitada lleva el motivo en aria-describedby', async () => {
    const wrapper = await mount({ disabled: true, disabledReason: 'Sin texto: escríbelo primero' })
    const input = wrapper.get('input[type="checkbox"]')
    expect(input.attributes('disabled')).toBeDefined()
    const id = input.attributes('aria-describedby')!
    expect(wrapper.get(`#${id}`).text()).toBe('Sin texto: escríbelo primero')
  })

  it.each([
    ['reading', { status: 'reading', text: null }, 'Leyendo texto…'],
    ['pending', { status: 'pending', text: null }, 'El texto de esta imagen aún no se ha leído.'],
    ['empty', { status: 'empty', text: null }, 'No se reconoció texto en esta imagen'],
    ['failed', { status: 'failed', text: null, error: 'provider' }, 'No pudimos leer el texto ahora'],
    ['failed por crédito', { status: 'failed', text: null, error: 'quota_exceeded' }, 'alcanzó su límite de uso'],
    ['unavailable', { status: 'unavailable', text: null }, 'No disponible para este archivo'],
  ] as const)('estado %s muestra su texto', async (_, text, copy) => {
    const wrapper = await mount({ request: prayer(1, { text: prayerText(text) }) })
    expect(wrapper.text()).toContain(copy)
  })

  it('la foto recibe src solo al acercarse, con caja 4:3, decoding async y prioridad baja', async () => {
    near.value = false
    const wrapper = await mount()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.aspect-\\[4\\/3\\] .skeleton').exists()).toBe(true)
    near.value = true
    await nextTick()
    const img = wrapper.get('img')
    expect(img.attributes('src')).toBe(prayer(1).previewUrl)
    expect(img.attributes('decoding')).toBe('async')
    expect(img.attributes('fetchpriority')).toBe('low')
    expect(img.element.parentElement!.className).toContain('aspect-[4/3]')
  })

  it('si la foto falla muestra un marcador con el nombre del archivo', async () => {
    near.value = true
    const wrapper = await mount()
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('Sin vista previa')
    expect(wrapper.text()).toContain('tarjeta-1.jpg')
  })

  it('nunca usa v-html: el texto con etiquetas se muestra literal', async () => {
    const wrapper = await mount({ request: prayer(1, { text: prayerText({ text: '<b>hola</b>' }) }) })
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b>hola</b>')
  })
})
