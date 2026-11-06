// T056 — Tarjeta de una colección (feature 006, FR-020, FR-024): ícono, nombre, conteo y autor; abrir, generar y el menú
// alcanzables por teclado y visibles siempre en móvil; renombrar y eliminar solo para quien puede.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper } from '@vue/test-utils'
import type { SongCollection } from '#shared/types/api'
import SongCollectionCard from '~/components/songs/SongCollectionCard.vue'
import { flush } from './helpers/api'

const collection = (changes: Partial<SongCollection> = {}): SongCollection => ({
  id: 'c1', name: 'Domingo', author: { userId: 'u1', name: 'Ana', active: true }, itemCount: 2,
  createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z', ...changes,
})
const menuItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(el => new DOMWrapper(el))

describe('SongCollectionCard', () => {
  it('muestra nombre, conteo y autor; abrir y generar emiten', async () => {
    const wrapper = await mountSuspended(SongCollectionCard, { props: { collection: collection() } })
    expect(wrapper.text()).toContain('Domingo')
    expect(wrapper.text()).toContain('2 canciones')
    expect(wrapper.text()).toContain('Creada por Ana')
    await wrapper.get('button[aria-label="Abrir la colección Domingo, 2 canciones"]').trigger('click')
    await wrapper.get('button[aria-label="Generar las presentaciones de Domingo"]').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
    expect(wrapper.emitted('generate')).toHaveLength(1)
  })

  it('los botones son visibles en móvil y aparecen con hover y foco desde lg', async () => {
    const wrapper = await mountSuspended(SongCollectionCard, { props: { collection: collection() } })
    const actions = wrapper.get('button[aria-label^="Generar"]').element.parentElement!
    expect(actions.className).toContain('lg:opacity-0')
    expect(actions.className).toContain('lg:group-hover:opacity-100')
    expect(actions.className).toContain('lg:group-focus-within:opacity-100')
    expect(actions.className).not.toMatch(/(^|\s)opacity-0/)
  })

  it('una colección vacía no se puede generar; un autor inactivo se muestra como tal', async () => {
    const wrapper = await mountSuspended(SongCollectionCard, { props: { collection: collection({ itemCount: 0, author: { userId: 'u2', name: 'Luis', active: false } }) } })
    expect(wrapper.get('button[aria-label^="Generar"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Usuario que ya no está activo')
    expect(wrapper.text()).toContain('0 canciones')
  })

  it('renombrar y eliminar solo aparecen si puede gestionarla', async () => {
    const reader = await mountSuspended(SongCollectionCard, { props: { collection: collection() }, attachTo: document.body })
    await reader.get('button[aria-label="Opciones de Domingo"]').trigger('click')
    await flush()
    expect(menuItems().map(i => i.text())).toEqual(['Ver canciones'])
    await menuItems()[0]!.trigger('click')
    expect(reader.emitted('open')).toHaveLength(1)
    reader.unmount()

    const owner = await mountSuspended(SongCollectionCard, { props: { collection: collection(), canManage: true }, attachTo: document.body })
    await owner.get('button[aria-label="Opciones de Domingo"]').trigger('click')
    await flush()
    expect(menuItems().map(i => i.text())).toEqual(['Ver canciones', 'Renombrar', 'Eliminar colección'])
    await menuItems()[1]!.trigger('click')
    expect(owner.emitted('rename')).toHaveLength(1)
    await owner.get('button[aria-label="Opciones de Domingo"]').trigger('click')
    await flush()
    await menuItems()[2]!.trigger('click')
    expect(owner.emitted('remove')).toHaveLength(1)
    owner.unmount()
  })
})
