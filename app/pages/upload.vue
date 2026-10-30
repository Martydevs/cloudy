<script setup lang="ts">
// Subir (feature 003, FR-002/FR-013): el invitado pide acceso con su nombre, ve en vivo la decisión del equipo
// y, aprobado, hace un envío desde este mismo navegador. Nunca muestra nombres del equipo.
import { check } from '#shared/validation/core'
import { senderName as senderNameField } from '#shared/validation/submissions'

definePageMeta({ layout: 'public', access: 'public' })
useHead({ title: 'Subir archivos · Cloudy' })

const access = useGuestAccess()
const { state, senderName, minutesLeft } = access

const name = ref(senderName.value ?? '')
const nameError = ref('')
const nameId = useId()
watch(name, () => {
  nameError.value = ''
})
watch(senderName, (value) => {
  if (value && !name.value) name.value = value
})

// El formulario sigue montado desde que empieza un envío hasta que la persona pide otro acceso: una subida
// en curso no se interrumpe aunque venza el acceso, y la confirmación del envío queda a la vista.
const keepForm = ref(false)
const denied = ref('')
const showForm = computed(() => !denied.value && (state.value === 'approved' || keepForm.value))

function onSubmitting(active: boolean) {
  access.holdWhileUploading(active)
  if (active) keepForm.value = true
}

async function onDone() {
  await access.refresh()
}

function onDenied(message: string) {
  denied.value = message
  keepForm.value = false
}

async function ask() {
  nameError.value = check(senderNameField(), name.value) ?? ''
  if (nameError.value) return
  await access.request(name.value.trim())
}

function restart() {
  denied.value = ''
  keepForm.value = false
  access.restart()
}

const announcement = computed(() => {
  if (denied.value) return denied.value
  switch (state.value) {
    case 'waiting': return messages.access.state.waiting
    case 'approved': return messages.access.state.approved
    case 'rejected': return messages.access.state.rejected
    case 'expired': return messages.access.state.expired
    case 'accessExpired': return messages.access.state.accessExpired
    case 'used': return messages.access.state.used
    default: return ''
  }
})

const ENDED = {
  rejected: { icon: 'lucide:circle-x', title: messages.access.state.rejected },
  expired: { icon: 'lucide:clock', title: messages.access.state.expired },
  accessExpired: { icon: 'lucide:clock', title: messages.access.state.accessExpired },
} as const
const ended = computed(() => (state.value === 'rejected' || state.value === 'expired' || state.value === 'accessExpired') ? ENDED[state.value] : null)
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold">Envía tus archivos</h1>
      <p class="text-base-content/70">Pide permiso al equipo; en cuanto alguien lo apruebe podrás subir tus archivos aquí mismo.</p>
    </header>

    <!-- Anuncia cada cambio de estado a los lectores de pantalla (FR-013). -->
    <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>

    <SkeletonList v-if="access.loading.value" :rows="2" />
    <ErrorState v-else-if="access.loadError.value" :message="messages.load.generic" @retry="access.refresh()" />

    <div v-else-if="denied" class="flex flex-col items-start gap-3">
      <p role="alert" class="alert alert-error alert-soft w-full">
        <Icon name="lucide:circle-alert" class="size-5" aria-hidden="true" />
        <span>{{ denied }}</span>
      </p>
      <button type="button" class="btn btn-primary" @click="restart">{{ messages.access.state.retry }}</button>
    </div>

    <template v-else-if="showForm">
      <p v-if="state === 'approved' && !keepForm" class="alert alert-success">
        <Icon name="lucide:circle-check" class="size-5" aria-hidden="true" />
        <span class="flex flex-col">
          <span class="font-semibold">{{ messages.access.state.approved }}</span>
          <span>{{ messages.access.state.window(minutesLeft) }}</span>
        </span>
      </p>
      <GuestUploadForm
        create-url="/api/public/access/submissions"
        :sender-name="senderName"
        @submitting="onSubmitting"
        @done="onDone"
        @denied="onDenied"
      >
        <template #done-actions>
          <button type="button" class="btn btn-primary" @click="restart">{{ messages.access.state.another }}</button>
        </template>
      </GuestUploadForm>
    </template>

    <section v-else-if="state === 'waiting'" class="card border border-base-300 bg-base-100">
      <div class="card-body items-center gap-3 text-center">
        <span class="loading loading-dots loading-lg text-primary motion-reduce:hidden" aria-hidden="true" />
        <!-- En un contenedor: el `display` del icono le gana a `hidden` si se ponen en el mismo elemento. -->
        <span class="hidden motion-reduce:block" aria-hidden="true">
          <Icon name="lucide:hourglass" class="size-10 text-primary" />
        </span>
        <h2 class="text-lg font-semibold">{{ messages.access.state.waiting }}</h2>
        <p class="text-base-content/70">
          Pediste acceso como <span class="font-medium text-base-content">{{ senderName }}</span>.
          Deja esta página abierta: se actualiza sola.
        </p>
        <p class="badge badge-outline">{{ messages.access.state.expiresIn(minutesLeft) }}</p>
      </div>
    </section>

    <EmptyState v-else-if="ended" :icon="ended.icon" :title="ended.title">
      <button type="button" class="btn btn-primary" @click="restart">{{ messages.access.state.retry }}</button>
    </EmptyState>

    <section v-else-if="state === 'used'" class="card border border-base-300 bg-base-100">
      <div class="card-body items-center gap-3 text-center">
        <Icon name="lucide:circle-check" class="size-12 text-success" aria-hidden="true" />
        <h2 class="text-xl font-semibold">{{ messages.access.state.used }}</h2>
        <p class="text-base-content/70">El equipo lo revisará pronto.</p>
        <button type="button" class="btn btn-primary" @click="restart">{{ messages.access.state.another }}</button>
      </div>
    </section>

    <form v-else class="card border border-base-300 bg-base-100" novalidate @submit.prevent="ask">
      <fieldset class="card-body gap-3" :disabled="access.requesting.value">
        <label :for="nameId" class="label">Tu nombre</label>
        <input
          :id="nameId"
          v-model="name"
          type="text"
          class="input w-full"
          :class="{ 'input-error': nameError }"
          autocomplete="name"
          maxlength="80"
          required
          :aria-invalid="!!nameError || undefined"
          :aria-describedby="nameError ? `${nameId}-error` : undefined"
        >
        <p v-if="nameError" :id="`${nameId}-error`" class="text-sm text-error" role="alert">{{ nameError }}</p>
        <p v-if="access.requestError.value" role="alert" class="alert alert-error alert-soft">
          <Icon name="lucide:circle-alert" class="size-5" aria-hidden="true" />
          <span>{{ access.requestError.value }}</span>
        </p>
        <button type="submit" class="btn btn-primary btn-block">
          <span v-if="access.requesting.value" class="loading loading-spinner loading-sm" aria-hidden="true" />
          <Icon v-else name="lucide:hand" class="size-4" aria-hidden="true" />
          Pedir acceso
        </button>
      </fieldset>
    </form>
  </div>
</template>
