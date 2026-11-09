<script setup lang="ts">
import { breakpointsTailwind } from '@vueuse/core'

const router = useRouter()
const mobileOpen = ref(false)
// `initOnMounted` evita un desajuste de hidratación: el SSR no conoce el localStorage.
const collapsed = useLocalStorage('cloudy-sidebar-collapsed', false, { initOnMounted: true })
const isDesktop = useBreakpoints(breakpointsTailwind).greaterOrEqual('lg')
// Ancho del menú lateral en escritorio (`w-64`/`w-20` de AppSidebar), publicado como `--app-sidebar-w` para centrar lo
// que flota abajo sobre la columna de contenido (barra de selección de YouTube).
const sidebarWidth = computed(() => (collapsed.value && isDesktop.value ? '5rem' : '16rem'))

const { pendingCount, pendingUsers } = usePulse()
usePulsePolling()
const badges = computed(() => ({ '/solicitudes': pendingCount.value, '/usuarios': pendingUsers.value }))

const upload = useUploadDialog()
// Bandeja de descargas de YouTube (feature 005): se monta, diferida, solo cuando hay trabajos.
const youtubeDownloads = useYoutubeDownloads()
const youtubeDrive = useYoutubeDriveImport()
const presentations = useSongPresentations()
// Relleno inferior del alto real de las bandejas abiertas para que no tapen el último contenido (la de Canciones se apoya
// encima de la de YouTube: su relleno suma las dos).
const trayPadding = computed(() => {
  if (presentations.hasItems.value) return 'pb-[calc(var(--youtube-tray-h,0px)+var(--song-tray-h,12rem)+1.5rem)] lg:pb-[calc(var(--youtube-tray-h,0px)+var(--song-tray-h,12rem)+1.5rem)]'
  if (youtubeDownloads.active.value || youtubeDrive.hasImports.value) return 'pb-[calc(var(--youtube-tray-h,18rem)+1.5rem)] lg:pb-[calc(var(--youtube-tray-h,18rem)+1.5rem)]'
  return ''
})

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

/**
 * daisyUI anima `visibility` al abrir el cajón y enfocar un elemento oculto no hace nada; además el
 * enlace puede seguir oculto unos cuadros después de que el panel ya se vea (con `prefers-reduced-motion`
 * incluido). Se intenta cuadro a cuadro hasta que el foco realmente queda en el enlace o vence el plazo.
 */
function focusFirstLinkWhenVisible(deadline = performance.now() + 600) {
  const link = drawerSide.value?.querySelector<HTMLElement>('nav a')
  if (!link || !phoneOpen.value) return
  link.focus()
  if (document.activeElement !== link && performance.now() < deadline) requestAnimationFrame(() => focusFirstLinkWhenVisible(deadline))
}

watch(phoneOpen, async (open) => {
  content.value?.toggleAttribute('inert', open)
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    focusFirstLinkWhenVisible()
  }
  else {
    opener?.focus()
    opener = null
  }
})
</script>

<template>
  <div class="drawer min-h-dvh bg-base-200 lg:drawer-open" :style="{ '--app-sidebar-w': sidebarWidth }">
    <input id="app-drawer" v-model="mobileOpen" type="checkbox" class="drawer-toggle" tabindex="-1" aria-hidden="true">
    <div ref="content" class="drawer-content relative flex min-w-0 flex-col">
      <a
        href="#contenido"
        class="btn btn-primary absolute left-2 top-2 z-50 -translate-y-20 focus:translate-y-0"
      >Saltar al contenido</a>
      <AppTopbar @toggle-menu="mobileOpen = !mobileOpen" />
      <!-- Justo bajo la barra: los avisos se centran sobre esta columna, no sobre el viewport. -->
      <AppToast />
      <!-- Con la bandeja abierta, relleno inferior del alto real de la bandeja (`--youtube-tray-h`) para que no tape el último contenido. -->
      <main
        id="contenido"
        tabindex="-1"
        class="mx-auto w-full max-w-7xl flex-1 p-4 outline-none lg:p-6"
        :class="trayPadding"
      >
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
    <LazyYoutubeDownloadTray v-if="youtubeDownloads.active.value || youtubeDrive.hasImports.value" />
    <LazySongPresentationTray v-if="presentations.hasItems.value" />
  </div>
</template>
