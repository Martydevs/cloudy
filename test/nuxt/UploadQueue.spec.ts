import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { UploadItem } from '~/composables/useUploader'
import UploadQueue from '~/components/upload/UploadQueue.vue'

function sizedFile(name: string, size: number, type: string) {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const item = (changes: Partial<UploadItem>): UploadItem => ({
  id: 'a',
  name: 'culto.mp3',
  size: 2048,
  status: 'queued',
  progress: 0,
  error: null,
  retryable: false,
  ...changes,
})

describe('useUploader: validación local', () => {
  it('marca los archivos inválidos como error sin pedir firma al servidor', async () => {
    const uploader = useUploader({ folderId: null })
    uploader.add([
      sizedFile('culto.mp4', 120 * 1024 * 1024, 'video/mp4'),
      sizedFile('setup.exe', 1000, 'application/x-msdownload'),
    ])
    expect(uploader.items.value.map(i => [i.status, i.error, i.retryable])).toEqual([
      ['error', '«culto.mp4» supera 100 MB', false],
      ['error', '«setup.exe»: formato no admitido', false],
    ])

    const wrapper = await mountSuspended(UploadQueue, { props: { items: uploader.items.value } })
    expect(wrapper.text()).toContain('supera 100 MB')
    expect(wrapper.text()).toContain('formato no admitido')
    expect(wrapper.find('button[aria-label^="Reintentar"]').exists()).toBe(false)
  })
})

describe('UploadQueue', () => {
  it('muestra el progreso de cada archivo con aria-valuenow', async () => {
    const wrapper = await mountSuspended(UploadQueue, {
      props: { items: [item({ id: 'a', status: 'uploading', progress: 42 }), item({ id: 'b', name: 'foto.jpg', status: 'queued' })] },
    })
    const bars = wrapper.findAll('progress')
    expect(bars).toHaveLength(1)
    expect(bars[0]!.attributes('aria-valuenow')).toBe('42')
    expect(bars[0]!.attributes('aria-label')).toBe('Progreso de culto.mp3')
    expect(wrapper.text()).toContain('Subiendo')
    expect(wrapper.text()).toContain('En espera')
  })

  it('un error de red ofrece "Reintentar" y emite retry', async () => {
    const wrapper = await mountSuspended(UploadQueue, {
      props: { items: [item({ status: 'error', error: 'Se perdió la conexión al subir «culto.mp3». Reintenta.', retryable: true })] },
    })
    const retry = wrapper.get('button[aria-label="Reintentar culto.mp3"]')
    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['a']])
    expect(wrapper.get('[role="alert"]').text()).toContain('Se perdió la conexión')
  })

  it('permite cancelar una subida en curso', async () => {
    const wrapper = await mountSuspended(UploadQueue, { props: { items: [item({ status: 'uploading', progress: 10 })] } })
    await wrapper.get('button[aria-label="Cancelar culto.mp3"]').trigger('click')
    expect(wrapper.emitted('cancel')).toEqual([['a']])
  })
})
