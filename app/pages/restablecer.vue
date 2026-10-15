<script setup lang="ts">
import type { FormField } from '~/components/auth/AuthForm.vue'
import type { Infer } from '#shared/validation/core'
import { resetInput } from '#shared/validation/auth'

definePageMeta({ layout: 'auth', access: 'public' })
useHead({ title: 'Restablecer contraseña · Cloudy' })

const fields: FormField[] = [
  { name: 'password', label: 'Nueva contraseña', type: 'password', autocomplete: 'new-password', hint: 'Mínimo 8 caracteres.' },
  { name: 'confirm', label: 'Confirmar contraseña', type: 'password', autocomplete: 'new-password' },
]

const route = useRoute()
const token = computed(() => typeof route.query.token === 'string' ? route.query.token : '')
// Better Auth redirige con `?error=INVALID_TOKEN` cuando el enlace ya no sirve.
const expired = ref(!token.value || route.query.error === 'INVALID_TOKEN')

const { resetPassword } = useAuthClient()
const toast = useToast()
const loading = ref(false)
const serverError = ref('')

async function onSubmit(data: Infer<typeof resetInput>) {
  loading.value = true
  serverError.value = ''
  try {
    await resetPassword({ newPassword: data.password, token: token.value })
    toast.success('Contraseña actualizada. Ya puedes iniciar sesión.')
    await navigateTo('/login')
  }
  catch (error) {
    if ((error as { code?: string }).code === 'INVALID_TOKEN') expired.value = true
    else serverError.value = authErrorMessage(error, 'No pudimos cambiar la contraseña. Inténtalo de nuevo.')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="expired" class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold">El enlace caducó o ya se usó</h1>
    <p class="text-base-content/70">Pide un enlace nuevo para restablecer tu contraseña.</p>
    <NuxtLink to="/recuperar" class="btn btn-primary">Pedir un enlace nuevo</NuxtLink>
  </div>
  <AuthForm
    v-else
    legend="Restablecer contraseña"
    :fields="fields"
    :validator="resetInput"
    submit-label="Guardar contraseña"
    :loading="loading"
    :server-error="serverError"
    @submit="onSubmit"
  />
</template>
