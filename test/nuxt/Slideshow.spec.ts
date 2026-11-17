// Pase de diapositivas genérico (`ui/Slideshow.vue` y `ui/SlideshowThumb.vue`): ranuras, ‹ › con vuelta al principio,
// miniaturas con `aria-current`, casillas de selección, `v-model:index` / `v-model:selected`, teclado y deslizamiento,
// posición en la query, la fila de miniaturas que lleva la actual a la vista (con movimiento reducido) y la precarga de
// las diapositivas vecinas cuando el navegador está libre.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import type { Me } from '#shared/types/api'
import Slideshow from '~/components/ui/Slideshow.vue'
import SlideshowThumb from '~/components/ui/SlideshowThumb.vue'
import { flush } from './helpers/api'

interface VisibilityOptions {
  scrollTarget: () => HTMLElement | null
  rootMargin: string
  once: boolean
}

// happy-dom no tiene IntersectionObserver ni media queries: la cercanía de las miniaturas y el movimiento reducido se
// controlan a mano.
const { near, reduced, visibilityCalls } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { near: ref(false), reduced: ref<'reduce' | 'no-preference'>('no-preference'), visibilityCalls: [] as VisibilityOptions[] }
})
mockNuxtImport('useElementVisibility', () => (_target: unknown, options: VisibilityOptions) => {
  visibilityCalls.push(options)
  return near
})
mockNuxtImport('usePreferredReducedMotion', () => () => reduced)

enableAutoUnmount(afterEach)

interface Slide {
  key: string
  title: string
  url: string | null
}

const slides: Slide[] = [
  { key: 'a', title: 'Uno', url: '/img/a.png' },
  { key: 'b', title: 'Dos', url: '/img/b.png' },
  { key: 'c', title: 'Tres', url: '/img/c.png' },
]
const labels = { region: 'Imágenes generadas', prev: 'Imagen anterior', next: 'Imagen siguiente', thumbs: 'Miniaturas' }

/** `mountSuspended` no infiere el genérico del componente (lo deja en `{ key: string }`): las diapositivas de esta prueba siempre son `Slide`. */
type Keyed = { key: string }
const titleOf = (slide: Keyed) => (slide as Slide).title

const slots = {
  header: () => h('h2', 'Resultado'),
  slide: (p: { slide: Keyed, index: number, first: boolean }) => h('figure', { 'aria-label': 'Diapositiva' }, `${titleOf(p.slide)}|${p.index}|${p.first}`),
  thumb: (p: { slide: Keyed, index: number, near: boolean, active: boolean }) => `${titleOf(p.slide)}|${p.index}|${p.near}|${p.active}`,
  caption: (p: { slide: Keyed, index: number, total: number }) => `${titleOf(p.slide)}: ${p.index + 1} de ${p.total}`,
  actions: (p: { slide: Keyed | undefined, index: number }) => h('p', { 'aria-label': 'Acciones' }, p.slide ? `Descargar ${titleOf(p.slide)} (${p.index})` : `Nada que descargar (${p.index})`),
}

interface MountOptions {
  route?: string
  slots?: Partial<typeof slots>
}

function mount(props: Record<string, unknown> = {}, options: MountOptions = {}) {
  return mountSuspended(Slideshow, {
    attachTo: document.body,
    route: options.route ?? '/archivos',
    props: { slides, labels, thumbLabel: (slide: Keyed, index: number) => `Ver ${titleOf(slide)} (${index + 1})`, ...props },
    slots: options.slots ?? slots,
  })
}

type Wrapper = Awaited<ReturnType<typeof mount>>

const button = (wrapper: Wrapper, label: string) => wrapper.get(`button[aria-label="${label}"]`)
const shown = (wrapper: Wrapper) => wrapper.get('[aria-label="Diapositiva"]').text()
const thumbs = (wrapper: Wrapper) => wrapper.findAll('ul[aria-label="Miniaturas"] button')
const currentThumbs = (wrapper: Wrapper) => thumbs(wrapper).filter(b => b.attributes('aria-current') === 'true').map(b => b.attributes('aria-label'))
const boxes = (wrapper: Wrapper) => wrapper.findAll('ul[aria-label="Miniaturas"] input[type="checkbox"]')
const checked = (wrapper: Wrapper) => boxes(wrapper).filter(box => (box.element as HTMLInputElement).checked).map(box => box.attributes('aria-label'))

function press(target: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

/** Evento táctil mínimo: `useSwipe` solo lee `touches[0].clientX/Y`. */
function touch(target: Element, type: 'touchstart' | 'touchmove' | 'touchend', x = 0) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: 0 }] })
  target.dispatchEvent(event)
}

/** Imágenes creadas por la precarga (sin pedir nada a la red). */
const images: { src: string, decoding: string }[] = []
class FakeImage {
  src = ''
  decoding = ''
  constructor() {
    images.push(this)
  }
}

/** Sustituye `requestIdleCallback` (happy-dom no lo trae) y deja ejecutar a mano lo que quedó pendiente. */
function stubIdle() {
  const pending: { run: () => void, options: unknown }[] = []
  vi.stubGlobal('requestIdleCallback', (run: () => void, options: unknown) => {
    pending.push({ run, options })
    return pending.length
  })
  return {
    pending,
    runAll() {
      for (const item of pending.splice(0)) item.run()
    },
  }
}

/** Intercepta solo los `setTimeout` de 300 ms (el respaldo de la precarga); los demás siguen siendo reales. */
function stubPreloadTimeout() {
  const pending: (() => void)[] = []
  const real = globalThis.setTimeout
  const fake = (handler: () => void, delay?: number) => {
    if (delay !== 300) return real(handler, delay)
    pending.push(handler)
    return 0
  }
  // El tipo de `setTimeout` tiene sobrecargas (y `__promisify__` en Node) que una función de prueba no reproduce.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(fake as unknown as typeof setTimeout)
  return {
    pending,
    runAll() {
      for (const run of pending.splice(0)) run()
    },
  }
}

beforeEach(() => {
  const me: Me = {
    user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
  useMe().loaded.value = true
  near.value = false
  reduced.value = 'no-preference'
  visibilityCalls.length = 0
  images.length = 0
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Slideshow: contenido y ranuras', () => {
  it('es un carrusel con nombre y pinta encabezado, diapositiva actual, pie, miniaturas y acciones', async () => {
    const wrapper = await mount()
    const region = wrapper.get('section[aria-label="Imágenes generadas"]')
    expect(region.attributes('aria-roledescription')).toBe('carrusel')
    expect(wrapper.get('h2').text()).toBe('Resultado')
    // Solo se pinta la diapositiva actual; `first` avisa de que es la primera pintura.
    expect(wrapper.findAll('[aria-label="Diapositiva"]')).toHaveLength(1)
    expect(shown(wrapper)).toBe('Uno|0|true')
    const caption = wrapper.get('[aria-live="polite"]')
    expect(caption.text()).toBe('Uno: 1 de 3')
    expect(caption.attributes('aria-atomic')).toBe('true')
    expect(thumbs(wrapper).map(b => b.attributes('aria-label'))).toEqual(['Ver Uno (1)', 'Ver Dos (2)', 'Ver Tres (3)'])
    expect(thumbs(wrapper).map(b => b.text())).toEqual(['Uno|0|false|true', 'Dos|1|false|false', 'Tres|2|false|false'])
    expect(wrapper.get('[aria-label="Acciones"]').text()).toBe('Descargar Uno (0)')
    expect(boxes(wrapper)).toHaveLength(0)
  })

  it('sin la ranura del pie no hay zona anunciada', async () => {
    const wrapper = await mount({}, { slots: { slide: slots.slide, thumb: slots.thumb } })
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(false)
    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Acciones"]').exists()).toBe(false)
    expect(shown(wrapper)).toBe('Uno|0|true')
  })

  it('la proporción del escenario se puede cambiar', async () => {
    const stageOf = (wrapper: Wrapper) => wrapper.get('[aria-label="Diapositiva"]').element.parentElement!
    expect(stageOf(await mount()).classList).toContain('aspect-[1376/768]')
    const square = stageOf(await mount({ stageClass: 'aspect-square' }))
    expect(square.classList).toContain('aspect-square')
    expect(square.classList).not.toContain('aspect-[1376/768]')
  })

  it('lista vacía: sin diapositiva, botones, pie ni miniaturas; las acciones reciben que no hay diapositiva', async () => {
    const wrapper = await mount({ slides: [] })
    expect(wrapper.find('[aria-label="Diapositiva"]').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(false)
    expect(wrapper.find('ul').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Acciones"]').text()).toBe('Nada que descargar (0)')

    // Las diapositivas llegan después (p. ej. al terminar de generarse).
    await wrapper.setProps({ slides })
    expect(shown(wrapper)).toBe('Uno|0|true')
    expect(thumbs(wrapper)).toHaveLength(3)
    expect(wrapper.find('button[aria-label="Imagen siguiente"]').exists()).toBe(true)
  })

  it('con una sola diapositiva no hay botones de anterior y siguiente', async () => {
    const wrapper = await mount({ slides: slides.slice(0, 1) })
    expect(wrapper.find('button[aria-label="Imagen anterior"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Imagen siguiente"]').exists()).toBe(false)
    expect(thumbs(wrapper)).toHaveLength(1)
    expect(currentThumbs(wrapper)).toEqual(['Ver Uno (1)'])
  })
})

describe('Slideshow: navegación', () => {
  it('siguiente y anterior dan la vuelta, y la miniatura actual lleva aria-current', async () => {
    const wrapper = await mount()
    expect(currentThumbs(wrapper)).toEqual(['Ver Uno (1)'])

    await button(wrapper, 'Imagen siguiente').trigger('click')
    expect(shown(wrapper)).toBe('Dos|1|false')
    expect(currentThumbs(wrapper)).toEqual(['Ver Dos (2)'])
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Dos: 2 de 3')
    expect(wrapper.get('[aria-label="Acciones"]').text()).toBe('Descargar Dos (1)')

    await button(wrapper, 'Imagen siguiente').trigger('click')
    await button(wrapper, 'Imagen siguiente').trigger('click')
    expect(shown(wrapper)).toBe('Uno|0|false')

    await button(wrapper, 'Imagen anterior').trigger('click')
    expect(shown(wrapper)).toBe('Tres|2|false')
    expect(currentThumbs(wrapper)).toEqual(['Ver Tres (3)'])
    expect(thumbs(wrapper).map(b => b.text())).toEqual(['Uno|0|false|false', 'Dos|1|false|false', 'Tres|2|false|true'])
    expect(wrapper.emitted('update:index')).toEqual([[1], [2], [0], [2]])
  })

  it('una miniatura abre su diapositiva; la que ya está abierta no hace nada', async () => {
    const wrapper = await mount()
    await button(wrapper, 'Ver Uno (1)').trigger('click')
    expect(wrapper.emitted('update:index')).toBeUndefined()
    // Sin movimiento, la diapositiva sigue siendo la primera pintura.
    expect(shown(wrapper)).toBe('Uno|0|true')

    await button(wrapper, 'Ver Tres (3)').trigger('click')
    expect(shown(wrapper)).toBe('Tres|2|false')
    expect(wrapper.emitted('update:index')).toEqual([[2]])
  })

  it('v-model:index: empieza donde dice la página y le avisa de cada cambio', async () => {
    const wrapper: Wrapper = await mount({ 'index': 1, 'onUpdate:index': (i: number) => wrapper.setProps({ index: i }) })
    expect(shown(wrapper)).toBe('Dos|1|true')
    await button(wrapper, 'Imagen siguiente').trigger('click')
    await nextTick()
    expect(shown(wrapper)).toBe('Tres|2|false')

    // La página también puede mover el pase.
    await wrapper.setProps({ index: 0 })
    expect(shown(wrapper)).toBe('Uno|0|false')
    expect(currentThumbs(wrapper)).toEqual(['Ver Uno (1)'])
  })

  it('si la lista se acorta, el índice queda en la última que existe', async () => {
    const wrapper = await mount({ index: 2 })
    expect(shown(wrapper)).toBe('Tres|2|true')
    await wrapper.setProps({ slides: slides.slice(0, 2) })
    expect(wrapper.emitted('update:index')).toEqual([[1]])
    await wrapper.setProps({ index: 1 })
    expect(shown(wrapper)).toBe('Dos|1|true')
    expect(thumbs(wrapper)).toHaveLength(2)
  })

  it('← y → con el foco en una miniatura cambian de diapositiva', async () => {
    const wrapper = await mount()
    const thumb = button(wrapper, 'Ver Uno (1)').element as HTMLButtonElement
    thumb.focus()
    expect(press(thumb, 'ArrowRight').defaultPrevented).toBe(true)
    await nextTick()
    expect(shown(wrapper)).toBe('Dos|1|false')
    press(thumb, 'ArrowLeft')
    press(thumb, 'ArrowLeft')
    await nextTick()
    expect(shown(wrapper)).toBe('Tres|2|false')
  })

  it('con el foco fuera del pase las flechas no lo mueven', async () => {
    const wrapper = await mount()
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    press(button(wrapper, 'Ver Uno (1)').element, 'ArrowRight')
    press(outside, 'ArrowRight')
    await nextTick()
    outside.remove()
    expect(shown(wrapper)).toBe('Uno|0|true')
  })

  it('deslizar el escenario cambia de diapositiva', async () => {
    const wrapper = await mount()
    const slide = () => wrapper.get('[aria-label="Diapositiva"]').element
    touch(slide(), 'touchstart', 220)
    touch(slide(), 'touchmove', 120)
    touch(slide(), 'touchend')
    await nextTick()
    expect(shown(wrapper)).toBe('Dos|1|false')

    touch(slide(), 'touchstart', 100)
    touch(slide(), 'touchmove', 200)
    touch(slide(), 'touchend')
    await nextTick()
    expect(shown(wrapper)).toBe('Uno|0|false')
  })
})

describe('Slideshow: posición en la query', () => {
  it('abre la diapositiva de ?i= y actualiza la query al cambiar', async () => {
    const wrapper = await mount({ query: 'i' }, { route: '/archivos?i=2' })
    expect(shown(wrapper)).toBe('Dos|1|true')
    expect(currentThumbs(wrapper)).toEqual(['Ver Dos (2)'])

    await button(wrapper, 'Imagen siguiente').trigger('click')
    await flush()
    expect(useRoute().query.i).toBe('3')
    expect(shown(wrapper)).toBe('Tres|2|false')
  })

  it('sin `query` la URL no cambia ni decide la posición', async () => {
    const wrapper = await mount({}, { route: '/archivos?i=3' })
    expect(shown(wrapper)).toBe('Uno|0|true')
    await button(wrapper, 'Imagen siguiente').trigger('click')
    await flush()
    expect(useRoute().query.i).toBe('3')
  })
})

describe('Slideshow: selección', () => {
  it('sin `selectable` no hay casillas', async () => {
    expect(boxes(await mount({ selected: ['a'] }))).toHaveLength(0)
  })

  it('por defecto todas se pueden elegir y la casilla se llama como su posición', async () => {
    const wrapper = await mount({ selectable: true })
    expect(boxes(wrapper).map(box => box.attributes('aria-label'))).toEqual(['1', '2', '3'])
    expect(checked(wrapper)).toEqual([])

    await boxes(wrapper)[1]!.trigger('change')
    await boxes(wrapper)[2]!.trigger('change')
    expect(checked(wrapper)).toEqual(['2', '3'])
    await boxes(wrapper)[1]!.trigger('change')
    expect(checked(wrapper)).toEqual(['3'])
    expect(wrapper.emitted('update:selected')).toEqual([[['b']], [['b', 'c']], [['c']]])
    // Elegir no cambia de diapositiva.
    expect(wrapper.emitted('update:index')).toBeUndefined()
  })

  it('canSelect quita la casilla de las que no se pueden elegir y selectLabel las nombra', async () => {
    const wrapper = await mount({
      selectable: true,
      canSelect: (slide: Slide) => slide.key !== 'b',
      selectLabel: (slide: Slide, index: number) => `Elegir ${slide.title} (${index + 1})`,
    })
    expect(boxes(wrapper).map(box => box.attributes('aria-label'))).toEqual(['Elegir Uno (1)', 'Elegir Tres (3)'])
    // Cada casilla tiene una etiqueta que la envuelve (zona táctil), dentro del elemento de su miniatura.
    for (const box of boxes(wrapper)) expect(box.element.closest('label')?.closest('li')?.querySelector('button')).not.toBeNull()
  })

  it('v-model:selected: marca las elegidas por la página y le avisa al cambiar', async () => {
    const wrapper: Wrapper = await mount({
      'selectable': true,
      'selected': ['a'],
      'selectLabel': (slide: Slide) => `Elegir ${slide.title}`,
      'onUpdate:selected': (keys: string[]) => wrapper.setProps({ selected: keys }),
    })
    expect(checked(wrapper)).toEqual(['Elegir Uno'])

    await wrapper.get('input[aria-label="Elegir Tres"]').trigger('change')
    await nextTick()
    expect(checked(wrapper)).toEqual(['Elegir Uno', 'Elegir Tres'])
    await wrapper.get('input[aria-label="Elegir Uno"]').trigger('change')
    await nextTick()
    expect(checked(wrapper)).toEqual(['Elegir Tres'])
    expect(wrapper.emitted('update:selected')).toEqual([[['a', 'c']], [['c']]])
  })

  it('las flechas siguen cambiando de diapositiva con el foco en una casilla', async () => {
    const wrapper = await mount({ selectable: true })
    const box = boxes(wrapper)[0]!.element as HTMLInputElement
    box.focus()
    press(box, 'ArrowRight')
    await nextTick()
    expect(shown(wrapper)).toBe('Dos|1|false')
  })
})

describe('Slideshow: fila de miniaturas', () => {
  /** happy-dom no calcula medidas: se fijan las de la fila (300 px) y sus miniaturas (112 px cada 120 px). */
  function measure(wrapper: Wrapper) {
    const row = wrapper.get('ul[aria-label="Miniaturas"]').element
    Object.defineProperty(row, 'clientWidth', { value: 300 })
    Array.from(row.children).forEach((item, i) => {
      Object.defineProperty(item, 'offsetLeft', { value: i * 120 })
      Object.defineProperty(item, 'offsetWidth', { value: 112 })
    })
    return row
  }

  it('al montar lleva la actual a la vista sin animación', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo')
    const wrapper = await mount({ index: 2 })
    const row = wrapper.get('ul[aria-label="Miniaturas"]').element
    const calls = scrollTo.mock.calls.filter((_, i) => scrollTo.mock.contexts[i] === row)
    expect(calls).toEqual([[{ left: 0, behavior: 'auto' }]])
  })

  it('al cambiar centra la miniatura actual con desplazamiento suave, sin pasar del principio', async () => {
    const wrapper = await mount()
    const row = measure(wrapper)
    const scrollTo = vi.spyOn(row, 'scrollTo')

    await button(wrapper, 'Imagen anterior').trigger('click')
    await flush(2)
    // Tercera miniatura: 240 − (300 − 112) / 2.
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 146, behavior: 'smooth' })

    await button(wrapper, 'Ver Uno (1)').trigger('click')
    await flush(2)
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' })
    expect(scrollTo).toHaveBeenCalledTimes(2)
  })

  it('con movimiento reducido no anima el desplazamiento', async () => {
    reduced.value = 'reduce'
    const wrapper = await mount()
    const scrollTo = vi.spyOn(measure(wrapper), 'scrollTo')
    await button(wrapper, 'Imagen siguiente').trigger('click')
    await flush(2)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ left: 26, behavior: 'auto' })
  })

  it('sin miniaturas no hay nada que desplazar', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo')
    const wrapper = await mount({ slides: [], index: 0 })
    await wrapper.setProps({ index: 1 })
    await flush(2)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('cada miniatura avisa a su ranura cuando se acerca al borde de la fila', async () => {
    const wrapper = await mount()
    await flush(2)
    const row = wrapper.get('ul[aria-label="Miniaturas"]').element
    expect(visibilityCalls).toHaveLength(3)
    for (const options of visibilityCalls) {
      expect(options.scrollTarget()).toBe(row)
      expect(options.rootMargin).toBe('0px 200px')
      expect(options.once).toBe(true)
    }
    expect(thumbs(wrapper).map(b => b.text())).toEqual(['Uno|0|false|true', 'Dos|1|false|false', 'Tres|2|false|false'])
    near.value = true
    await nextTick()
    expect(thumbs(wrapper).map(b => b.text())).toEqual(['Uno|0|true|true', 'Dos|1|true|false', 'Tres|2|true|false'])
  })
})

describe('SlideshowThumb', () => {
  it('pasa `near` a su ranura y observa dentro de la fila que recibe', async () => {
    const row = document.createElement('ul')
    const wrapper = await mountSuspended(SlideshowThumb, {
      props: { scrollRoot: null },
      slots: { default: (p: { near: boolean }) => (p.near ? 'cerca' : 'lejos') },
    })
    expect(wrapper.text()).toBe('lejos')
    expect(visibilityCalls).toHaveLength(1)
    expect(visibilityCalls[0]!.scrollTarget()).toBeNull()

    await wrapper.setProps({ scrollRoot: row })
    expect(visibilityCalls[0]!.scrollTarget()).toBe(row)
    near.value = true
    await nextTick()
    expect(wrapper.text()).toBe('cerca')
  })
})

describe('Slideshow: precarga de las vecinas', () => {
  const preload = (slide: Slide) => slide.url
  const sources = () => images.map(image => image.src)

  it('espera a que el navegador esté libre y precarga la siguiente y la anterior una sola vez', async () => {
    const idle = stubIdle()
    const wrapper = await mount({ preload })
    expect(idle.pending).toHaveLength(1)
    expect(idle.pending[0]!.options).toEqual({ timeout: 2000 })
    expect(images).toHaveLength(0)

    idle.runAll()
    expect(sources()).toEqual(['/img/b.png', '/img/c.png'])
    expect(images.every(image => image.decoding === 'async')).toBe(true)

    // En la segunda, las vecinas son la tercera (ya precargada) y la primera.
    await button(wrapper, 'Imagen siguiente').trigger('click')
    expect(idle.pending).toHaveLength(1)
    idle.runAll()
    expect(sources()).toEqual(['/img/b.png', '/img/c.png', '/img/a.png'])

    await button(wrapper, 'Imagen siguiente').trigger('click')
    idle.runAll()
    expect(images).toHaveLength(3)
  })

  it('con dos diapositivas, la vecina es la misma por ambos lados', async () => {
    const idle = stubIdle()
    await mount({ preload, slides: slides.slice(0, 2) })
    idle.runAll()
    expect(sources()).toEqual(['/img/b.png'])
  })

  it('no precarga las que no tienen imagen todavía, y lo reintenta cuando la lista cambia', async () => {
    const idle = stubIdle()
    const pending: Slide[] = [slides[0]!, { key: 'b', title: 'Dos', url: null }, slides[2]!]
    const wrapper = await mount({ preload, slides: pending })
    idle.runAll()
    expect(sources()).toEqual(['/img/c.png'])

    await wrapper.setProps({ slides })
    expect(idle.pending).toHaveLength(1)
    idle.runAll()
    expect(sources()).toEqual(['/img/c.png', '/img/b.png'])
  })

  it('sin `preload` o con una sola diapositiva no precarga nada', async () => {
    const idle = stubIdle()
    await mount()
    await mount({ preload, slides: slides.slice(0, 1) })
    await mount({ preload, slides: [] })
    expect(idle.pending).toHaveLength(3)
    idle.runAll()
    expect(images).toHaveLength(0)
  })

  it('sin requestIdleCallback usa un temporizador corto', async () => {
    expect('requestIdleCallback' in window).toBe(false)
    const timeout = stubPreloadTimeout()
    const wrapper = await mount({ preload })
    expect(timeout.pending).toHaveLength(1)
    expect(images).toHaveLength(0)
    timeout.runAll()
    expect(sources()).toEqual(['/img/b.png', '/img/c.png'])

    await button(wrapper, 'Imagen anterior').trigger('click')
    expect(timeout.pending).toHaveLength(1)
    timeout.runAll()
    expect(sources()).toEqual(['/img/b.png', '/img/c.png', '/img/a.png'])
  })
})
