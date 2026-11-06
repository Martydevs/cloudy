// T025 — Datos de la canción (feature 006): título en <h1>, artista opcional, enlace externo y fecha relativa.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { SongDetail } from '#shared/types/api'
import SongMeta from '~/components/songs/SongMeta.vue'

const song = (changes: Partial<SongDetail> = {}): SongDetail => ({
  id: 's1',
  title: 'De Buenas',
  artist: 'Musiko',
  sourceUrl: 'https://letras.com/musiko/de-buenas',
  lyrics: [['uno']],
  lineCount: 1,
  createdAt: new Date(Date.now() - 7_200_000).toISOString(),
  updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
  ...changes,
})

describe('SongMeta', () => {
  it('título, artista, enlace a Letras.com en otra pestaña y «Obtenida hace…»', async () => {
    const wrapper = await mountSuspended(SongMeta, { props: { song: song() } })
    expect(wrapper.get('h1').text()).toBe('De Buenas')
    expect(wrapper.text()).toContain('Musiko')
    const link = wrapper.get('a')
    expect(link.text()).toContain('Ver en Letras.com')
    expect(link.attributes()).toMatchObject({ href: 'https://letras.com/musiko/de-buenas', target: '_blank', rel: 'noopener noreferrer' })
    expect(wrapper.text()).toMatch(/Obtenida hace 1 hora/)
  })

  it('sin artista no muestra ese dato', async () => {
    const wrapper = await mountSuspended(SongMeta, { props: { song: song({ artist: null }) } })
    expect(wrapper.text()).not.toContain('Musiko')
    expect(wrapper.find('[name="lucide:mic-vocal"]').exists()).toBe(false)
  })
})
