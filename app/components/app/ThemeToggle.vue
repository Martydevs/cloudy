<script setup lang="ts">
// `withLabel`: variante para menús (ícono + texto en fila) en vez del botón cuadrado solo con ícono.
const props = defineProps<{ withLabel?: boolean }>()
const { isDark, toggle } = useTheme()
const label = computed(() => isDark.value ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro')
</script>

<template>
  <button
    v-if="props.withLabel"
    type="button"
    :aria-label="label"
    :aria-pressed="!isDark"
    @click="toggle"
  >
    <Icon :name="isDark ? 'lucide:sun' : 'lucide:moon'" class="size-4" aria-hidden="true" />
    {{ label }}
  </button>
  <button
    v-else
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
