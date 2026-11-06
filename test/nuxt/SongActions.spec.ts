// T043 — Acciones de la ficha (feature 006): Generar presentación (primario, con la nota de la letra en blanco), deshabilitado
// mientras se genera o con letra de más de 300 líneas mostrando el motivo; sin selector de color; Volver a obtener la letra.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { SongDetail } from '#shared/types/api'
import SongActions from '~/components/songs/SongActions.vue'
import { buttonsWithText } from './helpers/api'

const song = (changes: Partial<SongDetail> = {}): SongDetail => ({
  id: 's1', title: 'Canción', artist: null, sourceUrl: 'https://letras.com/a/b', lyrics: [['a']], lineCount: 1,
  createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z', ...changes,
})

describe('SongActions', () => {
  it('Generar presentación emite generate y muestra la nota de la letra en blanco', async () => {
    const wrapper = await mountSuspended(SongActions, { props: { song: song() } })
    const generate = buttonsWithText(wrapper, 'Generar presentación')[0]!
    expect(generate.classes()).toContain('btn-primary')
    expect(generate.attributes('disabled')).toBeUndefined()
    await generate.trigger('click')
    expect(wrapper.emitted('generate')).toHaveLength(1)
    const hint = wrapper.get(`#${generate.attributes('aria-describedby')}`)
    expect(hint.text()).toBe('La letra va en blanco: proyecta la presentación sobre un fondo oscuro.')
  })

  it('no hay ningún selector de color', async () => {
    const wrapper = await mountSuspended(SongActions, { props: { song: song() } })
    expect(wrapper.find('input[type="color"]').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/color/i)
  })

  it('mientras se genera queda deshabilitado', async () => {
    const wrapper = await mountSuspended(SongActions, { props: { song: song(), generating: true } })
    expect(buttonsWithText(wrapper, 'Generar presentación')[0]!.attributes('disabled')).toBeDefined()
  })

  it('con más de 300 líneas queda deshabilitado y dice por qué', async () => {
    const wrapper = await mountSuspended(SongActions, { props: { song: song({ lineCount: 301 }) } })
    const generate = buttonsWithText(wrapper, 'Generar presentación')[0]!
    expect(generate.attributes('disabled')).toBeDefined()
    const [reasonId] = generate.attributes('aria-describedby')!.split(' ')
    expect(wrapper.get(`#${reasonId}`).text()).toBe('No se puede generar: la letra pasa de 300 líneas.')
  })

  it('Volver a obtener la letra emite refresh y se deshabilita mientras corre', async () => {
    const wrapper = await mountSuspended(SongActions, { props: { song: song() } })
    await buttonsWithText(wrapper, 'Volver a obtener la letra')[0]!.trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
    await wrapper.setProps({ refreshing: true })
    expect(buttonsWithText(wrapper, 'Volver a obtener la letra')[0]!.attributes('disabled')).toBeDefined()
  })
})
