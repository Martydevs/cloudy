// Confirmaciones de acciones destructivas como `Promise<boolean>` (Constitución VI).
// Un único `ConfirmDialog` montado en app.vue muestra la petición en curso.
export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
}

const useSharedConfirmDialog = createSharedComposable(() => useConfirmDialog<ConfirmOptions, true, false>())

export function useConfirm() {
  const options = useState<ConfirmOptions | null>('confirm-options', () => null)
  const dialog = useSharedConfirmDialog()

  async function confirm(request: ConfirmOptions): Promise<boolean> {
    options.value = request
    const { isCanceled } = await dialog.reveal(request)
    options.value = null
    return !isCanceled
  }

  return {
    options,
    isRevealed: dialog.isRevealed,
    confirm,
    accept: () => dialog.confirm(true),
    cancel: () => dialog.cancel(false),
  }
}
