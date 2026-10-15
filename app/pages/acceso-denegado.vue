<script setup lang="ts">
// Con sesión activa se muestra dentro del dashboard; sin ella, en la tarjeta de auth.
definePageMeta({ access: 'public', layout: false })
useHead({ title: 'Acceso denegado · Cloudy' })

const { isActive } = useMe()
</script>

<template>
  <NuxtLayout :name="isActive ? 'dashboard' : 'auth'">
    <div class="flex flex-col items-center gap-4 py-8 text-center">
      <Icon name="lucide:shield-x" class="size-14 text-error" aria-hidden="true" />
      <h1 class="text-2xl font-semibold">No tienes permiso para ver esta página</h1>
      <p class="max-w-sm text-base-content/70">Si necesitas acceso, pídeselo a un administrador del equipo.</p>
      <NuxtLink to="/" class="btn btn-primary">
        <Icon name="lucide:house" class="size-4" aria-hidden="true" />
        Volver al inicio
      </NuxtLink>
    </div>
  </NuxtLayout>
</template>
