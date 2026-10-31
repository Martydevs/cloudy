<script setup lang="ts">
import type { FormField } from '~/components/auth/AuthForm.vue'

definePageMeta({ layout: 'auth', access: 'guest-only' })
useHead({ title: 'Crear cuenta · Cloudy' })

const fields: FormField[] = [
  { name: 'name', label: 'Nombre', autocomplete: 'name' },
  { name: 'email', label: 'Correo electrónico', type: 'email', autocomplete: 'email' },
  { name: 'password', label: 'Contraseña', type: 'password', autocomplete: 'new-password', hint: 'Mínimo 8 caracteres.' },
  { name: 'confirm', label: 'Confirmar contraseña', type: 'password', autocomplete: 'new-password' },
]

const { signUp } = useAuthClient()
const loading = ref(false)
const serverError = ref('')

async function onSubmit(data: RegisterForm) {
  loading.value = true
  serverError.value = ''
  try {
    const me = await signUp({ name: data.name, email: data.email, password: data.password })
    await navigateTo(isActiveProfile(me?.profile) ? '/' : '/pendiente')
  }
  catch (error) {
    serverError.value = authErrorMessage(error, 'No pudimos crear la cuenta. Revisa los datos e inténtalo de nuevo.')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthForm
    legend="Crear cuenta"
    :fields="fields"
    :schema="registerSchema"
    submit-label="Crear cuenta"
    :loading="loading"
    :server-error="serverError"
    @submit="onSubmit"
  >
    <template #intro>
      <p class="text-base-content/70">Un administrador revisará tu cuenta antes de darte acceso.</p>
    </template>
    <template #footer>
      <p class="text-center">
        ¿Ya tienes cuenta?
        <NuxtLink to="/login" class="link link-primary">Inicia sesión</NuxtLink>
      </p>
    </template>
  </AuthForm>
</template>
