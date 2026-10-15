<script setup lang="ts">
// `badges`: contador por ruta (`item.to`), p. ej. envíos pendientes en /pendientes y cuentas por aprobar en /usuarios.
const props = defineProps<{ collapsed: boolean, badges?: Partial<Record<string, number>> }>()
const emit = defineEmits<{ navigate: [], toggleCollapse: [] }>()

const route = useRoute()
const router = useRouter()
const { profile } = useMe()

// Por rol y solo secciones con página: las historias pendientes no dejan enlaces rotos.
const items = computed(() => {
  const role = profile.value?.role
  if (!role) return []
  return navItems.filter(item => item.roles.includes(role) && router.resolve(item.to).matched.length > 0)
})

// El globo de daisyUI vive dentro del nav y ensancha su scroll. Este aviso se pinta en `body`.
const tip = shallowRef<{ label: string, top: number, left: number } | null>(null)

function showTip(event: Event, label: string) {
  if (!props.collapsed) return
  const row = event.currentTarget
  if (!(row instanceof HTMLElement)) return
  const el = row.querySelector('a') ?? row
  const rect = el.getBoundingClientRect()
  const rail = el.closest('aside')?.getBoundingClientRect()
  tip.value = { label, top: rect.top + rect.height / 2, left: (rail?.right ?? rect.right) + 8 }
}

function hideTip(event?: Event) {
  if (event?.type === 'focusout' && event instanceof FocusEvent) {
    const next = event.relatedTarget
    const current = event.currentTarget
    if (current instanceof HTMLElement && next instanceof Node && current.contains(next)) return
  }
  tip.value = null
}

watch(() => props.collapsed, (collapsed) => {
  if (!collapsed) tip.value = null
})

// Cuenta al pie: una fila (o solo el avatar, contraída) que abre un menú hacia arriba con
// Mi perfil, tema y Cerrar sesión. El aside recorta su contenido (`overflow-hidden`), así que el
// menú se pinta en `body` con posición fija, igual que el aviso.
const { logout } = useAuthClient()
const initials = computed(() => (profile.value?.name ?? '?').trim().slice(0, 1).toUpperCase())

const accountTrigger = useTemplateRef<HTMLButtonElement>('accountTrigger')
const accountMenuEl = useTemplateRef<HTMLElement>('accountMenuEl')
const accountMenu = shallowRef<{ bottom: number, left: number, width?: number } | null>(null)

function openAccountMenu() {
  const el = accountTrigger.value
  if (!el) return
  hideTip()
  const rect = el.getBoundingClientRect()
  if (props.collapsed) {
    // A la derecha del riel, alineado con la base del avatar.
    const rail = el.closest('aside')?.getBoundingClientRect()
    accountMenu.value = { bottom: window.innerHeight - rect.bottom, left: (rail?.right ?? rect.right) + 8 }
  }
  else {
    // Encima de la fila, con su mismo ancho.
    accountMenu.value = { bottom: window.innerHeight - rect.top + 8, left: rect.left, width: rect.width }
  }
}

function closeAccountMenu() {
  accountMenu.value = null
}

function toggleAccountMenu() {
  if (accountMenu.value) closeAccountMenu()
  else openAccountMenu()
}

onClickOutside(accountMenuEl, closeAccountMenu, { ignore: [accountTrigger] })
onKeyStroke('Escape', () => {
  if (!accountMenu.value) return
  closeAccountMenu()
  accountTrigger.value?.focus()
})
onScopeDispose(router.afterEach(closeAccountMenu))
watch(() => props.collapsed, closeAccountMenu)
// La posición se calcula al abrir: si cambia la ventana o algo se desplaza, se cierra.
useEventListener('resize', closeAccountMenu, { passive: true })
useEventListener('scroll', closeAccountMenu, { passive: true, capture: true })
</script>

<template>
  <!-- Alto fijo al viewport y sin scroll propio: solo el `nav` se desplaza si la lista crece. -->
  <aside
    class="flex h-full min-h-dvh flex-col gap-2 overflow-hidden border-r border-base-300 bg-base-100 py-3 transition-[width]"
    :class="props.collapsed ? 'w-20 px-2' : 'w-64 px-3'"
  >
    <div class="flex h-12 shrink-0 items-center" :class="props.collapsed ? 'justify-center' : 'justify-between px-3'">
      <!-- Contraída, el logo es el botón de expandir. Dos capas centradas en el mismo `size-11`
           que los ítems del menú; al pasar el cursor o con foco de teclado solo se ve expandir. -->
      <button
        v-if="props.collapsed"
        type="button"
        class="group relative btn btn-ghost btn-square size-11 cursor-ew-resize p-0!"
        aria-label="Expandir barra lateral"
        :aria-expanded="false"
        @click="emit('toggleCollapse')"
      >
        <span class="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
          <Icon name="lucide:cloud" class="size-6! text-primary" aria-hidden="true" />
        </span>
        <span class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Icon name="lucide:panel-left-open" class="size-6!" aria-hidden="true" />
        </span>
        <span class="sr-only">Cloudy</span>
      </button>
      <template v-else>
        <AppLogo />
        <!-- Solo escritorio: contraer aplica desde lg; en el cajón móvil la barra siempre va expandida. -->
        <button
          type="button"
          class="btn btn-ghost btn-square hidden cursor-ew-resize lg:inline-flex"
          aria-label="Contraer barra lateral"
          :aria-expanded="true"
          @click="emit('toggleCollapse')"
        >
          <Icon name="lucide:panel-left-close" class="size-5!" aria-hidden="true" />
        </button>
      </template>
    </div>

    <nav aria-label="Secciones" class="min-h-0 flex-1 overflow-x-clip overflow-y-auto" @scroll="hideTip()">
      <ul class="menu w-full gap-1 p-0" :class="{ 'items-center': props.collapsed }">
        <li
          v-for="item in items"
          :key="item.to"
          @mouseenter="showTip($event, item.label)"
          @mouseleave="hideTip()"
          @focusin="showTip($event, item.label)"
          @focusout="hideTip"
        >
          <NuxtLink
            :to="item.to"
            :class="[
              props.collapsed
                ? 'size-11 place-content-center! p-0!'
                : '!flex min-h-11 items-center gap-3 px-3',
              { 'menu-active': isNavActive(item, route.path) },
            ]"
            :aria-current="isNavActive(item, route.path) ? 'page' : undefined"
            :aria-label="props.collapsed ? item.label : undefined"
            @click="emit('navigate')"
          >
            <span class="relative flex shrink-0 items-center">
              <Icon :name="item.icon" :class="props.collapsed ? 'size-6!' : 'size-5!'" aria-hidden="true" />
              <span
                v-if="props.collapsed && (props.badges?.[item.to] ?? 0) > 0"
                class="badge badge-primary badge-xs absolute -right-1 -top-1"
              >{{ props.badges![item.to] }}</span>
            </span>
            <template v-if="!props.collapsed">
              <span class="nav-label flex-1">{{ item.label }}</span>
              <span
                v-if="(props.badges?.[item.to] ?? 0) > 0"
                class="badge badge-primary"
              >{{ props.badges![item.to] }}</span>
            </template>
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <div class="divider my-0 shrink-0" />
    <div class="flex shrink-0" :class="{ 'justify-center': props.collapsed }">
      <button
        v-if="props.collapsed"
        ref="accountTrigger"
        type="button"
        class="btn btn-ghost btn-circle avatar avatar-placeholder size-11 border-0 p-0"
        aria-label="Menú de usuario"
        aria-haspopup="menu"
        :aria-expanded="accountMenu !== null"
        @click="toggleAccountMenu"
        @mouseenter="showTip($event, profile?.name ?? 'Cuenta')"
        @mouseleave="hideTip()"
        @focusin="showTip($event, profile?.name ?? 'Cuenta')"
        @focusout="hideTip"
      >
        <!-- El círculo llena el botón entero: el hover no deja un aro. -->
        <span class="inline-flex size-full items-center justify-center rounded-full bg-neutral text-neutral-content">{{ initials }}</span>
      </button>
      <button
        v-else
        ref="accountTrigger"
        type="button"
        class="btn btn-ghost h-auto min-h-11 w-full justify-start gap-3 px-2 py-1.5 text-left font-normal"
        aria-label="Menú de usuario"
        aria-haspopup="menu"
        :aria-expanded="accountMenu !== null"
        @click="toggleAccountMenu"
      >
        <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral font-medium text-neutral-content">{{ initials }}</span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm font-medium">{{ profile?.name }}</span>
          <span class="truncate text-xs opacity-70">{{ profile?.email }}</span>
        </span>
        <Icon name="lucide:chevron-up" class="size-4! shrink-0 opacity-70" aria-hidden="true" />
      </button>
    </div>

    <Teleport to="body">
      <ul
        v-if="accountMenu"
        ref="accountMenuEl"
        role="menu"
        aria-label="Cuenta"
        class="menu fixed z-50 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        :class="{ 'w-60': props.collapsed }"
        :style="{ bottom: `${accountMenu.bottom}px`, left: `${accountMenu.left}px`, width: accountMenu.width ? `${accountMenu.width}px` : undefined }"
      >
        <li v-if="profile" role="none" class="menu-title">
          <span class="block truncate font-medium text-base-content">{{ profile.name }}</span>
          <span class="block truncate text-xs font-normal">{{ profile.email }}</span>
        </li>
        <li role="none">
          <ThemeToggle with-label class="min-h-11" />
        </li>
        <li role="none">
          <NuxtLink to="/perfil" role="menuitem" class="min-h-11" @click="emit('navigate')">
            <Icon name="lucide:user" class="size-4" aria-hidden="true" />
            Mi perfil
          </NuxtLink>
        </li>
        <li role="none">
          <button type="button" role="menuitem" class="min-h-11" @click="logout">
            <Icon name="lucide:log-out" class="size-4" aria-hidden="true" />
            Cerrar sesión
          </button>
        </li>
      </ul>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="tip"
        class="pointer-events-none fixed z-50 -translate-y-1/2 rounded-field bg-neutral px-2 py-1 text-sm font-normal leading-tight text-neutral-content"
        :style="{ top: `${tip.top}px`, left: `${tip.left}px` }"
        aria-hidden="true"
      >{{ tip.label }}</div>
    </Teleport>
  </aside>
</template>
