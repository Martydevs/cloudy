<script setup lang="ts">
// Contador de comentarios de un archivo en la cuadrícula y la lista (FR-040). Sin comentarios no se muestra.
const props = defineProps<{ count?: number }>()
const label = computed(() => (props.count === 1 ? '1 comentario' : `${props.count} comentarios`))
</script>

<template>
  <span v-if="count" role="img" :aria-label="label" :title="label" class="inline-flex shrink-0 items-center gap-0.5">
    <Icon name="lucide:message-circle" class="size-3.5" aria-hidden="true" />
    {{ count }}
  </span>
</template>
