<!-- Ventana externa del reproductor (feature 005, US4): sin barra lateral; el contenido ocupa el alto de la ventana. -->
<template>
  <div class="flex min-h-dvh flex-col bg-base-300">
    <AppToast />
    <main id="contenido" class="flex min-h-0 flex-1 flex-col">
      <slot />
    </main>
  </div>
</template>
