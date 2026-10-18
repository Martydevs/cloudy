// T153 — Enlace para invitados: si copiarlo falla, se avisa con un error y con el enlace para
// copiarlo a mano. `useClipboard` y `useShare` se simulan para forzar cada camino sin depender
// del navegador de pruebas (`mockNuxtImport` aplica a todo el archivo).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

const { clipboard, sharing } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    clipboard: { copy: vi.fn(), isSupported: ref(true) },
    sharing: { share: vi.fn(), isSupported: ref(false) },
  }
})
mockNuxtImport('useClipboard', () => () => clipboard)
mockNuxtImport('useShare', () => () => sharing)

beforeEach(() => {
  clipboard.copy.mockReset()
  sharing.share.mockReset()
  useToast().toasts.value = []
})

describe('useGuestLink', () => {
  it('si copiar falla, avisa con un error que incluye el enlace para copiarlo a mano', async () => {
    clipboard.copy.mockRejectedValueOnce(new DOMException('Permiso denegado', 'NotAllowedError'))
    const { link, copyGuestLink } = useGuestLink()
    await copyGuestLink()
    expect(clipboard.copy).toHaveBeenCalledWith(link.value)
    const toast = useToast().toasts.value.at(-1)
    expect(toast).toMatchObject({ type: 'error' })
    expect(toast?.message).toContain(link.value)
  })
})
