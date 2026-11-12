// T048 — Imagen generada y la sección de resultados (feature 007, contracts/ui.md).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PrayerResultCard from '~/components/prayers/PrayerResultCard.vue'
import PrayerResults from '~/components/prayers/PrayerResults.vue'
import type { PrayerImageItem } from '~/composables/usePrayerImages'
import { buttonsWithText, flush } from './helpers/api'

const item = (changes: Partial<PrayerImageItem> = {}): PrayerImageItem =>
  ({ key: 'img-1', index: 1, fileIds: ['a', 'b'], status: 'done', url: 'blob:x', filename: 'peticiones-2026-11-07-1.png', downloaded: false, ...changes })

const labels = (wrapper: { findAll: (s: string) => { text: () => string }[] }) => wrapper.findAll('button').map(b => b.text().trim())

describe('PrayerResultCard', () => {
  it.each(['queued', 'running'] as const)('%s: esqueleto con la proporción de la plantilla, progreso y Cancelar', async (status) => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status, url: undefined }) } })
    expect(wrapper.find('.aspect-\\[1376\\/768\\] .skeleton').exists()).toBe(true)
    expect(wrapper.get('progress').classes()).toContain('motion-reduce:animate-none')
    expect(wrapper.text()).toContain(status === 'queued' ? 'En cola' : 'Generando…')
    expect(labels(wrapper)).toEqual(['Cancelar'])
    await buttonsWithText(wrapper, 'Cancelar')[0]!.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('lista: imagen con texto alternativo y sus acciones', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item() } })
    expect(wrapper.get('img').attributes('alt')).toBe('Imagen de peticiones 1')
    expect(wrapper.get('img').attributes('src')).toBe('blob:x')
    expect(wrapper.text()).toContain('2 peticiones')
    expect(labels(wrapper)).toEqual(['Descargar', 'Ver en grande', 'Generar de nuevo', 'Descartar'])
    for (const [label, event] of [['Descargar', 'download'], ['Ver en grande', 'preview'], ['Generar de nuevo', 'regenerate'], ['Descartar', 'dismiss']] as const) {
      await buttonsWithText(wrapper, label)[0]!.trigger('click')
      expect(wrapper.emitted(event), label).toHaveLength(1)
    }
  })

  it('fallida reintentable: mensaje, Reintentar y Descartar', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status: 'failed', url: undefined, error: 'La imagen tardó demasiado. Inténtalo de nuevo.', retryable: true }) } })
    expect(wrapper.get('[role="alert"]').text()).toBe('La imagen tardó demasiado. Inténtalo de nuevo.')
    expect(labels(wrapper)).toEqual(['Reintentar', 'Descartar'])
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('fallida no reintentable: sin Reintentar; sin texto usa el respaldo', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status: 'failed', url: undefined, retryable: false }) } })
    expect(labels(wrapper)).toEqual(['Descartar'])
    expect(wrapper.text()).toContain('No pudimos generar la imagen.')
  })

  it('cancelada: Generar de nuevo y Descartar; una sola petición dice «1 petición»', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status: 'canceled', url: undefined, fileIds: ['a'] }) } })
    expect(labels(wrapper)).toEqual(['Generar de nuevo', 'Descartar'])
    expect(wrapper.text()).toContain('1 petición')
  })

  it('ningún botón es btn-sm o btn-xs de base', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item() } })
    for (const button of wrapper.findAll('button')) expect(button.classes().some(c => /^btn-(sm|xs)$/.test(c))).toBe(false)
  })
})

describe('PrayerResults', () => {
  beforeEach(() => {
    usePrayerImages().reset()
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    usePrayerImages().reset()
    vi.restoreAllMocks()
  })

  it('encabezado, una tarjeta por imagen y una región viva que anuncia los cambios', async () => {
    useState<PrayerImageItem[]>('prayer-images').value = [item({ status: 'running', url: undefined }), item({ key: 'img-2', index: 2, status: 'queued', url: undefined })]
    const wrapper = await mountSuspended(PrayerResults)
    expect(wrapper.get('h2').text()).toBe('Imágenes generadas')
    expect(wrapper.findAll('article')).toHaveLength(2)
    const live = wrapper.get('[aria-live="polite"]')
    useState<PrayerImageItem[]>('prayer-images').value = [item(), item({ key: 'img-2', index: 2, status: 'running', url: undefined })]
    await flush()
    expect(live.text()).toBe('Imagen 1 lista')
    useState<PrayerImageItem[]>('prayer-images').value = [item(), item({ key: 'img-2', index: 2, status: 'failed', url: undefined, retryable: true })]
    await flush()
    expect(live.text()).toBe('La imagen 2 no se pudo generar')
  })

  it('Descartar todas pide confirmación y vacía', async () => {
    useState<PrayerImageItem[]>('prayer-images').value = [item()]
    const wrapper = await mountSuspended(PrayerResults)
    await buttonsWithText(wrapper, 'Descartar todas')[0]!.trigger('click')
    await flush()
    expect(useConfirm().options.value?.title).toBe('Descartar todas')
    useConfirm().cancel()
    await flush()
    expect(usePrayerImages().items.value).toHaveLength(1)
    await buttonsWithText(wrapper, 'Descartar todas')[0]!.trigger('click')
    await flush()
    useConfirm().accept()
    await flush()
    expect(usePrayerImages().items.value).toEqual([])
  })

  it('Ver en grande abre la vista ampliada', async () => {
    useState<PrayerImageItem[]>('prayer-images').value = [item()]
    const wrapper = await mountSuspended(PrayerResults, { attachTo: document.body })
    await buttonsWithText(wrapper, 'Ver en grande')[0]!.trigger('click')
    await flush()
    const dialog = document.body.querySelector('dialog')
    expect(dialog?.querySelector('img')?.getAttribute('src')).toBe('blob:x')
    expect(dialog?.textContent).toContain('Imagen de peticiones 1')
    wrapper.unmount()
  })
})
