import type { Me } from '#shared/types/api'

/** Sesión y perfil del usuario actual, compartidos entre SSR y cliente. */
export function useMe() {
  const me = useState<Me | null>('me', () => null)
  const loaded = useState('me-loaded', () => false)
  // Se captura aquí: en SSR reenvía las cookies de la petición original.
  const fetcher = useRequestFetch()

  async function refreshMe(): Promise<Me | null> {
    try {
      me.value = await fetcher<Me>('/api/me')
    }
    catch {
      me.value = null
    }
    loaded.value = true
    return me.value
  }

  function clearMe() {
    me.value = null
    loaded.value = true
  }

  const profile = computed(() => me.value?.profile ?? null)
  const isActive = computed(() => isActiveProfile(profile.value))
  const isAdmin = computed(() => isActive.value && profile.value?.role === 'admin')
  const isEditor = computed(() => isActive.value && profile.value?.role === 'editor')

  return { me, loaded, profile, isActive, isAdmin, isEditor, refreshMe, clearMe }
}
