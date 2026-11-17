// Lógica del pase de diapositivas (`useSlideshow`): vuelta al principio y al final, índice dentro de la lista cuando
// esta se acorta, posición inicial y sincronización con la query (`?i=`, 1-based), flechas ← → solo con el foco dentro
// y fuera de los controles que usan las flechas, y deslizar con el dedo sobre el escenario.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import type { Me } from '#shared/types/api'
import { useSlideshow } from '~/composables/useSlideshow'
import { flush } from './helpers/api'

enableAutoUnmount(afterEach)

interface HostOptions {
  count?: number
  index?: number
  query?: string | false
  /** Sin escenario no se escucha el deslizamiento. */
  stage?: boolean
  /** Ruta con la que se monta (`mountSuspended` navega a ella antes del setup). */
  route?: string
}

/** Monta un componente mínimo que usa `useSlideshow` con una raíz, un escenario y controles de formulario dentro. */
async function mountHost(options: HostOptions = {}) {
  const count = ref(options.count ?? 3)
  const index = ref(options.index ?? 0)
  const root = ref<HTMLElement | null>(null)
  const stage = ref<HTMLElement | null>(null)
  let api: ReturnType<typeof useSlideshow> | undefined

  const Host = defineComponent({
    setup() {
      api = useSlideshow({ count, index, root, stage: options.stage === false ? undefined : stage, query: options.query })
      return () => h('div', [
        h('section', { 'ref': root, 'aria-label': 'Pase' }, [
          h('div', { 'ref': stage, 'aria-label': 'Escenario' }),
          h('button', { 'type': 'button', 'aria-label': 'Dentro' }),
          h('input', { 'type': 'text', 'aria-label': 'Texto' }),
          h('input', { 'type': 'checkbox', 'aria-label': 'Casilla' }),
          h('textarea', { 'aria-label': 'Nota' }),
          h('select', { 'aria-label': 'Lista' }, [h('option', 'a'), h('option', 'b')]),
          h('div', { 'contenteditable': 'true', 'tabindex': '0', 'aria-label': 'Editable' }),
          h('svg', { 'aria-label': 'Dibujo' }),
        ]),
        h('button', { 'type': 'button', 'aria-label': 'Fuera' }),
      ])
    },
  })

  const wrapper = await mountSuspended(Host, { attachTo: document.body, route: options.route ?? '/archivos' })
  if (!api) throw new Error('useSlideshow no se ejecutó')
  const el = (label: string) => wrapper.get(`[aria-label="${label}"]`).element
  const focus = (label: string) => (el(label) as HTMLElement).focus()
  return { wrapper, api, count, index, root, el, focus }
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

/** Evento táctil mínimo: `useSwipe` solo lee `touches[0].clientX/Y`. */
function touch(target: Element, type: 'touchstart' | 'touchmove' | 'touchend', x = 0, y = 0) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
  target.dispatchEvent(event)
}

function swipe(target: Element, from: [number, number], to: [number, number]) {
  touch(target, 'touchstart', ...from)
  touch(target, 'touchmove', ...to)
  touch(target, 'touchend')
}

// Con sesión, el middleware de acceso deja pasar a /archivos sin redirigir (la query y el hash llegan intactos).
beforeEach(() => {
  const me: Me = {
    user: { id: 'u1', email: 'ana@iglesia.org', name: 'Ana' },
    profile: { userId: 'u1', email: 'ana@iglesia.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
  }
  useMe().me.value = me
  useMe().loaded.value = true
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSlideshow: navegación', () => {
  it('siguiente y anterior dan la vuelta al final y al principio', async () => {
    const { api, index } = await mountHost()
    expect(api.total.value).toBe(3)
    api.next()
    api.next()
    expect(index.value).toBe(2)
    api.next()
    expect(index.value).toBe(0)
    api.prev()
    expect(index.value).toBe(2)
  })

  it('go acepta cualquier entero y lo lleva dentro de la lista', async () => {
    const { api, index } = await mountHost()
    api.go(7)
    expect(index.value).toBe(1)
    api.go(-1)
    expect(index.value).toBe(2)
    api.go(-4)
    expect(index.value).toBe(2)
  })

  it('moved solo cambia cuando de verdad se cambia de diapositiva', async () => {
    const { api, index } = await mountHost({ index: 1 })
    expect(api.moved.value).toBe(false)
    api.go(1)
    api.go(4)
    expect(index.value).toBe(1)
    expect(api.moved.value).toBe(false)
    api.go(2)
    expect(api.moved.value).toBe(true)
  })

  it('sin diapositivas no hay a dónde ir; un conteo negativo cuenta como cero', async () => {
    const { api, index, count } = await mountHost({ count: 0 })
    api.next()
    api.prev()
    api.go(2)
    expect(index.value).toBe(0)
    expect(api.moved.value).toBe(false)
    count.value = -3
    await nextTick()
    expect(api.total.value).toBe(0)
  })

  it('con una sola diapositiva, siguiente y anterior no hacen nada', async () => {
    const { api, index } = await mountHost({ count: 1 })
    api.next()
    api.prev()
    expect(index.value).toBe(0)
    expect(api.moved.value).toBe(false)
  })
})

describe('useSlideshow: índice dentro de la lista', () => {
  it('un índice inicial fuera de la lista se corrige al montar', async () => {
    expect((await mountHost({ index: 9 })).index.value).toBe(2)
    expect((await mountHost({ index: -2 })).index.value).toBe(0)
  })

  it('si la lista se acorta, el índice queda en la última', async () => {
    const { index, count, api } = await mountHost({ count: 5, index: 4 })
    count.value = 2
    await nextTick()
    expect(index.value).toBe(1)
    // Acomodar el índice no cuenta como un cambio hecho por la persona.
    expect(api.moved.value).toBe(false)
    count.value = 4
    await nextTick()
    expect(index.value).toBe(1)
  })

  it('con la lista vacía el índice espera a que lleguen las diapositivas', async () => {
    const { index, count } = await mountHost({ count: 0, index: 3 })
    expect(index.value).toBe(3)
    count.value = 2
    await nextTick()
    expect(index.value).toBe(1)
  })
})

describe('useSlideshow: posición en la query', () => {
  it('la posición inicial sale de la query (1-based)', async () => {
    const { index, api } = await mountHost({ count: 5, query: 'i', route: '/archivos?i=3' })
    expect(index.value).toBe(2)
    expect(api.moved.value).toBe(false)
  })

  it('una posición más allá del final abre la última', async () => {
    expect((await mountHost({ count: 3, query: 'i', route: '/archivos?i=40' })).index.value).toBe(2)
  })

  it('una query que llega antes que la lista se conserva hasta que hay diapositivas', async () => {
    const { index, count } = await mountHost({ count: 0, query: 'i', route: '/archivos?i=4' })
    expect(index.value).toBe(3)
    count.value = 6
    await nextTick()
    expect(index.value).toBe(3)
  })

  it('ignora valores que no son una posición', async () => {
    for (const value of ['abc', '0', '-2', '2.5', '']) {
      const { index, wrapper } = await mountHost({ index: 1, query: 'i', route: `/archivos?i=${value}` })
      expect(index.value, value).toBe(1)
      wrapper.unmount()
    }
  })

  it('sin query configurada no lee ni escribe la URL', async () => {
    const replace = vi.spyOn(useRouter(), 'replace')
    const { index, api } = await mountHost({ route: '/archivos?i=3' })
    replace.mockClear()
    expect(index.value).toBe(0)
    api.next()
    await flush()
    expect(replace).not.toHaveBeenCalled()
    expect(useRoute().query.i).toBe('3')
  })

  it('cambiar de diapositiva reemplaza la query y conserva el resto de la URL', async () => {
    const replace = vi.spyOn(useRouter(), 'replace')
    const { api } = await mountHost({ query: 'i', route: '/archivos?orden=fecha#historial' })
    replace.mockClear()
    api.next()
    await flush()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith({ query: { orden: 'fecha', i: '2' }, hash: '#historial' })
    expect(useRoute().query).toEqual({ orden: 'fecha', i: '2' })
    expect(useRoute().hash).toBe('#historial')
  })

  it('no navega si la query ya dice esa posición ni con la lista vacía', async () => {
    const replace = vi.spyOn(useRouter(), 'replace')
    const { index, count } = await mountHost({ query: 'i', route: '/archivos?i=2' })
    expect(index.value).toBe(1)
    // Alguien más ya movió la URL (p. ej. atrás/adelante) y el modelo la sigue.
    await useRouter().replace({ query: { i: '1' } })
    replace.mockClear()
    index.value = 0
    await flush()
    expect(replace).not.toHaveBeenCalled()

    count.value = 0
    await nextTick()
    index.value = 2
    await flush()
    expect(replace).not.toHaveBeenCalled()
    expect(useRoute().query.i).toBe('1')
  })
})

describe('useSlideshow: teclado', () => {
  it('← y → cambian de diapositiva con el foco dentro', async () => {
    const { index, el, focus } = await mountHost()
    focus('Dentro')
    const right = press(el('Dentro'), 'ArrowRight')
    expect(index.value).toBe(1)
    expect(right.defaultPrevented).toBe(true)
    press(el('Dentro'), 'ArrowLeft')
    press(el('Dentro'), 'ArrowLeft')
    expect(index.value).toBe(2)
  })

  it('otras teclas no hacen nada', async () => {
    const { index, el, focus } = await mountHost()
    focus('Dentro')
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ']) expect(press(el('Dentro'), key).defaultPrevented, key).toBe(false)
    expect(index.value).toBe(0)
  })

  it('con el foco fuera del componente las flechas no cuentan', async () => {
    const { index, el, focus } = await mountHost()
    focus('Fuera')
    // La tecla llega a la raíz (p. ej. reenviada), pero el foco está en otra parte de la página.
    const inside = press(el('Dentro'), 'ArrowRight')
    press(el('Fuera'), 'ArrowRight')
    expect(index.value).toBe(0)
    expect(inside.defaultPrevented).toBe(false)
  })

  it('con un modificador se deja el atajo al navegador', async () => {
    const { index, el, focus } = await mountHost()
    focus('Dentro')
    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(press(el('Dentro'), 'ArrowRight', init).defaultPrevented, JSON.stringify(init)).toBe(false)
    }
    expect(index.value).toBe(0)
  })

  it('si otro ya atendió la tecla, no se cambia de diapositiva', async () => {
    const { index, el, focus } = await mountHost()
    focus('Dentro')
    el('Dentro').addEventListener('keydown', event => event.preventDefault())
    press(el('Dentro'), 'ArrowRight')
    expect(index.value).toBe(0)
  })

  it('los controles que usan las flechas se las quedan', async () => {
    const { index, el, focus } = await mountHost()
    for (const label of ['Texto', 'Nota', 'Lista', 'Editable']) {
      focus(label)
      expect(press(el(label), 'ArrowRight').defaultPrevented, label).toBe(false)
      expect(index.value, label).toBe(0)
    }
  })

  it('una casilla o un elemento que no es de formulario no bloquean las flechas', async () => {
    const { index, el, focus } = await mountHost()
    focus('Casilla')
    press(el('Casilla'), 'ArrowRight')
    expect(index.value).toBe(1)
    // El evento sale de un <svg> (no es un HTMLElement) con el foco en un botón de dentro.
    focus('Dentro')
    press(el('Dentro'), 'ArrowRight')
    press(el('Dibujo'), 'ArrowRight')
    expect(index.value).toBe(0)
  })

  it('si la raíz deja de existir, una tecla tardía no hace nada', async () => {
    const { index, root, el, focus } = await mountHost()
    focus('Dentro')
    const button = el('Dentro')
    // La escucha se retira en el siguiente ciclo; la tecla llega antes.
    root.value = null
    expect(press(button, 'ArrowRight').defaultPrevented).toBe(false)
    expect(index.value).toBe(0)
  })
})

describe('useSlideshow: deslizar', () => {
  it('deslizar a la izquierda avanza y a la derecha retrocede', async () => {
    const { index, el } = await mountHost()
    swipe(el('Escenario'), [200, 10], [120, 14])
    expect(index.value).toBe(1)
    swipe(el('Escenario'), [100, 10], [190, 6])
    swipe(el('Escenario'), [100, 10], [190, 6])
    expect(index.value).toBe(2)
  })

  it('un gesto corto o vertical no cambia de diapositiva', async () => {
    const { index, el, api } = await mountHost()
    swipe(el('Escenario'), [200, 10], [170, 10])
    swipe(el('Escenario'), [200, 10], [205, 160])
    swipe(el('Escenario'), [200, 160], [195, 10])
    expect(index.value).toBe(0)
    expect(api.moved.value).toBe(false)
  })

  it('sin escenario no se escucha el gesto', async () => {
    const { index, el } = await mountHost({ stage: false })
    swipe(el('Escenario'), [200, 10], [100, 10])
    expect(index.value).toBe(0)
  })
})
