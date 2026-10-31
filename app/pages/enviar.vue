<script setup lang="ts">
definePageMeta({ layout: 'public', access: 'public' })
useHead({ title: 'Enviar archivos · Cloudy' })
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold">Envía tus archivos</h1>
      <p class="text-base-content/70">Fotos, audios, videos o presentaciones para el equipo de producción. No necesitas cuenta.</p>
    </header>

    <GuestUploadForm create-url="/api/public/submissions" />
  </div>
</template>
