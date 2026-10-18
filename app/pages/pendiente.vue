<script setup lang="ts">
definePageMeta({ layout: 'auth', access: 'pending' })
useHead({ title: 'Cuenta pendiente · Cloudy' })

const { profile } = useMe()
const { logout, loggingOut } = useAuthClient()

const content = computed(() => {
  switch (profile.value?.status) {
    case 'disabled':
      return {
        icon: 'lucide:user-x',
        title: 'Tu cuenta fue desactivada',
        text: 'Si crees que es un error, habla con un administrador del equipo.',
      }
    case 'removed':
      return {
        icon: 'lucide:user-x',
        title: 'Tu cuenta fue eliminada',
        text: 'Ya no tienes acceso a Cloudy. Habla con un administrador si necesitas volver.',
      }
    default:
      return {
        icon: 'lucide:hourglass',
        title: 'Tu cuenta está pendiente de aprobación',
        text: 'Un administrador debe activarla y asignarte un rol. Vuelve a intentarlo más tarde.',
      }
  }
})
</script>

<template>
  <div class="flex flex-col items-center gap-4 text-center">
    <Icon :name="content.icon" class="size-12 text-primary" aria-hidden="true" />
    <h1 class="text-xl font-semibold">{{ content.title }}</h1>
    <p class="text-base-content/70">{{ content.text }}</p>
    <p v-if="profile" class="text-sm text-base-content/70">{{ profile.email }}</p>
    <!--
      El primer cierre de sesión carga el cliente de Neon Auth y tarda: se muestra el progreso.
      `logout()` ya ignora los clics repetidos, así que no se usa `disabled` (el botón gris hacía
      ilegible el progreso) sino `aria-disabled`, que además conserva el foco.
    -->
    <button
      type="button"
      class="btn w-full"
      :aria-disabled="loggingOut || undefined"
      :aria-busy="loggingOut"
      @click="logout()"
    >
      <span v-if="loggingOut" class="loading loading-spinner loading-sm" aria-hidden="true" />
      <Icon v-else name="lucide:log-out" class="size-4" aria-hidden="true" />
      {{ loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión' }}
    </button>
  </div>
</template>
