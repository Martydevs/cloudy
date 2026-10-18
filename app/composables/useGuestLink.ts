// Enlace público para invitados (`/enviar`): compartir si el navegador lo permite, si no copiar.
export function useGuestLink() {
  const toast = useToast()
  const siteUrl = useRuntimeConfig().public.siteUrl
  const { copy, isSupported: canCopy } = useClipboard()
  const { share, isSupported: canShare } = useShare()

  const link = computed(() => `${siteUrl || (import.meta.client ? window.location.origin : '')}/enviar`)

  async function copyGuestLink() {
    if (canShare.value) {
      try {
        await share({ title: 'Cloudy · Enviar archivos', url: link.value })
        return
      }
      catch {
        // La persona cerró el panel de compartir: se copia como alternativa.
      }
    }
    if (canCopy.value) {
      try {
        await copy(link.value)
        toast.success(messages.guest.linkCopied)
      }
      catch {
        // VueUse ya cae a `execCommand('copy')` si el portapapeles falla; esto cubre un rechazo de todos modos.
        toast.error(messages.guest.copyFailed(link.value))
      }
    }
    else {
      toast.info(messages.guest.shareLink(link.value))
    }
  }

  return { link, copyGuestLink }
}
