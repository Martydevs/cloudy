// T025 — Letra por estrofas (feature 006): una <p> por estrofa, texto real (sin HTML interpretado), contador y aviso > 300.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SongLyrics from '~/components/songs/SongLyrics.vue'

describe('SongLyrics', () => {
  it('una <p> por estrofa con sus líneas en orden', async () => {
    const wrapper = await mountSuspended(SongLyrics, { props: { stanzas: [['uno', 'dos'], ['tres']] } })
    const paragraphs = wrapper.findAll('p').filter(p => p.classes().includes('whitespace-pre-line'))
    expect(paragraphs.map(p => p.element.textContent)).toEqual(['uno\ndos', 'tres'])
    expect(wrapper.text()).toContain('3 líneas')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('el HTML de la letra se muestra como texto, nunca se interpreta', async () => {
    const wrapper = await mountSuspended(SongLyrics, { props: { stanzas: [['<b>negrita</b> <script>alert(1)</script>']] } })
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b>negrita</b>')
  })

  it('una sola línea en singular; más de 300 muestra el aviso', async () => {
    const one = await mountSuspended(SongLyrics, { props: { stanzas: [['sola']] } })
    expect(one.text()).toContain('1 línea')
    const long = await mountSuspended(SongLyrics, { props: { stanzas: [Array.from({ length: 301 }, (_, i) => `l${i}`)] } })
    expect(long.text()).toContain('301 líneas')
    expect(long.get('[role="alert"]').text()).toBe('Eso no parece una canción: la letra pasa de 300 líneas.')
  })
})
