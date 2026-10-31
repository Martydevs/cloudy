<script setup lang="ts">
import type { FormField } from '~/components/auth/AuthForm.vue'
import { buildResetRedirect } from '#shared/validation/auth'

definePageMeta({ layout: 'auth', access: 'guest-only' })
useHead({ title: 'Recuperar contraseña · Cloudy' })

const fields: FormField[] = [
  { name: 'email', label: 'Correo electrónico', type: 'email', autocomplete: 'email' },
]

const { requestPasswordReset } = useAuthClient()
const config = useRuntimeConfig()
const loading = ref(false)
const sent = ref(false)
const serverError = ref('')

async function onSubmit(data: ForgotForm) {
  loading.value = true
  serverError.value = ''
  try {
    const siteUrl = config.public.siteUrl || window.location.origin
    await requestPasswordReset({ email: data.email, redirectTo: buildResetRedirect(siteUrl) })
    sent.value = true
  }
  catch (error) {
    // Mensaje neutro: no se revela si el correo existe. Solo se informa el límite de intentos.
    if ((error as { status?: number }).status === 429) serverError.value = authErrorMessage(error, '')
    else sent.value = true
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="sent" class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold">Revisa tu correo</h1>
    <div role="status" class="alert alert-success alert-soft">
      <Icon name="lucide:mail-check" class="size-5 shrink-0" aria-hidden="true" />
      <span>Si el correo existe, te enviamos un enlace para restablecer tu contraseña. Puede tardar unos minutos.</span>
    </div>
    <NuxtLink to="/login" class="btn">Volver a iniciar sesión</NuxtLink>
  </div>
  <AuthForm
    v-else
    legend="Recuperar contraseña"
    :fields="fields"
    :schema="forgotSchema"
    submit-label="Enviar enlace"
    :loading="loading"
    :server-error="serverError"
    @submit="onSubmit"
  >
    <template #intro>
      <p class="text-base-content/70">Te enviaremos un enlace para crear una contraseña nueva.</p>
    </template>
    <template #footer>
      <NuxtLink to="/login" class="link link-primary text-center">Volver a iniciar sesión</NuxtLink>
    </template>
  </AuthForm>
</template>
