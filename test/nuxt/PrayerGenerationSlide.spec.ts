// La diapositiva grande de una generación (`PrayerGenerationSlide`): la imagen guardada con su esqueleto hasta que carga y
// «Sin vista previa» si falla (también cuando la imagen del SSR terminó antes de hidratar); en cola o generándose con
// «Cancelar»; fallida con el motivo y «Reintentar» solo si sirve; cancelada con «Volver a poner en cola»; sin terminar con
// «Generar las faltantes».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { PrayerGenerationSlide as Slide } from '~/composables/usePrayerGeneration'
import type { PrayerImageItem } from '~/composables/usePrayerImages'
import PrayerGenerationSlide from '~/components/prayers/PrayerGenerationSlide.vue'
import { buttonsWithText } from './helpers/api'
import { generated, prayer } from './prayer-fixtures'

const fileIds = [prayer(1).id, prayer(2).id]

const item = (changes: Partial<PrayerImageItem> = {}): PrayerImageItem =>
  ({ key: 'img-1', index: 1, fileIds, generationId: 'gen-1', status: 'queued', ...changes })

const slide = (changes: Partial<Slide> = {}): Slide =>
  ({ key: 'g-2', index: 2, fileIds, image: null, state: 'unfinished', item: null, ...changes })

const ready = (changes: Partial<Slide> = {}) => slide({ state: 'ready', image: generated(1, { fileIds }), ...changes })

const mountSlide = (value: Slide, priority?: boolean) =>
  mountSuspended(PrayerGenerationSlide, { props: priority === undefined ? { slide: value } : { slide: value, priority } })

/** El esqueleto no tiene rol ni nombre (es decorativo): se busca por su clase de daisyUI. */
const SKELETON = '.skeleton[aria-hidden="true"]'

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PrayerGenerationSlide', () => {
  describe('lista', () => {
    // happy-dom no carga imágenes y da todo `<img>` por terminado (`complete`) con ancho 0: en un navegador, una imagen
    // recién montada sigue cargando.
    beforeEach(() => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
    })

    it('muestra la imagen guardada con su texto alternativo y un esqueleto hasta que carga', async () => {
      const wrapper = await mountSlide(ready())
      const img = wrapper.get('img')
      expect(img.attributes('src')).toBe(generated(1).previewUrl)
      expect(img.attributes('alt')).toBe('Imagen 2 de peticiones, con 2 peticiones')
      expect(img.attributes('fetchpriority')).toBe('auto')
      expect(wrapper.find(SKELETON).exists()).toBe(true)

      await img.trigger('load')
      expect(wrapper.find(SKELETON).exists()).toBe(false)
      expect(wrapper.find('img').exists()).toBe(true)
      expect(wrapper.findAll('button')).toHaveLength(0)
    })

    it('una sola petición se nombra en singular y la primera pintura va con prioridad alta', async () => {
      const wrapper = await mountSlide(ready({ index: 1, fileIds: [prayer(1).id] }), true)
      const img = wrapper.get('img')
      expect(img.attributes('alt')).toBe('Imagen 1 de peticiones, con 1 petición')
      expect(img.attributes('fetchpriority')).toBe('high')
    })

    it('si la imagen no carga, «Sin vista previa» en lugar de la imagen rota', async () => {
      const wrapper = await mountSlide(ready())
      await wrapper.get('img').trigger('error')
      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.find(SKELETON).exists()).toBe(false)
      expect(wrapper.text()).toBe('Sin vista previa')
    })

    it('la imagen que ya había cargado antes de montar (SSR) no se queda con el esqueleto', async () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1376)
      const wrapper = await mountSlide(ready())
      expect(wrapper.find('img').exists()).toBe(true)
      expect(wrapper.find(SKELETON).exists()).toBe(false)
    })

    it('la imagen que ya había fallado antes de montar (SSR) muestra «Sin vista previa»', async () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
      const wrapper = await mountSlide(ready())
      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.text()).toBe('Sin vista previa')
    })
  })

  it.each([
    ['queued', 'En cola: empieza en cuanto termine otra imagen.'],
    ['running', 'Generándose… suele tardar menos de un minuto.'],
  ] as const)('%s: esqueleto, su estado y «Cancelar»', async (state, hint) => {
    const wrapper = await mountSlide(slide({ state, item: item({ status: state }) }))
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find(SKELETON).exists()).toBe(true)
    expect(wrapper.get('p').text()).toBe(hint)
    const buttons = wrapper.findAll('button')
    expect(buttons.map(button => button.text())).toEqual(['Cancelar'])
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted()).toEqual(expect.objectContaining({ cancel: [[]] }))
    expect(Object.keys(wrapper.emitted()).filter(name => ['retry', 'requeue', 'dismiss', 'missing'].includes(name))).toEqual([])
  })

  describe('fallida', () => {
    it('con un fallo reintentable: el motivo como alerta, «Reintentar» y «Descartar»', async () => {
      const wrapper = await mountSlide(slide({
        state: 'failed',
        item: item({ status: 'failed', error: 'El servicio de imágenes falló.', errorCode: 'provider', retryable: true }),
      }))
      expect(wrapper.get('[role="alert"]').text()).toBe('El servicio de imágenes falló.')
      expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Reintentar', 'Descartar'])
      await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
      await buttonsWithText(wrapper, 'Descartar')[0]!.trigger('click')
      expect(wrapper.emitted('retry')).toHaveLength(1)
      expect(wrapper.emitted('dismiss')).toHaveLength(1)
      expect(wrapper.emitted('cancel')).toBeUndefined()
    })

    it('con un fallo que reintentar no arregla: solo «Descartar»', async () => {
      const wrapper = await mountSlide(slide({
        state: 'failed',
        item: item({ status: 'failed', error: 'Se agotó el crédito.', errorCode: 'quota_exceeded', retryable: false }),
      }))
      expect(wrapper.get('[role="alert"]').text()).toBe('Se agotó el crédito.')
      expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Descartar'])
    })

    it('sin motivo conocido usa el mensaje genérico', async () => {
      const wrapper = await mountSlide(slide({ state: 'failed', item: item({ status: 'failed' }) }))
      expect(wrapper.get('[role="alert"]').text()).toBe('No pudimos generar la imagen. Inténtalo de nuevo.')
      const orphan = await mountSlide(slide({ state: 'failed', item: null }))
      expect(orphan.get('[role="alert"]').text()).toBe('No pudimos generar la imagen. Inténtalo de nuevo.')
      expect(orphan.findAll('button').map(button => button.text())).toEqual(['Descartar'])
    })
  })

  it('cancelada: lo dice y ofrece «Volver a poner en cola»', async () => {
    const wrapper = await mountSlide(slide({ state: 'canceled', item: item({ status: 'canceled' }) }))
    expect(wrapper.text()).toContain('Cancelaste esta imagen. Vuelve a ponerla en cola cuando quieras.')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const buttons = wrapper.findAll('button')
    expect(buttons.map(button => button.text())).toEqual(['Volver a poner en cola'])
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('requeue')).toHaveLength(1)
    expect(wrapper.emitted('missing')).toBeUndefined()
  })

  it('sin terminar: explica qué pasó y ofrece «Generar las faltantes»', async () => {
    const wrapper = await mountSlide(slide())
    expect(wrapper.findAll('p').map(p => p.text())).toEqual([
      'Sin terminar',
      'Esta imagen no llegó a generarse (se cerró la página o falló). Usa «Generar las faltantes».',
    ])
    expect(wrapper.find('img').exists()).toBe(false)
    const buttons = wrapper.findAll('button')
    expect(buttons.map(button => button.text())).toEqual(['Generar las faltantes'])
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('missing')).toHaveLength(1)
    expect(wrapper.emitted('requeue')).toBeUndefined()
  })

  it('al cambiar de estado la misma diapositiva pasa de generándose a su imagen', async () => {
    const wrapper = await mountSlide(slide({ state: 'running', item: item({ status: 'running' }) }))
    expect(buttonsWithText(wrapper, 'Cancelar')).toHaveLength(1)
    await wrapper.setProps({ slide: ready() })
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.get('img').attributes('src')).toBe(generated(1).previewUrl)
  })
})
