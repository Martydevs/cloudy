<script setup lang="ts">
const { theme } = useTheme()
const { options, isRevealed, accept, cancel } = useConfirm()

// El SSR pinta `data-theme` desde la cookie: no hay parpadeo (FR-043).
useHead({
  htmlAttrs: { 'data-theme': theme },
  meta: [
    { name: 'theme-color', content: computed(() => theme.value === 'cloudy' ? '#0a0a0a' : '#fcfbf9') },
    // Lighthouse SEO: la descripción vale para la página pública /enviar; el resto es privado.
    { name: 'description', content: 'Cloudy: el disco multimedia del equipo de producción. Sube, organiza y revisa fotos, audio, video y presentaciones.' },
  ],
})
</script>

<template>
  <!-- La página anterior sigue visible mientras carga la siguiente: la barra avisa que hay una navegación en curso. -->
  <NuxtLoadingIndicator color="var(--color-primary)" :height="3" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <AppToast />
  <ConfirmDialog
    :open="isRevealed"
    :title="options?.title ?? ''"
    :message="options?.message"
    :confirm-label="options?.confirmLabel"
    :danger="options?.danger"
    @confirm="accept"
    @cancel="cancel"
  />
</template>
