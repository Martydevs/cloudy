// Cliente para `/api/**` que reacciona a sesiones caducadas y permisos (US6):
// 401 → login conservando la ruta · 403 por estado de cuenta → /pendiente · otro 403 → /acceso-denegado.
import { FetchError } from 'ofetch'

const ACCOUNT_REASONS = new Set(['pending', 'disabled', 'removed'])

export default defineNuxtPlugin((nuxtApp) => {
  // En SSR reenvía las cookies de la petición original.
  const requestFetch = useRequestFetch()

  async function handle(error: unknown) {
    if (!(error instanceof FetchError)) return
    const status = error.response?.status
    const reason = (error.data as { data?: { reason?: string } } | undefined)?.data?.reason

    await nuxtApp.runWithContext(async () => {
      const route = useRoute()
      const { clearMe, refreshMe } = useMe()
      if (status === 401) {
        clearMe()
        await navigateTo(`/login?redirect=${encodeURIComponent(route.fullPath)}`)
      }
      else if (status === 403 && reason && ACCOUNT_REASONS.has(reason)) {
        await refreshMe()
        await navigateTo('/pendiente')
      }
      else if (status === 403) {
        await navigateTo('/acceso-denegado')
      }
    })
  }

  const api = (async (request: string, options?: Record<string, unknown>) => {
    try {
      return await requestFetch(request, options)
    }
    catch (error) {
      await handle(error)
      throw error
    }
  }) as unknown as typeof $fetch // Mismo contrato que `$fetch` para usarlo en `useFetch({ $fetch })`.

  return { provide: { api } }
})
