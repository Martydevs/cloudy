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

  it('nunca usa v-html: el texto con etiquetas se muestra literal', async () => {
    const wrapper = await mount({ request: prayer(1, { text: prayerText({ text: '<b>hola</b>' }) }) })
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b>hola</b>')
  })
})

describe('PrayerCard · US3 corregir la transcripción', () => {
  const fixButtons = (wrapper: Awaited<ReturnType<typeof mount>>) =>
    wrapper.findAll('button').filter(b => /Corregir texto|Escribir transcripción/.test(b.text()))

  it('las marcas [ilegible] se resaltan con insignia e icono (no solo color) y la tarjeta dice «Texto por corregir»', async () => {
    const wrapper = await mount({ request: prayer(1, { text: prayerText({ text: 'Oremos por [ilegible] y su familia' }) }) })
    const marks = wrapper.findAll('p.whitespace-pre-line .badge')
    expect(marks).toHaveLength(1)
    expect(marks[0]!.text()).toBe('[ilegible]')
    // `badge-soft` pinta el texto en `warning`: 1,77:1 sobre crema en `cloudy-light`. El texto va en `base-content` (AA en ambos temas).
    expect(marks[0]!.classes()).toEqual(expect.arrayContaining(['badge-warning', 'badge-soft', 'text-base-content']))
    expect(marks[0]!.html()).toContain('lucide:triangle-alert')
    expect(wrapper.text()).toContain('Texto por corregir')
    const toFix = wrapper.findAll('.badge').find(b => b.text().includes('Texto por corregir'))!
    expect(toFix.classes()).toEqual(expect.arrayContaining(['badge-warning', 'badge-soft', 'text-base-content']))
    expect(wrapper.html()).not.toContain('text-warning')
    expect(wrapper.get('p.whitespace-pre-line').element.textContent).toBe('Oremos por [ilegible] y su familia')
  })

  it('insignia Editada con editedAt y sin aviso cuando ya no hay marcas', async () => {
    const wrapper = await mount({ request: prayer(1, { text: prayerText({ text: 'Oremos por Rosa', editedAt: '2026-11-10T10:00:00.000Z', editedBy: 'Ana' }) }) })
    expect(wrapper.text()).toContain('Editada')
    expect(wrapper.text()).not.toContain('Texto por corregir')
  })

  it('más de 600 caracteres avisa «Texto largo: puede no caber» sin deshabilitar la casilla', async () => {
    const wrapper = await mount({ request: prayer(1, { text: prayerText({ text: 'a'.repeat(601) }) }) })
    expect(wrapper.text()).toContain('Texto largo: puede no caber')
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeUndefined()
    const short = await mount({ request: prayer(1, { text: prayerText({ text: 'a'.repeat(600) }) }) })
    expect(short.text()).not.toContain('Texto largo')
  })

  it.each([
    ['ready con texto', { status: 'ready' }, 'Corregir texto'],
    ['failed', { status: 'failed', text: null, error: 'provider' }, 'Corregir texto'],
    ['empty', { status: 'empty', text: null }, 'Escribir transcripción'],
    ['pending', { status: 'pending', text: null }, 'Escribir transcripción'],
    ['ready en blanco', { status: 'ready', text: '   ' }, 'Escribir transcripción'],
  ] as const)('%s ofrece «%s», encima de la etiqueta, y emite fix sin toggle', async (_, text, label) => {
    const wrapper = await mount({ request: prayer(1, { text: prayerText(text) }) })
    const buttons = fixButtons(wrapper)
    expect(buttons.map(b => b.text())).toEqual([label])
    expect(buttons[0]!.attributes('type')).toBe('button')
    expect(buttons[0]!.element.closest('.z-10')).not.toBeNull()
    expect(buttons[0]!.element.closest('label')).toBeNull()
    expect(buttons[0]!.classes()).not.toContain('btn-sm')
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('fix')).toHaveLength(1)
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it.each([
    ['reading', { status: 'reading', text: null }],
    ['unavailable', { status: 'unavailable', text: null }],
  ] as const)('%s no ofrece corregir (el servidor respondería 409)', async (_, text) => {
    const wrapper = await mount({ request: prayer(1, { text: prayerText(text) }) })
    expect(fixButtons(wrapper)).toHaveLength(0)
  })
})
