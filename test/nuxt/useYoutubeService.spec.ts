// T030 — Estado del servicio de descargas (feature 005, research D7): ping al montar, reintento cada 5 s mientras no
// responda, se detiene al quedar `up` o sin configuración, y `markWaking` tras un 503 de otra acción.
import { describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { YOUTUBE_HEALTH_RETRY_MS } from '#shared/constants/youtube'
import { failWith, flush, mockApi } from './helpers/api'

const { interval } = vi.hoisted(() => ({ interval: { pause: vi.fn(), resume: vi.fn(), ms: 0, fn: null as null | (() => unknown) } }))
mockNuxtImport('useIntervalFn', () => (fn: () => unknown, ms: number) => {
  interval.fn = fn
  interval.ms = ms
  return { pause: interval.pause, resume: interval.resume, isActive: { value: false } }
})

async function mount() {
  let service!: ReturnType<typeof useYoutubeService>
  const wrapper = await mountSuspended(defineComponent({
    setup() {
      service = useYoutubeService()
      return () => h('p', service.state.value)
    },
  }))
  await flush()
  return { wrapper, service }
}

describe('useYoutubeService', () => {
  it('up → detiene el reintento', async () => {
    interval.pause.mockClear()
    mockApi('GET', '/api/youtube/health', { state: 'up' })
    const { wrapper } = await mount()
    expect(wrapper.text()).toBe('up')
    expect(interval.ms).toBe(YOUTUBE_HEALTH_RETRY_MS)
    expect(YOUTUBE_HEALTH_RETRY_MS).toBe(5000)
    expect(interval.pause).toHaveBeenCalled()
  })

  it('waking o down → reintenta; un fallo de red cuenta como despertando', async () => {
    interval.resume.mockClear()
    mockApi('GET', '/api/youtube/health', { state: 'down' })
    const { wrapper, service } = await mount()
    expect(wrapper.text()).toBe('down')
    expect(interval.resume).toHaveBeenCalled()
    mockApi('GET', '/api/youtube/health', failWith(502))
    await service.retry()
    await flush()
    expect(wrapper.text()).toBe('waking')
    mockApi('GET', '/api/youtube/health', { state: 'up' })
    await interval.fn!()
    await flush()
    expect(wrapper.text()).toBe('up')
  })

  it('sin configuración no reintenta ni cambia con markWaking', async () => {
    interval.resume.mockClear()
    mockApi('GET', '/api/youtube/health', failWith(503, { state: 'notConfigured' }))
    const { wrapper, service } = await mount()
    expect(wrapper.text()).toBe('notConfigured')
    service.markWaking()
    await flush()
    expect(wrapper.text()).toBe('notConfigured')
  })

  it('markWaking muestra el aviso y vuelve a sondear', async () => {
    mockApi('GET', '/api/youtube/health', { state: 'up' })
    const { wrapper, service } = await mount()
    interval.resume.mockClear()
    service.markWaking()
    await flush()
    expect(wrapper.text()).toBe('waking')
    expect(interval.resume).toHaveBeenCalled()
  })
})
