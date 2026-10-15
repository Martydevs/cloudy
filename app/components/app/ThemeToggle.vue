<script setup lang="ts">
const { isDark, toggle } = useTheme()
const label = computed(() => isDark.value ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro')
</script>

<template>
  <button
    type="button"
    class="btn btn-ghost btn-square swap swap-rotate"
    :class="{ 'swap-active': !isDark }"
    :aria-label="label"
    :aria-pressed="!isDark"
    :title="label"
    @click="toggle"
  >
    <Icon name="lucide:sun" class="swap-on size-5" aria-hidden="true" />
    <Icon name="lucide:moon" class="swap-off size-5" aria-hidden="true" />
  </button>
</template>
