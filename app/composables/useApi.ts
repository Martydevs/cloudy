import type { UseFetchOptions } from '#app'

/** `$fetch` para `/api/**` con el manejo de 401/403 de `plugins/api-errors.ts`. */
export function useApi(): typeof $fetch {
  return useNuxtApp().$api
}

/** `useFetch` que usa `useApi()` (patrón "custom useFetch" de la documentación de Nuxt). */
export function useApiFetch<T>(url: string | Ref<string> | (() => string), options: UseFetchOptions<T> = {}) {
  return useFetch(url, { ...options, $fetch: useApi() })
}
