import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import ConfirmDialog from '~/components/ui/ConfirmDialog.vue'

const props = { title: '¿Eliminar archivo?', message: 'Irá a la papelera.', confirmLabel: 'Eliminar', danger: true }

describe('ConfirmDialog', () => {
  it('al abrirse pone el foco en "Cancelar"', async () => {
    const wrapper = await mountSuspended(ConfirmDialog, { props: { ...props, open: false }, attachTo: document.body })
    await wrapper.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(document.activeElement?.textContent?.trim()).toBe('Cancelar')
    expect(wrapper.get('h2').text()).toBe('¿Eliminar archivo?')
    wrapper.unmount()
  })

  it('Esc emite cancel', async () => {
    const wrapper = await mountSuspended(ConfirmDialog, { props: { ...props, open: true }, attachTo: document.body })
    await wrapper.get('dialog').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    wrapper.unmount()
  })

  it('el botón de confirmar emite confirm y usa el estilo de peligro', async () => {
    const wrapper = await mountSuspended(ConfirmDialog, { props: { ...props, open: true } })
    const confirm = wrapper.findAll('button').find(b => b.text() === 'Eliminar')!
    expect(confirm.classes()).toContain('btn-error')
    await confirm.trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })
})

describe('useConfirm', () => {
  it('resuelve true al confirmar y false al cancelar', async () => {
    const { confirm, accept, cancel, isRevealed } = useConfirm()

    const accepted = confirm({ title: 'Uno' })
    expect(isRevealed.value).toBe(true)
    accept()
    expect(await accepted).toBe(true)

    const canceled = confirm({ title: 'Dos' })
    cancel()
    expect(await canceled).toBe(false)
    expect(isRevealed.value).toBe(false)
  })
})
