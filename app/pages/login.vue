<script setup lang="ts">
import type { FormField } from '~/components/auth/AuthForm.vue'
import { isSafeRedirect } from '#shared/validation/redirect'

definePageMeta({ layout: 'auth', access: 'guest-only' })
useHead({ title: 'Iniciar sesión · Cloudy' })

const fields: FormField[] = [
  { name: 'email', label: 'Correo electrónico', type: 'email', autocomplete: 'email' },
  { name: 'password', label: 'Contraseña', type: 'password', autocomplete: 'current-password' },
]

const route = useRoute()
const { signIn } = useAuthClient()
const loading = ref(false)
const serverError = ref('')

async function onSubmit(data: LoginForm) {
  loading.value = true
  serverError.value = ''
  try {
    const me = await signIn(data)
    if (!isActiveProfile(me?.profile)) {
      await navigateTo('/pendiente')
      return
    }
    const redirect = route.query.redirect
    await navigateTo(isSafeRedirect(redirect) ? redirect : '/')
  }
  catch (error) {
    serverError.value = authErrorMessage(error, 'No pudimos iniciar sesión. Inténtalo de nuevo.')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthForm
    legend="Iniciar sesión"
    :fields="fields"
    :rules="loginRules"
    submit-label="Iniciar sesión"
    :loading="loading"
    :server-error="serverError"
    @submit="onSubmit"
  >
    <template #footer>
      <div class="flex flex-col items-center gap-2 text-center">
        <NuxtLink to="/recuperar" class="link link-primary">¿Olvidaste tu contraseña?</NuxtLink>
        <p>
          ¿No tienes cuenta?
          <NuxtLink to="/registro" class="link link-primary">Regístrate</NuxtLink>
        </p>
      </div>
      <!-- Invitados (feature 003, FR-001): piden acceso en /upload sin cuenta. -->
      <div class="divider my-1" />
      <div class="flex flex-col items-center gap-2 text-center">
        <p>¿Eres invitado?</p>
        <NuxtLink to="/upload" class="btn btn-outline btn-block">
          <Icon name="lucide:cloud-upload" class="size-4" aria-hidden="true" />
          Enviar archivos
        </NuxtLink>
      </div>
    </template>
  </AuthForm>
</template>
