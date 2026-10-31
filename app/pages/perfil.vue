<script setup lang="ts">
import type { FormField } from '~/components/auth/AuthForm.vue'
import type { Profile } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private' })
useHead({ title: 'Mi perfil · Cloudy' })

const { me, profile } = useMe()
const { updateUser, changePassword } = useAuthClient()
const api = useApi()
const toast = useToast()

const nameFields: FormField[] = [{ name: 'name', label: 'Nombre', autocomplete: 'name' }]
const passwordFields: FormField[] = [
  { name: 'currentPassword', label: 'Contraseña actual', type: 'password', autocomplete: 'current-password' },
  { name: 'password', label: 'Nueva contraseña', type: 'password', autocomplete: 'new-password', hint: 'Mínimo 8 caracteres.' },
  { name: 'confirm', label: 'Confirmar contraseña', type: 'password', autocomplete: 'new-password' },
]

const savingName = ref(false)
const nameError = ref('')
async function saveName(data: ProfileNameForm) {
  savingName.value = true
  nameError.value = ''
  try {
    const updated = await api<Profile>('/api/me', { method: 'PATCH', body: data })
    // Neon Auth guarda su propia copia del nombre; si falla, Cloudy ya tiene el valor correcto.
    await updateUser({ name: data.name }).catch(() => {})
    if (me.value) me.value = { ...me.value, profile: updated, user: { ...me.value.user, name: updated.name } }
    toast.success(messages.profile.nameSaved)
  }
  catch (error) {
    nameError.value = serverMessage(error, messages.profile.nameFailed)
  }
  finally {
    savingName.value = false
  }
}

const savingPassword = ref(false)
const passwordError = ref('')
const passwordFormKey = ref(0)
async function savePassword(data: ChangePasswordForm) {
  savingPassword.value = true
  passwordError.value = ''
  try {
    await changePassword({ currentPassword: data.currentPassword, newPassword: data.password })
    passwordFormKey.value++
    toast.success(messages.profile.passwordSaved)
  }
  catch (error) {
    passwordError.value = authErrorMessage(error, 'No pudimos cambiar la contraseña. Revisa la contraseña actual.')
    if ((error as { code?: string }).code === 'INVALID_PASSWORD') passwordError.value = 'La contraseña actual no es correcta.'
  }
  finally {
    savingPassword.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-2xl flex-col gap-6">
    <h1 class="text-2xl font-semibold">Mi perfil</h1>

    <section v-if="profile" aria-labelledby="cuenta-title" class="card border border-base-300 bg-base-100">
      <div class="card-body gap-3">
        <h2 id="cuenta-title" class="card-title text-lg">Cuenta</h2>
        <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-sm text-base-content/70">Correo electrónico</dt>
            <dd class="break-all font-medium">{{ profile.email }}</dd>
          </div>
          <div>
            <dt class="text-sm text-base-content/70">Rol</dt>
            <dd><span class="badge badge-primary badge-soft">{{ roleLabel(profile.role) }}</span></dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="card border border-base-300 bg-base-100">
      <div class="card-body">
        <AuthForm
          v-if="profile"
          legend="Nombre visible"
          :fields="nameFields"
          :schema="profileNameSchema"
          :initial="{ name: profile.name }"
          submit-label="Guardar nombre"
          :loading="savingName"
          :server-error="nameError"
          @submit="saveName"
        />
      </div>
    </section>

    <section class="card border border-base-300 bg-base-100">
      <div class="card-body">
        <AuthForm
          :key="passwordFormKey"
          legend="Cambiar contraseña"
          :fields="passwordFields"
          :schema="changePasswordSchema"
          submit-label="Cambiar contraseña"
          :loading="savingPassword"
          :server-error="passwordError"
          @submit="savePassword"
        />
      </div>
    </section>
  </div>
</template>
