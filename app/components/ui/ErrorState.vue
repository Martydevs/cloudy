<script setup lang="ts">
withDefaults(defineProps<{ message?: string }>(), {
  message: 'No pudimos cargar la información. Revisa tu conexión e inténtalo de nuevo.',
})
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div role="alert" class="alert alert-error alert-soft flex flex-col items-start gap-3 sm:flex-row sm:items-center">
    <Icon name="lucide:circle-alert" class="size-6 shrink-0" aria-hidden="true" />
    <span class="flex-1">{{ message }}</span>
    <button type="button" class="btn" @click="emit('retry')">
      <Icon name="lucide:refresh-cw" class="size-4" aria-hidden="true" />
      Reintentar
    </button>
  </div>
</template>
