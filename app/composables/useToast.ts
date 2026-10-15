// Avisos breves al completar acciones (Constitución VI). Se ocultan solos a los 4 s (8 s si llevan enlace).
export type ToastType = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  to: string
}

export interface Toast {
  id: number
  message: string
  type: ToastType
  action?: ToastAction
}

export interface ToastOptions {
  action?: ToastAction
  /** Milisegundos antes de ocultarse. */
  duration?: number
}

let nextId = 0

export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])

  function dismiss(id: number) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  function show(message: string, type: ToastType = 'success', { action, duration }: ToastOptions = {}) {
    const id = ++nextId
    toasts.value = [...toasts.value.slice(-3), { id, message, type, ...(action ? { action } : {}) }]
    if (import.meta.client) useTimeoutFn(() => dismiss(id), duration ?? (action ? 8000 : 4000))
    return id
  }

  return {
    toasts,
    show,
    dismiss,
    success: (message: string, options?: ToastOptions) => show(message, 'success', options),
    error: (message: string, options?: ToastOptions) => show(message, 'error', options),
    info: (message: string, options?: ToastOptions) => show(message, 'info', options),
  }
}
