// Fila de Peticiones (feature 007, contracts/ui.md: `PrayerGrid`): motivo de las tarjetas que no se pueden elegir, la fila
// única desplazable en horizontal y el centinela del desplazamiento infinito.
import { describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import PrayerGrid from '~/components/prayers/PrayerGrid.vue'
import { prayer } from './prayer-fixtures'

// happy-dom no tiene IntersectionObserver: la visibilidad del centinela (y de las fotos) se controla a mano.
const { visible } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { visible: ref(false) }
})
mockNuxtImport('useElementVisibility', () => () => visible)

const items = [prayer(1), prayer(2), prayer(3)]

const mount = (props: Record<string, unknown> = {}) => {
  visible.value = false
  return mountSuspended(PrayerGrid, {
    props: { items, loadingMore: false, moreError: false, done: false, isSelected: () => false, limitReached: false, ...props },
  })
}

const reasons = (wrapper: Awaited<ReturnType<typeof mount>>) =>
  wrapper.findAll('input[type="checkbox"]').map(box => (box.attributes('disabled') === undefined ? null : wrapper.get(`#${box.attributes('aria-describedby')}`).text()))

describe('PrayerGrid', () => {
  it('cualquier petición aprobada se puede elegir: el texto se escribe al generar', async () => {
    expect(reasons(await mount())).toEqual([null, null, null])
  })

  it('con el tope, solo las ya elegidas siguen activas', async () => {
    const wrapper = await mount({ limitReached: true, isSelected: (id: string) => id === prayer(1).id })
    expect(reasons(wrapper)).toEqual([null, 'Tope de 40 alcanzado', 'Tope de 40 alcanzado'])
  })

  it('el centinela pide más al acercarse, pero no con la lista terminada ni tras un error', async () => {
    const wrapper = await mount()
    visible.value = true
    await nextTick()
    expect(wrapper.emitted('load-more')).toHaveLength(1)

    for (const state of [{ done: true }, { moreError: true }]) {
      const other = await mount(state)
      visible.value = true
      await nextTick()
      expect(other.emitted('load-more'), JSON.stringify(state)).toBeUndefined()
    }
  })

  it('Cargar más pide la página siguiente con el teclado; al final, el aviso de fin en su lugar', async () => {
    const wrapper = await mount()
    await wrapper.findAll('button').find(b => b.text() === 'Cargar más')!.trigger('click')
    expect(wrapper.emitted('load-more')).toHaveLength(1)
    await wrapper.setProps({ done: true })
    expect(wrapper.findAll('button').some(b => b.text() === 'Cargar más')).toBe(false)
    expect(wrapper.text()).toContain('Ya viste todas las peticiones')
  })

  it('una sola fila: cada tarjeta tiene ancho fijo y no se encoge, el contenedor se desplaza en horizontal', async () => {
    const wrapper = await mount()
    const list = wrapper.get('ul[aria-label="Peticiones aprobadas"]')
    expect(list.classes()).toContain('flex')
    expect(list.element.parentElement!.classList).toContain('overflow-x-auto')
    for (const item of list.findAll(':scope > li')) expect(item.classes()).toEqual(expect.arrayContaining(['shrink-0', 'w-72']))
  })

  it('solo la primera tarjeta lleva la foto con prioridad (las demás esperan a acercarse)', async () => {
    const wrapper = await mount()
    const imgs = wrapper.findAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.attributes('src')).toBe(prayer(1).previewUrl)
    expect(imgs[0]!.attributes('fetchpriority')).toBe('high')
  })

  it('reenvía toggle con la petición', async () => {
    const wrapper = await mount()
    await wrapper.findAll('input[type="checkbox"]')[1]!.trigger('change')
    expect(wrapper.emitted('toggle')).toEqual([[prayer(2)]])
  })
})
