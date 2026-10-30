<script setup lang="ts">
import type { FileItem, Submission, SubmissionStatus } from '#shared/types/api'
import { POLL_INTERVAL_MS } from '#shared/constants/files'

definePageMeta({ layout: 'dashboard', access: 'private' })
useHead({ title: 'Solicitudes · Cloudy' })

const TABS: { value: SubmissionStatus, label: string }[] = [
  { value: 'pending', label: 'Por revisar' },
  { value: 'approved', label: 'Aprobados' },
  { value: 'rejected', label: 'Rechazados' },
]
const tab = ref<SubmissionStatus>('pending')

const api = useApi()
const toast = useToast()
const { pendingCount } = usePulse()
const { copyGuestLink } = useGuestLink()
const { data, error, pending, refresh } = await useApiFetch<Submission[]>('/api/submissions', { lazy: true, query: { status: tab } })
// Llegó o se revisó un envío en otra pestaña: se recarga la cola.
watch(pendingCount, () => refresh())

// Nuxt vacía `data` cuando falla una recarga: se conserva la última lista buena para que un sondeo
// fallido no sustituya la cola por el error (solo se avisa); la siguiente recarga la recupera.
// Al cambiar de pestaña se parte de cero para que se vea el esqueleto (T162, defecto 3).
const list = ref<Submission[] | null>(null)
watch(data, (value) => {
  if (value) list.value = value
}, { immediate: true })
watch(tab, () => {
  list.value = null
})
const staleError = computed(() => !!error.value && !!list.value)
// El pulso solo corre en el cliente: con el conteo del listado (que sí llega en el SSR) la pestaña ya nace con su
// contador y no cambia de ancho al hidratar (CLS a 360 px, feature 003).
const pendingBadge = computed(() => Math.max(pendingCount.value, tab.value === 'pending' ? (list.value?.length ?? 0) : 0))
// Cada recarga fallida (Nuxt crea un objeto de error nuevo en cada una) re-arma un reintento a los 5 s,
// también cuando el reintento automático vuelve a fallar; hay botón para no esperar y un éxito lo cancela.
const retry = useTimeoutFn(() => refresh(), POLL_INTERVAL_MS, { immediate: false })
watch(error, (failure) => {
  if (failure && list.value) retry.start()
  else retry.stop()
})

const busyId = ref<string | null>(null)

async function review(submission: Submission, task: () => Promise<void>, fallback: string) {
  busyId.value = submission.id
  try {
    await task()
  }
  catch (err) {
    toast.error(serverMessage(err, fallback))
  }
  finally {
    busyId.value = null
    await Promise.all([refresh(), refreshPulse()])
  }
}

const approve = (submission: Submission, folderId: string | null) => review(submission, async () => {
  const { files } = await api<{ files: FileItem[] }>(`/api/submissions/${submission.id}/approve`, { method: 'POST', body: { folderId } })
  toast.success(files.length === 1 ? messages.submissions.approvedOne(files[0]!.name) : messages.submissions.approvedMany(files.length, submission.senderName), {
    action: { label: 'Ver', to: folderId ? `/archivos/${folderId}` : '/archivos' },
  })
}, messages.submissions.approveFailed)

const reject = (submission: Submission, reason: string) => review(submission, async () => {
  await api(`/api/submissions/${submission.id}/reject`, { method: 'POST', body: { reason } })
  toast.success(messages.submissions.rejected(submission.senderName))
}, messages.submissions.rejectFailed)

const EMPTY: Record<SubmissionStatus, string> = {
  pending: 'No hay envíos por revisar',
  approved: 'Todavía no hay envíos aprobados',
  rejected: 'No hay envíos rechazados',
  expired: 'No hay envíos caducados',
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">Solicitudes</h1>
        <p class="text-base-content/70">Invitados que piden acceso y material que enviaron para revisar.</p>
      </div>
      <button type="button" class="btn" @click="copyGuestLink">
        <Icon name="lucide:link" class="size-4" aria-hidden="true" />
        Copiar enlace para invitados
      </button>
    </header>

    <div role="tablist" class="tabs tabs-box w-fit">
      <button
        v-for="option in TABS"
        :key="option.value"
        type="button"
        role="tab"
        class="tab min-h-11"
        :class="{ 'tab-active': tab === option.value }"
        :aria-selected="tab === option.value"
        @click="tab = option.value"
      >
        {{ option.label }}
        <span v-if="option.value === 'pending' && pendingBadge > 0" class="badge badge-primary badge-sm ml-2">{{ pendingBadge }}</span>
      </button>
    </div>

    <!-- Solicitudes de acceso de invitados (feature 003): solo con la pestaña "Por revisar". -->
    <section v-if="tab === 'pending'" aria-labelledby="acceso-title" class="flex flex-col gap-3">
      <h2 id="acceso-title" class="text-lg font-semibold">Solicitudes de acceso</h2>
      <AccessRequestList />
    </section>

    <section aria-labelledby="envios-title" class="flex flex-col gap-3">
      <h2 id="envios-title" class="text-lg font-semibold">Envíos</h2>
      <div v-if="staleError" role="status" class="flex flex-wrap items-center gap-3 text-sm text-base-content/70">
        <span>{{ messages.load.submissionsRefresh }}</span>
        <button type="button" class="btn" :disabled="pending" @click="refresh()">Reintentar</button>
      </div>
      <SkeletonList v-if="!list && pending" :rows="3" />
      <ErrorState v-else-if="error && !list" :message="messages.load.submissions" @retry="refresh()" />
      <EmptyState
        v-else-if="!list || list.length === 0"
        icon="lucide:inbox"
        :title="EMPTY[tab]"
        :description="tab === 'pending' ? 'Comparte el enlace para invitados y lo que envíen aparecerá aquí.' : ''"
      >
        <button v-if="tab === 'pending'" type="button" class="btn btn-primary" @click="copyGuestLink">Copiar enlace para invitados</button>
      </EmptyState>
      <ul v-else class="flex flex-col gap-3" aria-label="Envíos">
        <li v-for="submission in list" :key="submission.id">
          <SubmissionCard
            :submission="submission"
            :busy="busyId === submission.id"
            @approve="folderId => approve(submission, folderId)"
            @reject="reason => reject(submission, reason)"
          />
        </li>
      </ul>
    </section>
  </div>
</template>
