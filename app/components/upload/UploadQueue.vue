<script setup lang="ts">
import type { UploadItem, UploadStatus } from '~/composables/useUploader'

defineProps<{ items: UploadItem[] }>()
const emit = defineEmits<{ retry: [id: string], cancel: [id: string] }>()

const STATUS_LABELS: Record<UploadStatus, string> = {
  queued: 'En espera',
  uploading: 'Subiendo',
  verifying: 'Verificando',
  done: 'Listo',
  error: 'Error',
}
</script>

<template>
  <ul class="flex flex-col gap-2" aria-label="Archivos en la cola de subida">
    <li
      v-for="item in items"
      :key="item.id"
      class="flex flex-col gap-2 rounded-box border border-base-300 p-3"
      :class="{ 'border-error/60': item.status === 'error' }"
    >
      <div class="flex items-start gap-3">
        <Icon
          :name="item.status === 'done' ? 'lucide:circle-check' : item.status === 'error' ? 'lucide:circle-alert' : 'lucide:file-up'"
          class="mt-0.5 size-5 shrink-0"
          :class="item.status === 'done' ? 'text-success' : item.status === 'error' ? 'text-error' : 'text-base-content/60'"
          aria-hidden="true"
        />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate font-medium" :title="item.name">{{ item.name }}</span>
          <span class="text-sm text-base-content/70">{{ formatBytes(item.size) }} · {{ STATUS_LABELS[item.status] }}</span>
        </div>
        <button
          v-if="item.status === 'error' && item.retryable"
          type="button"
          class="btn"
          :aria-label="`Reintentar ${item.name}`"
          @click="emit('retry', item.id)"
        >
          <Icon name="lucide:refresh-cw" class="size-4" aria-hidden="true" />
          <span class="hidden sm:inline">Reintentar</span>
        </button>
        <button
          v-if="item.status === 'queued' || item.status === 'uploading' || item.status === 'error'"
          type="button"
          class="btn btn-ghost btn-square"
          :aria-label="item.status === 'error' ? `Quitar ${item.name}` : `Cancelar ${item.name}`"
          @click="emit('cancel', item.id)"
        >
          <Icon name="lucide:x" class="size-4" aria-hidden="true" />
        </button>
      </div>
      <progress
        v-if="item.status === 'uploading' || item.status === 'verifying'"
        class="progress progress-primary w-full"
        :value="item.status === 'verifying' ? undefined : item.progress"
        max="100"
        :aria-label="`Progreso de ${item.name}`"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="item.progress"
      />
      <p v-if="item.error" class="text-sm text-error" role="alert">{{ item.error }}</p>
    </li>
  </ul>
</template>
