// T048 — Imagen en curso (feature 007, contracts/ui.md, enmienda de historial): en cola, generándose, fallida o cancelada.
// Lista, sale de la cola y la muestra `PrayerHistoryCard`.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PrayerResultCard from '~/components/prayers/PrayerResultCard.vue'
import type { PrayerImageItem } from '~/composables/usePrayerImages'
import { buttonsWithText } from './helpers/api'

const item = (changes: Partial<PrayerImageItem> = {}): PrayerImageItem =>
  ({ key: 'img-1', index: 1, fileIds: ['a', 'b'], status: 'running', ...changes })

const labels = (wrapper: { findAll: (s: string) => { text: () => string }[] }) => wrapper.findAll('button').map(b => b.text().trim())

describe('PrayerResultCard', () => {
  it.each(['queued', 'running'] as const)('%s: esqueleto con la proporción de la plantilla, progreso y Cancelar', async (status) => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status }) } })
    expect(wrapper.find('.aspect-\\[1376\\/768\\] .skeleton').exists()).toBe(true)
    expect(wrapper.get('progress').classes()).toContain('motion-reduce:animate-none')
    expect(wrapper.text()).toContain(status === 'queued' ? 'En cola' : 'Generando…')
    expect(labels(wrapper)).toEqual(['Cancelar'])
    await buttonsWithText(wrapper, 'Cancelar')[0]!.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('fallida reintentable: mensaje, Reintentar y Descartar', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status: 'failed', error: 'La imagen tardó demasiado. Inténtalo de nuevo.', retryable: true }) } })
    expect(wrapper.get('[role="alert"]').text()).toBe('La imagen tardó demasiado. Inténtalo de nuevo.')
    expect(labels(wrapper)).toEqual(['Reintentar', 'Descartar'])
    await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('fallida no reintentable: sin Reintentar; sin texto usa el respaldo', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status: 'failed', retryable: false }) } })
    expect(labels(wrapper)).toEqual(['Descartar'])
    expect(wrapper.text()).toContain('No pudimos generar la imagen.')
  })

  it('cancelada: Generar de nuevo y Descartar; una sola petición dice «1 petición»', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status: 'canceled', fileIds: ['a'] }) } })
    expect(labels(wrapper)).toEqual(['Generar de nuevo', 'Descartar'])
    expect(wrapper.text()).toContain('1 petición')
  })

  it('cancelada: Generar de nuevo y Descartar emiten', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status: 'canceled' }) } })
    await buttonsWithText(wrapper, 'Generar de nuevo')[0]!.trigger('click')
    await buttonsWithText(wrapper, 'Descartar')[0]!.trigger('click')
    expect(wrapper.emitted('regenerate')).toHaveLength(1)
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('ningún botón es btn-sm o btn-xs de base', async () => {
    const wrapper = await mountSuspended(PrayerResultCard, { props: { item: item({ status: 'failed', retryable: true }) } })
    for (const button of wrapper.findAll('button')) expect(button.classes().some(c => /^btn-(sm|xs)$/.test(c))).toBe(false)
  })
})
