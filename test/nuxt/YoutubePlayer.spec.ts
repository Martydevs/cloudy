// T022/T067 — Reproductor (feature 005, research D5 revisado): la miniatura no carga nada de YouTube hasta pulsar Play;
// al pulsar monta el iframe oficial (dominio sin cookies) y avisa con `preconnect` al acercarse.
import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import YoutubePlayer from '~/components/youtube/YoutubePlayer.vue'

const preconnects = () => [...document.head.querySelectorAll('link[rel="preconnect"]')].map(link => link.getAttribute('href'))

async function mount(props: Record<string, unknown> = {}) {
  return mountSuspended(YoutubePlayer, {
    props: { videoId: 'okShortVid1', poster: 'https://i.ytimg.com/vi/okShortVid1/hq.jpg', title: 'Alabanza', ...props },
    attachTo: document.body,
  })
}

describe('YoutubePlayer', () => {
  it('muestra la miniatura y el botón Reproducir, sin iframe ni conexiones a YouTube', async () => {
    const wrapper = await mount()
    expect(wrapper.find('iframe').exists()).toBe(false)
    const play = wrapper.get('button')
    expect(play.attributes('aria-label')).toBe('Reproducir: Alabanza')
    expect(wrapper.get('img').attributes('src')).toBe('https://i.ytimg.com/vi/okShortVid1/hq.jpg')
    expect(wrapper.get('[role="region"]').attributes('aria-label')).toBe('Reproductor: Alabanza')
    expect(preconnects()).toEqual([])
    wrapper.unmount()
  })

  it('al acercar el cursor abre la conexión con YouTube antes de pulsar', async () => {
    const wrapper = await mount()
    await wrapper.get('button').trigger('pointerenter')
    await vi.waitFor(() => expect(preconnects()).toEqual(['https://www.youtube-nocookie.com', 'https://i.ytimg.com']))
    wrapper.unmount()
  })

  it('al enfocar el botón (teclado) también la abre', async () => {
    const wrapper = await mount()
    await wrapper.get('button').trigger('focus')
    await vi.waitFor(() => expect(preconnects()).toContain('https://www.youtube-nocookie.com'))
    wrapper.unmount()
  })

  it('Reproducir monta el reproductor oficial incrustado y en español', async () => {
    const wrapper = await mount()
    await wrapper.get('button').trigger('click')
    const frame = wrapper.get('iframe')
    expect(wrapper.find('button').exists()).toBe(false)
    const url = new URL(frame.attributes('src')!)
    expect(url.origin).toBe('https://www.youtube-nocookie.com')
    expect(url.pathname).toBe('/embed/okShortVid1')
    expect(Object.fromEntries(url.searchParams)).toEqual({ autoplay: '1', rel: '0', playsinline: '1', hl: 'es' })
    expect(frame.attributes('title')).toBe('YouTube: Alabanza')
    expect(frame.attributes('allow')).toContain('fullscreen')
    expect(frame.attributes('allowfullscreen')).toBeDefined()
    wrapper.unmount()
  })

  it('sin miniatura propia usa la de YouTube; sin título, nombres genéricos; con autoplay arranca ya', async () => {
    const idle = await mount({ poster: null, title: '' })
    expect(idle.get('img').attributes('src')).toBe('https://i.ytimg.com/vi/okShortVid1/hqdefault.jpg')
    expect(idle.get('button').attributes('aria-label')).toBe('Reproducir')
    expect(idle.get('[role="region"]').attributes('aria-label')).toBe('Reproductor')
    idle.unmount()

    const auto = await mount({ autoplay: true, title: '', fill: true })
    expect(auto.get('iframe').attributes('title')).toBe('Reproductor de YouTube')
    expect(auto.get('[role="region"]').classes()).toContain('flex-1')
    auto.unmount()
  })

  it('al cambiar de video vuelve a la miniatura (o arranca el nuevo con autoplay)', async () => {
    const wrapper = await mount()
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({ videoId: 'lowResVid01' })
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(true)
    wrapper.unmount()

    const auto = await mount({ autoplay: true })
    await auto.setProps({ videoId: 'lowResVid01' })
    expect(auto.get('iframe').attributes('src')).toContain('/embed/lowResVid01')
    auto.unmount()
  })
})
