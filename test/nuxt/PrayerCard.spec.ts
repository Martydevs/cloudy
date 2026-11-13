// T028 / T065 — Tarjeta seleccionable de Peticiones (feature 007, contracts/ui.md § Tarjeta seleccionable).
import { describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import PrayerCard from '~/components/prayers/PrayerCard.vue'
import { prayer } from './prayer-fixtures'

// happy-dom no tiene IntersectionObserver: la cercanía de la tarjeta se controla a mano.
const { near } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { near: ref(false) }
})
mockNuxtImport('useElementVisibility', () => () => near)

const mount = (props: Partial<InstanceType<typeof PrayerCard>['$props']> = {}) =>
  mountSuspended(PrayerCard, { props: { request: prayer(1, { senderName: 'Ana', note: 'para el domingo' }), ...props } })

describe('PrayerCard', () => {
  it('es un article con nombre, aprobación, envío y nota', async () => {
    const wrapper = await mount()
    expect(wrapper.get('article').attributes('aria-label')).toBe('Petición de Ana')
    expect(wrapper.text()).toContain('Ana')
    expect(wrapper.text()).toMatch(/Aprobada hace/)
    expect(wrapper.text()).toContain('Enviada el')
    expect(wrapper.find('time').attributes('datetime')).toBe(prayer(1).sentAt)
    expect(wrapper.text()).toContain('para el domingo')
  })

  it('no muestra transcripción ni ofrece corregirla: el texto se escribe al generar', async () => {
    const wrapper = await mount()
    expect(wrapper.findAll('button').filter(b => /Corregir texto|Escribir transcripción/.test(b.text()))).toHaveLength(0)
    expect(wrapper.text()).not.toMatch(/Leyendo texto|aún no se ha leído|No se reconoció texto|Texto por corregir|Editada/)
  })

  it('la casilla es real, con el estilo común de checkbox y con nombre accesible', async () => {
    const wrapper = await mount({ selected: true })
    const input = wrapper.get('input[type="checkbox"]')
    expect(input.attributes('aria-label')).toBe('Elegir la petición de Ana')
    expect(input.classes()).toEqual(expect.arrayContaining(['checkbox', 'checkbox-primary']))
    expect(input.classes()).not.toContain('radio')
    expect((input.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.get('article').classes()).toContain('ring-2')
    expect(wrapper.text()).toContain('elegida')
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
    const wrapper = await mount({ disabled: true, disabledReason: 'Tope de 40 alcanzado' })
    const input = wrapper.get('input[type="checkbox"]')
    expect(input.attributes('disabled')).toBeDefined()
    const id = input.attributes('aria-describedby')!
    expect(wrapper.get(`#${id}`).text()).toBe('Tope de 40 alcanzado')
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

  it('con priority (la primera tarjeta, candidata a LCP) la foto sale desde el SSR con prioridad alta', async () => {
    near.value = false
    const wrapper = await mount({ priority: true })
    const img = wrapper.get('img')
    expect(img.attributes('src')).toBe(prayer(1).previewUrl)
    expect(img.attributes('fetchpriority')).toBe('high')
    expect(img.attributes('loading')).toBeUndefined()
  })

  it('si la foto falla muestra un marcador con el nombre del archivo', async () => {
    near.value = true
    const wrapper = await mount()
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('Sin vista previa')
    expect(wrapper.text()).toContain('tarjeta-1.jpg')
  })
})

