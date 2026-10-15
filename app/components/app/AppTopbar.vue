<script setup lang="ts">
const emit = defineEmits<{ toggleMenu: [], upload: [] }>()

const route = useRoute()
const { profile } = useMe()
const { logout } = useAuthClient()

const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
watch(() => route.query.q, (q) => {
  search.value = typeof q === 'string' ? q : ''
})

// `/` enfoca la búsqueda, salvo mientras se escribe en otro campo.
onKeyStroke('/', (event) => {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault()
  searchInput.value?.focus()
})

function submitSearch() {
  const q = search.value.trim()
  navigateTo({ path: '/archivos', query: q ? { q } : {} })
}

const menuOpen = ref(false)
const menuRoot = useTemplateRef<HTMLElement>('menuRoot')
onClickOutside(menuRoot, () => {
  menuOpen.value = false
})
onKeyStroke('Escape', () => {
  menuOpen.value = false
})
onScopeDispose(useRouter().afterEach(() => {
  menuOpen.value = false
}))

const initials = computed(() => (profile.value?.name ?? '?').trim().slice(0, 1).toUpperCase())
</script>

<template>
  <header class="sticky top-0 z-30 flex items-center gap-2 border-b border-base-300 bg-base-100/95 px-2 py-2 backdrop-blur sm:px-4">
    <button type="button" class="btn btn-ghost btn-square lg:hidden" aria-label="Abrir menú" @click="emit('toggleMenu')">
      <Icon name="lucide:menu" class="size-5" aria-hidden="true" />
    </button>

    <form role="search" class="min-w-0 flex-1" @submit.prevent="submitSearch">
      <label class="input w-full max-w-xl">
        <Icon name="lucide:search" class="size-4 opacity-60" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="search"
          type="search"
          class="grow"
          placeholder="Buscar archivos"
          aria-label="Buscar archivos"
          enterkeyhint="search"
        >
        <kbd class="kbd kbd-sm hidden lg:inline-flex" aria-hidden="true">/</kbd>
      </label>
    </form>

    <button type="button" class="btn btn-primary btn-square sm:w-auto sm:px-4" aria-label="Subir archivos" @click="emit('upload')">
      <Icon name="lucide:upload" class="size-5" aria-hidden="true" />
      <span class="hidden sm:inline">Subir</span>
    </button>

    <ThemeToggle class="hidden sm:inline-grid" />

    <div ref="menuRoot" class="dropdown dropdown-end" :class="{ 'dropdown-open': menuOpen }">
      <button
        type="button"
        class="btn btn-ghost btn-circle avatar avatar-placeholder"
        aria-label="Menú de usuario"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <span class="w-10 rounded-full bg-neutral text-neutral-content">{{ initials }}</span>
      </button>
      <ul v-if="menuOpen" role="menu" class="menu dropdown-content z-40 mt-2 w-60 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
        <li v-if="profile" role="none" class="menu-title">
          <span class="truncate font-medium text-base-content">{{ profile.name }}</span>
          <span class="truncate text-xs font-normal">{{ profile.email }}</span>
        </li>
        <li role="none" class="sm:hidden">
          <ThemeToggle class="w-full" />
        </li>
        <li role="none">
          <NuxtLink to="/perfil" role="menuitem" class="min-h-11">
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
    </div>
  </header>
</template>
