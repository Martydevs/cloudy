// Los avisos con un modal abierto: los `<dialog>` van en la top layer y taparían la pila de avisos del layout, así que
// `AppToast` la teleporta dentro del diálogo que quedó encima (y la devuelve al cerrarse).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppToast from '~/components/app/AppToast.vue'
import { nextModalStack } from '~/composables/useOpenModal'

enableAutoUnmount(afterEach)

const REGION = '[data-toast-region]'
const dialogs: HTMLDialogElement[] = []

function addDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog')
  document.body.appendChild(dialog)
  dialogs.push(dialog)
  return dialog
}

/** Espera al `MutationObserver` y al re-render del teleport. */
const settled = (check: () => void) => vi.waitFor(check, { timeout: 2000 })

beforeEach(() => {
  useToast().toasts.value = []
})

afterEach(() => {
  for (const dialog of dialogs.splice(0)) dialog.remove()
})

describe('AppToast', () => {
  it('sin modal abierto vive en el layout, pegado bajo la barra superior, con su región viva', async () => {
    const wrapper = await mountSuspended(AppToast, { attachTo: document.body })
    useToast().success('Guardado')
    await settled(() => expect(wrapper.text()).toContain('Guardado'))
    const region = wrapper.get(REGION)
    expect(region.attributes()).toMatchObject({ 'role': 'status', 'aria-live': 'polite' })
    expect(region.classes()).toEqual(expect.arrayContaining(['sticky', 'top-20']))
    expect(document.querySelectorAll(REGION)).toHaveLength(1)
  })

  it('al abrir un modal la pila se muda dentro del diálogo (fija arriba y centrada) y vuelve al cerrarlo', async () => {
    const wrapper = await mountSuspended(AppToast, { attachTo: document.body })
    const dialog = addDialog()
    useToast().error('No se pudo guardar')
    dialog.showModal()
    await settled(() => expect(dialog.querySelector(REGION)).not.toBeNull())
    const region = dialog.querySelector<HTMLElement>(REGION)!
    expect(region.textContent).toContain('No se pudo guardar')
    expect(region.getAttribute('role')).toBe('status')
    expect([...region.classList]).toEqual(expect.arrayContaining(['fixed', 'top-4', 'inset-x-0']))
    // Una sola región: no queda una copia tapada en el layout.
    expect(document.querySelectorAll(REGION)).toHaveLength(1)

    // El botón del aviso sigue funcionando dentro del modal.
    dialog.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]')!.click()
    await settled(() => expect(dialog.querySelector('.alert')).toBeNull())

    useToast().info('Otro aviso')
    dialog.close()
    await settled(() => expect(wrapper.find(REGION).exists()).toBe(true))
    expect(dialog.querySelector(REGION)).toBeNull()
    expect(wrapper.get(REGION).classes()).toContain('sticky')
    expect(wrapper.text()).toContain('Otro aviso')
  })

  it('con diálogos apilados va al que quedó encima (el último en abrirse) y baja al anterior cuando ese se cierra', async () => {
    await mountSuspended(AppToast, { attachTo: document.body })
    const review = addDialog()
    const confirm = addDialog()
    review.showModal()
    await settled(() => expect(review.querySelector(REGION)).not.toBeNull())
    confirm.showModal()
    await settled(() => expect(confirm.querySelector(REGION)).not.toBeNull())
    expect(review.querySelector(REGION)).toBeNull()

    confirm.close()
    await settled(() => expect(review.querySelector(REGION)).not.toBeNull())
    expect(document.querySelectorAll(REGION)).toHaveLength(1)
  })

  it('un diálogo ya abierto al montar cuenta, y uno que sale del DOM sin cerrarse deja de ser el destino', async () => {
    const dialog = addDialog()
    dialog.showModal()
    const wrapper = await mountSuspended(AppToast, { attachTo: document.body })
    await settled(() => expect(dialog.querySelector(REGION)).not.toBeNull())
    // `v-if` desmonta el diálogo todavía abierto.
    dialog.remove()
    await settled(() => expect(wrapper.find(REGION).exists()).toBe(true))
    useToast().success('Sigue visible')
    await settled(() => expect(wrapper.text()).toContain('Sigue visible'))
  })
})

describe('nextModalStack', () => {
  const [a, b, c] = [1, 2, 3].map(() => document.createElement('dialog')) as [HTMLDialogElement, HTMLDialogElement, HTMLDialogElement]

  it('conserva el orden de apertura y añade los nuevos al final, aunque estén antes en el documento', () => {
    expect(nextModalStack([], [a])).toEqual([a])
    // `b` se abrió después que `c`, pero está antes en el DOM.
    expect(nextModalStack([c], [b, c])).toEqual([c, b])
    expect(nextModalStack([a, c, b], [a, b])).toEqual([a, b])
    expect(nextModalStack([a], [])).toEqual([])
  })
})
