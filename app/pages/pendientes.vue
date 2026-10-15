<script setup lang="ts">
import type { FileItem, Submission, SubmissionStatus } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private' })
useHead({ title: 'Pendientes · Cloudy' })

const TABS: { value: SubmissionStatus, label: string }[] = [
  { value: 'pending', label: 'Pendientes' },
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
  toast.success(files.length === 1 ? `Se aprobó «${files[0]!.name}»` : `Se aprobaron ${files.length} archivos de ${submission.senderName}`, {
    action: { label: 'Ver', to: folderId ? `/archivos/${folderId}` : '/archivos' },
  })
}, 'No pudimos aprobar el envío. Inténtalo de nuevo.')

const reject = (submission: Submission, reason: string) => review(submission, async () => {
  await api(`/api/submissions/${submission.id}/reject`, { method: 'POST', body: { reason } })
  toast.success(`Se rechazó el envío de ${submission.senderName}`)
}, 'No pudimos rechazar el envío. Inténtalo de nuevo.')

const EMPTY: Record<SubmissionStatus, string> = {
  pending: 'No hay envíos pendientes',
  approved: 'Todavía no hay envíos aprobados',
  rejected: 'No hay envíos rechazados',
  expired: 'No hay envíos caducados',
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">Pendientes</h1>
        <p class="text-base-content/70">Material que enviaron invitados desde el enlace público.</p>
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
        <span v-if="option.value === 'pending' && pendingCount > 0" class="badge badge-primary badge-sm ml-2">{{ pendingCount }}</span>
      </button>
    </div>

    <SkeletonList v-if="!data && pending" :rows="3" />
    <ErrorState v-else-if="error" message="No pudimos cargar los envíos. Revisa tu conexión." @retry="refresh()" />
    <EmptyState
      v-else-if="!data || data.length === 0"
      icon="lucide:inbox"
      :title="EMPTY[tab]"
      :description="tab === 'pending' ? 'Comparte el enlace para invitados y lo que envíen aparecerá aquí.' : ''"
    >
      <button v-if="tab === 'pending'" type="button" class="btn btn-primary" @click="copyGuestLink">Copiar enlace para invitados</button>
    </EmptyState>
    <ul v-else class="flex flex-col gap-3" aria-label="Envíos">
      <li v-for="submission in data" :key="submission.id">
        <SubmissionCard
          :submission="submission"
          :busy="busyId === submission.id"
          @approve="folderId => approve(submission, folderId)"
          @reject="reason => reject(submission, reason)"
        />
      </li>
    </ul>
  </div>
</template>
