<script setup lang="ts">
import { breakpointsTailwind } from '@vueuse/core'

const router = useRouter()
const mobileOpen = ref(false)
// `initOnMounted` evita un desajuste de hidratación: el SSR no conoce el localStorage.
const collapsed = useLocalStorage('cloudy-sidebar-collapsed', false, { initOnMounted: true })
const isDesktop = useBreakpoints(breakpointsTailwind).greaterOrEqual('lg')

const { pendingCount } = usePulse()
usePulsePolling()

const upload = useUploadDialog()

// El panel móvil se cierra al navegar, con Esc y al pasar a escritorio (edge case).
// `afterEach` y no `useRoute()`: la ruta se actualiza recién cuando la página nueva terminó de
// cargar, y para entonces la persona pudo haber vuelto a abrir el menú.
onScopeDispose(router.afterEach(() => {
  mobileOpen.value = false
}))
watch(isDesktop, (desktop) => {
  if (desktop) mobileOpen.value = false
})
onKeyStroke('Escape', () => {
  mobileOpen.value = false
})

const scrollLocked = useScrollLock(import.meta.client ? document.body : null)
watch(() => mobileOpen.value && !isDesktop.value, (locked) => {
  scrollLocked.value = locked
})
</script>

<template>
  <div class="drawer min-h-dvh bg-base-200 lg:drawer-open">
    <input id="app-drawer" v-model="mobileOpen" type="checkbox" class="drawer-toggle" tabindex="-1" aria-hidden="true">
    <div class="drawer-content relative flex min-w-0 flex-col">
      <a
        href="#contenido"
        class="btn btn-primary absolute left-2 top-2 z-50 -translate-y-20 focus:translate-y-0"
      >Saltar al contenido</a>
      <AppTopbar @toggle-menu="mobileOpen = !mobileOpen" @upload="upload.open()" />
      <main id="contenido" tabindex="-1" class="mx-auto w-full max-w-7xl flex-1 p-4 outline-none lg:p-6">
        <slot />
      </main>
    </div>
    <div class="drawer-side z-40">
      <button type="button" class="drawer-overlay" aria-label="Cerrar menú" tabindex="-1" @click="mobileOpen = false" />
      <AppSidebar
        :collapsed="collapsed && isDesktop"
        :pending-count="pendingCount"
        @navigate="mobileOpen = false"
        @toggle-collapse="collapsed = !collapsed"
      />
    </div>
    <LazyUploadDialog v-if="upload.isOpen.value" :folder-id="upload.folderId.value" @close="upload.close()" @uploaded="upload.notifyUploaded()" />
  </div>
</template>
