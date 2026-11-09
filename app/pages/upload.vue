<script setup lang="ts">
// Subir (feature 003, un solo paso): el invitado escribe su nombre, una nota opcional y elige sus archivos; el envío
// llega directo a la cola de Solicitudes, donde el equipo lo aprueba o lo rechaza. No necesita cuenta.
definePageMeta({ layout: 'public', access: 'public' })
useHead({ title: 'Subir archivos · Cloudy' })
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold">Envía tus archivos</h1>
      <p class="text-base-content/70">
        Fotos, audios, videos o presentaciones para el equipo de producción. No necesitas cuenta: escribe tu nombre,
        elige tus archivos y el equipo los revisará.
      </p>
    </header>

    <GuestUploadForm create-url="/api/public/submissions" />

    <NuxtLink to="/login" class="link link-primary inline-flex min-h-11 items-center justify-center gap-2 self-center">
      <Icon name="lucide:arrow-left" class="size-4" aria-hidden="true" />
      Volver a iniciar sesión
    </NuxtLink>
  </div>
</template>
