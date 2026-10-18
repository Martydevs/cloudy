<script setup lang="ts">
// Hora exacta visible en la zona horaria de la persona. El servidor renderiza en otra zona (UTC en
// Vercel), así que emite la hora relativa, que no depende de la zona, y al montar se cambia por la
// absoluta: sin desajuste de hidratación y sin mostrar ni un instante una hora de otra zona.
defineProps<{ iso: string }>()
const mounted = useMounted()
</script>

<template>
  <time :datetime="iso">{{ mounted ? formatDateTime(iso) : timeAgo(iso) }}</time>
</template>
