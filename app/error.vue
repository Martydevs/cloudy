<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const notFound = computed(() => props.error.statusCode === 404)

useHead({ title: computed(() => notFound.value ? 'Página no encontrada · Cloudy' : 'Error · Cloudy') })

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-base-200 px-4 text-center">
    <Icon :name="notFound ? 'lucide:map-pin-off' : 'lucide:triangle-alert'" class="size-14 text-primary" aria-hidden="true" />
    <h1 class="text-2xl font-semibold">
      {{ notFound ? 'Página no encontrada' : 'Algo salió mal' }}
    </h1>
    <p class="max-w-sm text-base-content/70">
      {{ notFound
        ? 'La dirección no existe o se movió. Revisa el enlace o vuelve al inicio.'
        : 'Ocurrió un error inesperado. Vuelve al inicio e inténtalo de nuevo.' }}
    </p>
    <button type="button" class="btn btn-primary" @click="goHome">
      <Icon name="lucide:house" class="size-4" aria-hidden="true" />
      Ir al inicio
    </button>
  </main>
</template>
