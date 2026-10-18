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
  clipboard.isSupported.value = true
  sharing.share.mockReset()
  sharing.isSupported.value = false
  useToast().toasts.value = []
})

describe('useGuestLink', () => {
  it('si el navegador puede compartir, abre el panel nativo y no copia nada', async () => {
    sharing.isSupported.value = true
    sharing.share.mockResolvedValueOnce(undefined)
    const { link, copyGuestLink } = useGuestLink()
    await copyGuestLink()
    expect(sharing.share).toHaveBeenCalledWith({ title: 'Cloudy · Enviar archivos', url: link.value })
    expect(clipboard.copy).not.toHaveBeenCalled()
    // El panel de compartir ya es la confirmación: sin aviso.
    expect(useToast().toasts.value).toHaveLength(0)
  })

  it('si la persona cierra el panel de compartir, se copia como alternativa', async () => {
    sharing.isSupported.value = true
    sharing.share.mockRejectedValueOnce(new DOMException('Cerrado', 'AbortError'))
    clipboard.copy.mockResolvedValueOnce(undefined)
    const { link, copyGuestLink } = useGuestLink()
    await copyGuestLink()
    expect(clipboard.copy).toHaveBeenCalledWith(link.value)
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'success', message: 'Enlace para invitados copiado' })
  })

  it('sin compartir ni portapapeles, muestra el enlace para copiarlo a mano', async () => {
    clipboard.isSupported.value = false
    const { link, copyGuestLink } = useGuestLink()
    await copyGuestLink()
    expect(clipboard.copy).not.toHaveBeenCalled()
    const toast = useToast().toasts.value.at(-1)
    expect(toast).toMatchObject({ type: 'info' })
    expect(toast?.message).toContain(link.value)
  })

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
