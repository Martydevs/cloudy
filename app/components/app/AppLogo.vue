<script setup lang="ts">
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
</script>

<template>
  <span
    class="inline-flex items-center gap-2"
    :class="compact ? 'size-11 justify-center' : 'text-lg'"
  >
    <span :class="compact ? 'relative flex' : undefined">
      <Icon
        name="lucide:cloud"
        :class="compact ? 'size-6! text-primary' : 'size-7 text-primary'"
        aria-hidden="true"
      />
    </span>
    <span :class="compact ? 'sr-only' : 'font-semibold'">Cloudy</span>
  </span>
</template>
