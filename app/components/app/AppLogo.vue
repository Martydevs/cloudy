<script setup lang="ts">
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
</script>

<template>
  <span class="inline-flex items-center gap-2 text-lg">
    <Icon name="lucide:cloud" class="size-7 text-primary" aria-hidden="true" />
    <span :class="compact ? 'sr-only' : 'font-semibold'">Cloudy</span>
  </span>
</template>
