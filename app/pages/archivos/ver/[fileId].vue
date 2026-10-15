<script setup lang="ts">
import type { FileItem } from '#shared/types/api'
import type { ItemAction } from '~/utils/file-actions'

definePageMeta({
  layout: 'dashboard',
  access: 'private',
  validate: route => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(route.params.fileId)),
})

const route = useRoute()
const fileId = computed(() => String(route.params.fileId))
const { data: file, error, refresh } = await useApiFetch<FileItem>(() => `/api/files/${fileId.value}`, { lazy: true })

useHead({ title: computed(() => `${file.value?.name ?? 'Archivo'} · Cloudy`) })

const folderLink = computed(() => (file.value?.folderId ? `/archivos/${file.value.folderId}` : '/archivos'))
const notFound = computed(() => (error.value as { statusCode?: number } | null)?.statusCode === 404)

const actions = useItemActions((change) => {
  if (change === 'trashed') navigateTo(folderLink.value)
  else refresh()
})

const menu = computed(() => (file.value ? fileMenuItems(file.value.id, { includeOpen: false }) : []))

function onSelect(key: string) {
  if (!file.value) return
  const action = key as ItemAction
  if (action === 'rename' || action === 'move') actions.open({ type: action, kind: 'file', item: file.value })
  else if (action === 'trash') actions.trash('file', file.value)
}

const ORIGIN_LABELS = { team: 'Equipo', guest: 'Invitado' } as const
</script>

<template>
  <div class="flex flex-col gap-4">
    <NuxtLink :to="folderLink" class="btn btn-ghost self-start">
      <Icon name="lucide:arrow-left" class="size-4" aria-hidden="true" />
      {{ file?.path?.length ? file.path[file.path.length - 1] : 'Archivos' }}
    </NuxtLink>

    <SkeletonList v-if="!file && !error" :rows="4" />
    <EmptyState
      v-else-if="notFound"
      icon="lucide:file-x"
      title="Este archivo ya no está disponible"
      description="Puede que lo hayan movido a la papelera."
    >
      <NuxtLink to="/archivos" class="btn">Ir a Archivos</NuxtLink>
    </EmptyState>
    <ErrorState v-else-if="error" message="No pudimos cargar el archivo." @retry="refresh()" />
    <div v-else-if="file" class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <section aria-label="Vista previa" class="min-w-0">
        <FilePreview :file="file" />
      </section>

      <aside class="flex flex-col gap-4">
        <div class="card border border-base-300 bg-base-100">
          <div class="card-body gap-4">
            <div class="flex items-start gap-2">
              <h1 class="min-w-0 flex-1 break-words text-xl font-semibold">{{ file.name }}</h1>
              <ActionMenu :label="`Más acciones de ${file.name}`" :items="menu" @select="onSelect" />
            </div>
            <a :href="`/api/files/${file.id}/content?download=1`" class="btn btn-primary" download>
              <Icon name="lucide:download" class="size-4" aria-hidden="true" />
              Descargar
            </a>
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt class="text-base-content/70">Subido por</dt>
              <dd>{{ file.uploadedBy?.name ?? file.guestName ?? 'Invitado' }}</dd>
              <dt class="text-base-content/70">Fecha</dt>
              <dd>
                <time :datetime="file.createdAt">{{ new Date(file.createdAt).toLocaleString('es') }}</time>
              </dd>
              <dt class="text-base-content/70">Tamaño</dt>
              <dd>{{ formatBytes(file.sizeBytes) }}</dd>
              <dt class="text-base-content/70">Tipo</dt>
              <dd>{{ CATEGORY_LABELS[file.category] }} · .{{ file.extension }}</dd>
              <dt class="text-base-content/70">Origen</dt>
              <dd>
                <span class="badge" :class="file.origin === 'guest' ? 'badge-secondary' : 'badge-ghost'">{{ ORIGIN_LABELS[file.origin] }}</span>
              </dd>
              <dt class="text-base-content/70">Carpeta</dt>
              <dd class="break-words">{{ file.path?.length ? file.path.join(' / ') : 'Archivos (raíz)' }}</dd>
            </dl>
          </div>
        </div>
        <!-- Los comentarios (US8) se montan aquí. -->
      </aside>
    </div>

    <ItemDialogs :actions="actions" />
  </div>
</template>
