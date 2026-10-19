<script setup lang="ts">
const emit = defineEmits<{ toggleMenu: [] }>()

const route = useRoute()

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
</script>

<template>
  <!-- Alto fijo: los avisos (AppToast, `top-20`) se colocan justo debajo. -->
  <header class="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-base-300 bg-base-100/95 px-2 backdrop-blur sm:px-4">
    <button type="button" class="btn btn-ghost btn-square lg:hidden" aria-label="Abrir menú" @click="emit('toggleMenu')">
      <Icon name="lucide:menu" class="size-5" aria-hidden="true" />
    </button>

    <form role="search" class="flex min-w-0 flex-1 justify-center" @submit.prevent="submitSearch">
      <!-- `min-h-11`: objetivo táctil ≥ 44 px en teléfono (T162, el campo medía 43 px). -->
      <label class="input min-h-11 w-full max-w-xl">
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
  </header>
</template>
