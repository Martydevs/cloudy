// Aplica `definePageMeta({ access, roles })` (contracts/ui-routes.md). El servidor es la autoridad real.
export default defineNuxtRouteMiddleware(async (to) => {
  // Rutas inexistentes: se deja que `error.vue` muestre el 404.
  if (to.matched.length === 0) return

  const { me, loaded, refreshMe } = useMe()
  if (!loaded.value) await refreshMe()

  const decision = resolveAccess(to.meta, me.value, to.fullPath)
  if ('redirect' in decision && decision.redirect !== to.fullPath) {
    return navigateTo(decision.redirect)
  }
})
