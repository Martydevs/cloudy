// Rejilla de Peticiones (feature 007, contracts/ui.md: `PrayerGrid`): motivo de las tarjetas que no se pueden elegir y el
// centinela del desplazamiento infinito.
import { describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import PrayerGrid from '~/components/prayers/PrayerGrid.vue'
import { prayer, prayerText } from './prayer-fixtures'

// happy-dom no tiene IntersectionObserver: la visibilidad del centinela (y de las fotos) se controla a mano.
const { visible } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { visible: ref(false) }
})
mockNuxtImport('useElementVisibility', () => () => visible)

const items = [prayer(1), prayer(2), prayer(3, { text: prayerText({ status: 'empty', text: null }) })]

const mount = (props: Record<string, unknown> = {}) => {
  visible.value = false
  return mountSuspended(PrayerGrid, {
    props: { items, loadingMore: false, moreError: false, done: false, isSelected: () => false, limitReached: false, ...props },
  })
}

const reasons = (wrapper: Awaited<ReturnType<typeof mount>>) =>
  wrapper.findAll('input[type="checkbox"]').map(box => (box.attributes('disabled') === undefined ? null : wrapper.get(`#${box.attributes('aria-describedby')}`).text()))

describe('PrayerGrid', () => {
  it('sin texto no se puede elegir y dice por qué', async () => {
    expect(reasons(await mount())).toEqual([null, null, 'Sin texto: escríbelo primero'])
  })

  it('con el tope, solo las ya elegidas siguen activas', async () => {
    const wrapper = await mount({ limitReached: true, isSelected: (id: string) => id === prayer(1).id })
    expect(reasons(wrapper)).toEqual([null, 'Tope de 40 alcanzado', 'Sin texto: escríbelo primero'])
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

  it('solo la primera tarjeta lleva la foto con prioridad (las demás esperan a acercarse)', async () => {
    const wrapper = await mount()
    const imgs = wrapper.findAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.attributes('src')).toBe(prayer(1).previewUrl)
    expect(imgs[0]!.attributes('fetchpriority')).toBe('high')
  })

  it('reenvía toggle y fix con la petición', async () => {
    const wrapper = await mount()
    await wrapper.findAll('input[type="checkbox"]')[1]!.trigger('change')
    expect(wrapper.emitted('toggle')).toEqual([[prayer(2)]])
    const fix = wrapper.findAll('button').find(b => b.text().includes('Corregir texto'))!
    await fix.trigger('click')
    expect(wrapper.emitted('fix')).toEqual([[prayer(1)]])
  })
})
