<script setup lang="ts">
// Una fila de «Guardar en el drive» en la bandeja: título, etapa con su avance, y al terminar el enlace al drive o el
// motivo del fallo con «Reintentar». Se puede cerrar cuando ya no está en curso.
import type { DriveImport } from '~/composables/useYoutubeDriveImport'
import { youtubeFormatLabel } from '#shared/constants/youtube'

const props = defineProps<{ item: DriveImport }>()
const emit = defineEmits<{ retry: [videoId: string], dismiss: [videoId: string], cancel: [videoId: string] }>()

const drive = useYoutubeDriveImport()
const m = messages.youtube.drive
const active = computed(() => drive.isActive(props.item.stage))
const stageText = computed(() => {
  const { stage } = props.item
  return stage === 'queued' || stage === 'preparing' || stage === 'downloading' || stage === 'uploading' ? m[stage] : null
})
</script>

<template>
  <li class="flex flex-col gap-2 rounded-box border border-base-300 p-3">
    <div class="flex items-start gap-2">
      <Icon name="lucide:hard-drive-upload" class="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="break-words font-medium">{{ item.title }}</span>
        <span class="text-sm text-base-content/70">{{ youtubeFormatLabel(item.format) }}<template v-if="stageText"> · {{ stageText }}</template></span>
      </div>
      <button
        v-if="!active"
        type="button"
        class="btn btn-ghost btn-square"
        :aria-label="`Cerrar ${item.title}`"
        @click="emit('dismiss', item.videoId)"
      >
        <Icon name="lucide:x" class="size-5" aria-hidden="true" />
      </button>
    </div>

    <progress
      v-if="item.stage !== 'queued' && active"
      class="progress progress-primary w-full"
      :value="item.progress"
      max="100"
      :aria-label="`Avance de ${item.title}`"
    />

    <p v-if="item.stage === 'error'" role="alert" class="text-sm text-error">{{ item.message }}</p>
    <p v-else-if="item.stage === 'done'" class="flex items-center gap-1 text-sm">
      <Icon name="lucide:circle-check" class="size-4 shrink-0 text-success" aria-hidden="true" />
      {{ m.done(item.message ?? '') }}
    </p>

    <div v-if="active" class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-block sm:w-auto" :aria-label="`${m.cancel} ${item.title}`" @click="emit('cancel', item.videoId)">
        {{ m.cancel }}
      </button>
    </div>

    <div v-if="item.stage === 'error' || item.stage === 'done'" class="flex flex-wrap gap-2">
      <button v-if="item.stage === 'error'" type="button" class="btn btn-block sm:w-auto" @click="emit('retry', item.videoId)">
        <Icon name="lucide:rotate-ccw" class="size-4" aria-hidden="true" />
        {{ m.retry }}
      </button>
      <NuxtLink v-else to="/archivos" class="btn btn-block sm:w-auto">
        <Icon name="lucide:folder-open" class="size-4" aria-hidden="true" />
        {{ m.view }}
      </NuxtLink>
    </div>
  </li>
</template>
