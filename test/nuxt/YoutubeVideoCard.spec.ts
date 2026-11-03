// T056 — Tarjeta de un video del historial (feature 005, FR-024): miniatura, duración, quién y cuándo, casilla y menú.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { YoutubeHistoryItem } from '#shared/types/api'
import YoutubeVideoCard from '~/components/youtube/YoutubeVideoCard.vue'

const video = (changes: Partial<YoutubeHistoryItem> = {}): YoutubeHistoryItem => ({
  videoId: 'okShortVid1', title: 'Alabanza', channel: 'Iglesia', durationSeconds: 185,
  thumbnailUrl: 'https://i.ytimg.com/vi/okShortVid1/hq.jpg', viewedAt: new Date(Date.now() - 7_200_000).toISOString(),
  viewedBy: { userId: 'u2', name: 'Luis', active: true }, ...changes,
})

describe('YoutubeVideoCard', () => {
  it('miniatura diferida con dimensiones, duración, canal y «Luis · hace 2 horas»', async () => {
    const wrapper = await mountSuspended(YoutubeVideoCard, { props: { video: video() } })
    const img = wrapper.get('img')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('width')).toBe('320')
    expect(wrapper.text()).toContain('3:05')
    expect(wrapper.text()).toContain('3 min 5 s')
    expect(wrapper.text()).toContain('Iglesia')
    expect(wrapper.text()).toMatch(/Luis · hace 2 horas/)
    expect(wrapper.get('a').attributes('href')).toBe('/youtube/okShortVid1')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Acciones de Alabanza"]').exists()).toBe(true)
  })

  it('sin miniatura, duración ni canal; quien lo abrió ya no está activo o no existe', async () => {
    const inactive = await mountSuspended(YoutubeVideoCard, { props: { video: video({ thumbnailUrl: null, durationSeconds: null, channel: null, viewedBy: { userId: 'u3', name: 'Eva', active: false } }) } })
    expect(inactive.find('img').exists()).toBe(false)
    expect(inactive.find('.badge').exists()).toBe(false)
    expect(inactive.text()).toContain('Usuario que ya no está activo')
    const nobody = await mountSuspended(YoutubeVideoCard, { props: { video: video({ viewedBy: null }) } })
    expect(nobody.text()).toContain('Usuario que ya no está activo')
  })

  it('seleccionable: casilla con nombre que emite toggle y marca la tarjeta; compacta sin menú', async () => {
    const wrapper = await mountSuspended(YoutubeVideoCard, { props: { video: video(), selectable: true, selected: true } })
    const box = wrapper.get('input[aria-label="Seleccionar Alabanza"]')
    expect((box.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.get('article').classes()).toContain('border-primary')
    await box.trigger('change')
    expect(wrapper.emitted('toggle')).toEqual([['okShortVid1']])
    await wrapper.get('[aria-label="Acciones de Alabanza"]').trigger('click')
    await wrapper.findAll('[role="menuitem"]').find(b => b.text() === 'Quitar del historial')!.trigger('click')
    expect(wrapper.emitted('action')?.[0]?.[0]).toBe('remove')

    const compact = await mountSuspended(YoutubeVideoCard, { props: { video: video(), compact: true } })
    expect(compact.find('[aria-label="Acciones de Alabanza"]').exists()).toBe(false)
    expect(compact.get('article').classes()).toContain('snap-start')
  })
})
