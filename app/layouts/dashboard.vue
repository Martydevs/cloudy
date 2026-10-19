<script setup lang="ts">
import { breakpointsTailwind } from '@vueuse/core'

const router = useRouter()
const mobileOpen = ref(false)
// `initOnMounted` evita un desajuste de hidratación: el SSR no conoce el localStorage.
const collapsed = useLocalStorage('cloudy-sidebar-collapsed', false, { initOnMounted: true })
const isDesktop = useBreakpoints(breakpointsTailwind).greaterOrEqual('lg')

const { pendingCount, pendingUsers } = usePulse()
usePulsePolling()
const badges = computed(() => ({ '/pendientes': pendingCount.value, '/usuarios': pendingUsers.value }))

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
const phoneOpen = computed(() => mobileOpen.value && !isDesktop.value)
watch(phoneOpen, (locked) => {
  scrollLocked.value = locked
})

// Teclado en el cajón móvil (T162, defecto 5): al abrirse, el foco pasa al primer enlace del panel y la
// página de detrás queda `inert` (Tab no sale del cajón); al cerrarse, vuelve a quien lo abrió («Abrir menú»).
// `inert` se alterna a mano: como atributo booleano, Vue lo dejaría en "false" al desactivarlo.
const content = useTemplateRef<HTMLElement>('content')
const drawerSide = useTemplateRef<HTMLElement>('drawerSide')
let opener: HTMLElement | null = null
watch(phoneOpen, async (open) => {
  content.value?.toggleAttribute('inert', open)
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    drawerSide.value?.querySelector<HTMLElement>('nav a')?.focus()
  }
  else {
    opener?.focus()
    opener = null
  }
})
</script>

<template>
  <div class="drawer min-h-dvh bg-base-200 lg:drawer-open">
    <input id="app-drawer" v-model="mobileOpen" type="checkbox" class="drawer-toggle" tabindex="-1" aria-hidden="true">
    <div ref="content" class="drawer-content relative flex min-w-0 flex-col">
      <a
        href="#contenido"
        class="btn btn-primary absolute left-2 top-2 z-50 -translate-y-20 focus:translate-y-0"
      >Saltar al contenido</a>
      <AppTopbar @toggle-menu="mobileOpen = !mobileOpen" />
      <!-- Justo bajo la barra: los avisos se centran sobre esta columna, no sobre el viewport. -->
      <AppToast />
      <main id="contenido" tabindex="-1" class="mx-auto w-full max-w-7xl flex-1 p-4 outline-none lg:p-6">
        <slot />
      </main>
    </div>
    <div ref="drawerSide" class="drawer-side z-40 lg:sticky lg:top-0 lg:h-dvh lg:overflow-hidden">
      <!-- En escritorio el overlay (inline-block de 24 px de línea) empujaba el aside hacia abajo. -->
      <button type="button" class="drawer-overlay lg:hidden" aria-label="Cerrar menú" tabindex="-1" @click="mobileOpen = false" />
      <AppSidebar
        :collapsed="collapsed && isDesktop"
        :badges="badges"
        @navigate="mobileOpen = false"
        @toggle-collapse="collapsed = !collapsed"
      />
    </div>
    <LazyUploadDialog v-if="upload.isOpen.value" :folder-id="upload.folderId.value" @close="upload.close()" @uploaded="upload.notifyUploaded()" />
  </div>
</template>
