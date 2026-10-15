<script setup lang="ts">
withDefaults(defineProps<{ icon?: string, title: string, description?: string }>(), {
  icon: 'lucide:inbox',
  description: '',
})
</script>

<template>
  <div class="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-300 px-4 py-10 text-center">
    <Icon :name="icon" class="size-10 text-base-content/50" aria-hidden="true" />
    <h2 class="text-lg font-semibold">{{ title }}</h2>
    <p v-if="description" class="max-w-sm text-base-content/70">{{ description }}</p>
    <div v-if="$slots.default" class="mt-2 flex flex-wrap justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
