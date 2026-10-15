<script setup lang="ts">
withDefaults(defineProps<{ rows?: number, variant?: 'grid' | 'list' }>(), { rows: 6, variant: 'list' })
</script>

<template>
  <div aria-busy="true" aria-live="polite">
    <span class="sr-only">Cargando…</span>
    <div v-if="variant === 'grid'" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <div v-for="n in rows" :key="n" class="flex flex-col gap-2">
        <div class="skeleton aspect-square w-full" />
        <div class="skeleton h-4 w-3/4" />
      </div>
    </div>
    <div v-else class="flex flex-col gap-3">
      <div v-for="n in rows" :key="n" class="flex items-center gap-3">
        <div class="skeleton size-11 shrink-0" />
        <div class="flex flex-1 flex-col gap-2">
          <div class="skeleton h-4 w-2/3" />
          <div class="skeleton h-3 w-1/3" />
        </div>
      </div>
    </div>
  </div>
</template>
