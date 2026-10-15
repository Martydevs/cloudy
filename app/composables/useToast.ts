// Avisos breves al completar acciones (Constitución VI). Se ocultan solos a los 4 s.
export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

let nextId = 0

export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])

  function dismiss(id: number) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  function show(message: string, type: ToastType = 'success') {
    const id = ++nextId
    toasts.value = [...toasts.value.slice(-3), { id, message, type }]
    if (import.meta.client) useTimeoutFn(() => dismiss(id), 4000)
    return id
  }

  return {
    toasts,
    show,
    dismiss,
    success: (message: string) => show(message, 'success'),
    error: (message: string) => show(message, 'error'),
    info: (message: string) => show(message, 'info'),
  }
}
