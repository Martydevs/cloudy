// Barras de la selección múltiple de Archivos y Usuarios: la base común (`ui/SelectionBar`: conteo anunciado, acciones y
// «Limpiar») y lo que agrega cada una (`FilesSelectionBar`: enviar a la papelera; `UsersSelectionBar`: desactivar,
// cambiar rol con un menú y eliminar). Las confirmaciones y los avisos viven en los composables y se prueban con las páginas.
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { h, nextTick } from 'vue'
import FilesSelectionBar from '~/components/files/FilesSelectionBar.vue'
import SelectionBar from '~/components/ui/SelectionBar.vue'
import UsersSelectionBar from '~/components/users/UsersSelectionBar.vue'
import type { Queryable } from './helpers/api'
import { buttonsWithText, flush } from './helpers/api'

const button = (wrapper: Queryable, text: string) => buttonsWithText(wrapper, text)[0]!
const isDisabled = (wrapper: Queryable, text: string) => button(wrapper, text).attributes('disabled') !== undefined

describe('SelectionBar (base de las barras de selección)', () => {
  it('anuncia el conteo en singular y plural dentro de una región con nombre', async () => {
    const wrapper = await mountSuspended(SelectionBar, { props: { count: 1 } })
    expect(wrapper.get('[role="region"]').attributes('aria-label')).toBe('Selección')
    expect(wrapper.get('[role="status"]').text()).toBe('1 seleccionado')
    await wrapper.setProps({ count: 3 })
    expect(wrapper.get('[role="status"]').text()).toBe('3 seleccionados')
  })

  it('muestra las acciones de quien la usa y, al final, «Limpiar», que emite clear', async () => {
    const wrapper = await mountSuspended(SelectionBar, {
      props: { count: 2 },
      slots: { default: () => h('button', { type: 'button', class: 'btn' }, 'Acción') },
    })
    expect(wrapper.findAll('button').map(b => b.text().trim())).toEqual(['Acción', 'Limpiar'])
    await button(wrapper, 'Limpiar').trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('es fija, se apoya encima de la bandeja de YouTube y sus botones conservan el tamaño táctil', async () => {
    const wrapper = await mountSuspended(SelectionBar, { props: { count: 2 } })
    const classes = wrapper.get('[role="region"]').classes().join(' ')
    expect(classes).toContain('fixed')
    expect(classes).toContain('inset-x-0')
    expect(classes).toMatch(/bottom-\[[^\]]*--youtube-tray-h/)
    // Nunca `btn-sm`/`btn-xs` como tamaño base (objetivos táctiles de 44 px).
    for (const control of wrapper.findAll('button')) expect(control.classes().join(' ')).not.toMatch(/\bbtn-(sm|xs)\b/)
  })
})

describe('FilesSelectionBar', () => {
  it('muestra el conteo y emite trash y clear', async () => {
    const wrapper = await mountSuspended(FilesSelectionBar, { props: { count: 3 } })
    expect(wrapper.get('[role="status"]').text()).toBe('3 seleccionados')
    expect(isDisabled(wrapper, 'Enviar a la papelera')).toBe(false)
    expect(button(wrapper, 'Enviar a la papelera').find('.loading').exists()).toBe(false)
    await button(wrapper, 'Enviar a la papelera').trigger('click')
    await button(wrapper, 'Limpiar').trigger('click')
    expect(wrapper.emitted('trash')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('con el envío en curso deshabilita «Enviar a la papelera» y muestra el indicador; «Limpiar» sigue disponible', async () => {
    const wrapper = await mountSuspended(FilesSelectionBar, { props: { count: 2, busy: true } })
    expect(isDisabled(wrapper, 'Enviar a la papelera')).toBe(true)
    expect(button(wrapper, 'Enviar a la papelera').find('.loading').exists()).toBe(true)
    expect(isDisabled(wrapper, 'Limpiar')).toBe(false)
    await wrapper.setProps({ busy: false })
    expect(isDisabled(wrapper, 'Enviar a la papelera')).toBe(false)
    expect(button(wrapper, 'Enviar a la papelera').find('.loading').exists()).toBe(false)
  })
})

describe('UsersSelectionBar', () => {
  const menu = (wrapper: Queryable) => wrapper.findAll('[role="menu"]')[0]
  const options = (wrapper: Queryable) => wrapper.findAll('[role="menuitem"]')

  it('muestra el conteo y emite disable, remove y clear', async () => {
    const wrapper = await mountSuspended(UsersSelectionBar, { props: { count: 2 } })
    expect(wrapper.get('[role="status"]').text()).toBe('2 seleccionados')
    await button(wrapper, 'Desactivar').trigger('click')
    await button(wrapper, 'Eliminar').trigger('click')
    await button(wrapper, 'Limpiar').trigger('click')
    expect(wrapper.emitted('disable')).toHaveLength(1)
    expect(wrapper.emitted('remove')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toHaveLength(1)
    // Nada de esto elige un rol.
    expect(wrapper.emitted('role')).toBeUndefined()
  })

  it('«Cambiar rol» abre hacia arriba un menú con los roles, enfoca el primero, emite el elegido y se cierra', async () => {
    const wrapper = await mountSuspended(UsersSelectionBar, { props: { count: 2 }, attachTo: document.body })
    const trigger = button(wrapper, 'Cambiar rol')
    expect(trigger.attributes('aria-haspopup')).toBe('menu')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-controls')).toBeUndefined()
    expect(menu(wrapper)).toBeUndefined()
    // La barra está fija abajo: el menú se despliega hacia arriba.
    expect(wrapper.get('.dropdown').classes()).toContain('dropdown-top')

    await trigger.trigger('click')
    await flush()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.dropdown').classes()).toContain('dropdown-open')
    expect(menu(wrapper)!.attributes('aria-label')).toBe('Rol para las cuentas seleccionadas')
    expect(trigger.attributes('aria-controls')).toBe(menu(wrapper)!.attributes('id'))
    expect(options(wrapper).map(option => option.text())).toEqual(['Editor', 'Administrador'])
    // Objetivos de 44 px y el foco dentro del menú, para seguir con el teclado.
    for (const option of options(wrapper)) expect(option.classes()).toContain('min-h-11')
    expect(document.activeElement).toBe(options(wrapper)[0]!.element)

    await options(wrapper)[1]!.trigger('click')
    expect(wrapper.emitted('role')).toEqual([['admin']])
    expect(menu(wrapper)).toBeUndefined()
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('click')
    await flush()
    await options(wrapper)[0]!.trigger('click')
    expect(wrapper.emitted('role')).toEqual([['admin'], ['editor']])
    wrapper.unmount()
  })

  it('Esc, un clic fuera o volver a pulsar el botón cierran el menú sin elegir nada', async () => {
    const wrapper = await mountSuspended(UsersSelectionBar, { props: { count: 1 }, attachTo: document.body })
    const trigger = button(wrapper, 'Cambiar rol')

    await trigger.trigger('click')
    await flush()
    expect(menu(wrapper)).toBeDefined()
    await wrapper.get('.dropdown').trigger('keydown', { key: 'Escape' })
    expect(menu(wrapper)).toBeUndefined()

    await trigger.trigger('click')
    await flush()
    expect(menu(wrapper)).toBeDefined()
    // `onClickOutside` ignora un clic en el mismo tick que el del disparador (ya pasó con `flush`).
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(menu(wrapper)).toBeUndefined()

    await trigger.trigger('click')
    await flush()
    expect(menu(wrapper)).toBeDefined()
    await trigger.trigger('click')
    await flush()
    expect(menu(wrapper)).toBeUndefined()

    expect(wrapper.emitted('role')).toBeUndefined()
    wrapper.unmount()
  })

  it('con un cambio en curso deshabilita las tres acciones y muestra el indicador en «Eliminar»; «Limpiar» sigue disponible', async () => {
    const wrapper = await mountSuspended(UsersSelectionBar, { props: { count: 2, busy: true } })
    expect(['Desactivar', 'Cambiar rol', 'Eliminar'].map(text => isDisabled(wrapper, text))).toEqual([true, true, true])
    expect(button(wrapper, 'Eliminar').find('.loading').exists()).toBe(true)
    expect(isDisabled(wrapper, 'Limpiar')).toBe(false)

    await wrapper.setProps({ busy: false })
    expect(['Desactivar', 'Cambiar rol', 'Eliminar'].map(text => isDisabled(wrapper, text))).toEqual([false, false, false])
    expect(button(wrapper, 'Eliminar').find('.loading').exists()).toBe(false)
  })
})
