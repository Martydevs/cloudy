<script setup lang="ts">
import { categoryOf, getExtension } from '#shared/constants/files'
import { can } from '#shared/permissions'
import type { TrashItem, TrashRestoreResult } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['admin', 'editor'] })
useHead({ title: 'Papelera · Cloudy' })

const api = useApi()
const toast = useToast()
const { confirm } = useConfirm()
const { profile } = useMe()
const { data, error, pending, refresh } = await useApiFetch<TrashItem[]>('/api/trash', { lazy: true })

const canEmpty = computed(() => can(profile.value?.role, 'trash.empty'))
const busyId = ref<string | null>(null)
// Referencia de tiempo segura para el SSR; sustituye al util del mismo nombre en esta plantilla.
const { timeAgo } = useRelativeTime()

function itemIcon(item: TrashItem): string {
  if (item.kind === 'folder') return 'lucide:folder'
  const category = categoryOf(getExtension(item.name))
  return category ? fileIcon(category) : 'lucide:file'
}

const location = (path: string[]) => `/${path.join('/')}`
const elements = (n: number) => pluralize(n, 'elemento', 'elementos')
const daysLabel = (days: number) => (days === 0 ? 'Se borra hoy' : days === 1 ? 'Queda 1 día' : `Quedan ${days} días`)

async function run(id: string, task: () => Promise<void>, fallback: string) {
  busyId.value = id
  try {
    await task()
  }
  catch (err) {
    toast.error(serverMessage(err, fallback))
  }
  finally {
    busyId.value = null
    await refresh()
  }
}

const restoreItem = (item: TrashItem) => run(item.id, async () => {
  const { name, restoredTo, movedToRoot } = await api<TrashRestoreResult>(`/api/trash/${item.kind}/${item.id}/restore`, { method: 'POST' })
  const action = { label: 'Ver', to: restoredTo.folderId ? `/archivos/${restoredTo.folderId}` : '/archivos' }
  if (movedToRoot) {
    toast.info(messages.trash.restoredToRoot(name), { action })
    return
  }
  const where = restoredTo.path.length ? location(restoredTo.path) : 'Archivos'
  toast.success(messages.trash.restored(name, where), { action })
}, messages.trash.restoreFailed)

async function purgeItem(item: TrashItem) {
  const content = item.kind === 'folder' && item.itemCount > 0 ? ` y ${elements(item.itemCount)} que contiene` : ''
  const ok = await confirm({
    title: `¿Eliminar definitivamente «${item.name}»?`,
    message: `Se borrará «${item.name}»${content} para siempre. Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar definitivamente',
    danger: true,
  })
  if (!ok) return
  await run(item.id, async () => {
    await api(`/api/trash/${item.kind}/${item.id}`, { method: 'DELETE' })
    toast.success(messages.trash.purged(item.name))
  }, messages.trash.purgeFailed)
}

async function emptyTrash() {
  const ok = await confirm({
    title: '¿Vaciar la papelera?',
    message: 'Todo lo que está en la papelera se borrará para siempre. Esta acción no se puede deshacer.',
    confirmLabel: 'Vaciar papelera',
    danger: true,
  })
  if (!ok) return
  await run('all', async () => {
    const { purged } = await api<{ purged: number }>('/api/trash', { method: 'DELETE' })
    toast.success(messages.trash.emptied(purged))
  }, messages.trash.emptyFailed)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">Papelera</h1>
        <p class="text-base-content/70">Lo eliminado se guarda aquí 30 días. Después se borra automáticamente.</p>
      </div>
      <button
        v-if="canEmpty && data?.length"
        type="button"
        class="btn btn-outline btn-error"
        :disabled="busyId !== null"
        @click="emptyTrash"
      >
        <span v-if="busyId === 'all'" class="loading loading-spinner loading-sm" aria-hidden="true" />
        <Icon v-else name="lucide:trash" class="size-4" aria-hidden="true" />
        Vaciar papelera
      </button>
    </header>

    <SkeletonList v-if="!data && pending" :rows="4" />
    <ErrorState v-else-if="error" :message="messages.load.trash" @retry="refresh()" />
    <EmptyState
      v-else-if="!data || data.length === 0"
      icon="lucide:trash-2"
      title="La papelera está vacía"
      description="Cuando elimines archivos o carpetas, podrás recuperarlos desde aquí durante 30 días."
    >
      <NuxtLink to="/archivos" class="btn btn-primary">Ir a Archivos</NuxtLink>
    </EmptyState>
    <ul v-else class="list rounded-box border border-base-300 bg-base-100" aria-label="Elementos en la papelera">
      <li v-for="item in data" :key="`${item.kind}-${item.id}`" class="list-row items-start">
        <Icon
          :name="itemIcon(item)"
          class="size-8"
          :class="item.kind === 'folder' ? 'text-primary' : 'text-base-content/60'"
          aria-hidden="true"
        />
        <div class="list-col-grow flex min-w-0 flex-col gap-1">
          <span class="font-medium break-words">{{ item.name }}</span>
          <span class="text-sm break-words text-base-content/70">Ubicación original: {{ location(item.originalPath) }}</span>
          <span class="text-xs text-base-content/70">
            {{ item.deletedBy ? `Eliminado por ${item.deletedBy}` : 'Eliminado' }}
            <time :datetime="item.deletedAt" :title="formatDateTime(item.deletedAt)">{{ timeAgo(item.deletedAt) }}</time>
            <template v-if="item.kind === 'folder'"> · {{ elements(item.itemCount) }}</template>
            · {{ formatBytes(item.bytes) }}
          </span>
          <span class="badge mt-1" :class="item.daysLeft <= 7 ? 'badge-warning' : 'badge-ghost'">{{ daysLabel(item.daysLeft) }}</span>
        </div>
        <div class="list-col-wrap flex flex-wrap gap-2">
          <button
            type="button"
            class="btn lg:btn-sm"
            :aria-label="`Restaurar ${item.name}`"
            :disabled="busyId !== null"
            @click="restoreItem(item)"
          >
            <span v-if="busyId === item.id" class="loading loading-spinner loading-sm" aria-hidden="true" />
            <Icon v-else name="lucide:undo-2" class="size-4" aria-hidden="true" />
            Restaurar
          </button>
          <button
            type="button"
            class="btn btn-ghost text-error lg:btn-sm"
            :aria-label="`Eliminar definitivamente ${item.name}`"
            :disabled="busyId !== null"
            @click="purgeItem(item)"
          >
            <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />
            Eliminar definitivamente
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
