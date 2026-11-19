<script setup lang="ts">
// Layout de /calendario: el mismo armazón del dashboard (menú, barra, avisos, bandejas) con el contenido a todo el
// ancho de la columna. `--calendar-h` es el 80 % del alto bajo la barra superior (4 rem), con un mínimo de 28 rem: se
// calcula con el viewport, así el esqueleto y el calendario miden lo mismo sin depender del alto de su contenedor.
const calendarHeight = { '--calendar-h': 'max(calc((100dvh - 4rem) * 0.8), 28rem)' }
</script>

<template>
  <AppShell fluid :style="calendarHeight">
    <slot />
  </AppShell>
</template>
