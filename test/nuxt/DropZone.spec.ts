// Feature 003 (US2) — "Abrir cámara" dentro del selector de archivos, solo con `camera` y en teléfonos y tabletas.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick, ref } from 'vue'
import DropZone from '~/components/upload/DropZone.vue'
import { buttonsWithText, flush } from './helpers/api'

const { available } = vi.hoisted(() => ({ available: { value: true } }))
mockNuxtImport('useCameraAvailability', () => () => ({ available: ref(available.value) }))

beforeEach(() => {
  available.value = true
})

describe('DropZone · cámara', () => {
  it('sin `camera` no hay "Abrir cámara" ni espacio reservado', async () => {
    const wrapper = await mountSuspended(DropZone)
    expect(buttonsWithText(wrapper, 'Abrir cámara')).toHaveLength(0)
    expect(wrapper.find('[data-camera-slot]').exists()).toBe(false)
  })

  it('con `camera` y cámara disponible aparece dentro de la zona; abrirla no dispara el selector', async () => {
    const wrapper = await mountSuspended(DropZone, { props: { camera: true } })
    const open = buttonsWithText(wrapper, 'Abrir cámara')
    expect(open).toHaveLength(1)
    expect(open[0]!.classes()).toContain('btn')
    expect(open[0]!.classes().some(c => /^btn-(xs|sm)$/.test(c))).toBe(false)
    const input = wrapper.get('input[type="file"]').element as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await open[0]!.trigger('click')
    await flush()
    expect(click).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(wrapper.find('dialog').exists()).toBe(true))
  })

  it('con `camera` pero sin cámara disponible no aparece; el espacio queda reservado (sin saltos al hidratar)', async () => {
    available.value = false
    const wrapper = await mountSuspended(DropZone, { props: { camera: true } })
    expect(buttonsWithText(wrapper, 'Abrir cámara')).toHaveLength(0)
    expect(wrapper.find('[data-camera-slot]').classes()).toContain('min-h-11')
  })

  it('`cameraDisabled` lo deshabilita con la indicación del límite', async () => {
    const wrapper = await mountSuspended(DropZone, { props: { camera: true, cameraDisabled: true } })
    const open = buttonsWithText(wrapper, 'Abrir cámara')[0]!
    expect(open.attributes('disabled')).toBeDefined()
    const hint = wrapper.get(`#${open.attributes('aria-describedby')}`)
    expect(hint.text()).toContain('100 MB')
  })

  it('cada foto de la cámara se emite por el mismo evento `files`', async () => {
    const wrapper = await mountSuspended(DropZone, { props: { camera: true, maxPhotos: 3 } })
    await buttonsWithText(wrapper, 'Abrir cámara')[0]!.trigger('click')
    await vi.waitFor(() => expect(wrapper.findComponent({ name: 'CameraCapture' }).exists()).toBe(true))
    const camera = wrapper.findComponent({ name: 'CameraCapture' })
    expect(camera.props('maxPhotos')).toBe(3)
    const photo = new File(['x'], 'foto-20261029-140509.jpg', { type: 'image/jpeg' })
    camera.vm.$emit('photo', photo)
    expect(wrapper.emitted('files')).toEqual([[[photo]]])
    camera.vm.$emit('close')
    await nextTick()
    expect(wrapper.findComponent({ name: 'CameraCapture' }).exists()).toBe(false)
  })
})
