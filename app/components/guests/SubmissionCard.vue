<script setup lang="ts">
import type { Submission } from '#shared/types/api'
import { daysLeft } from '#shared/retention'
import { getExtension } from '#shared/constants/files'

const props = defineProps<{ submission: Submission, busy?: boolean }>()
const emit = defineEmits<{ approve: [folderId: string | null], reject: [reason: string] }>()
// Referencia de tiempo segura para el SSR; sustituye al util del mismo nombre en esta plantilla.
const { timeAgo } = useRelativeTime()

const picking = ref(false)
const rejecting = ref(false)
const reason = ref('')
const rejectDialog = useTemplateRef<HTMLDialogElement>('rejectDialog')
const rejectTitleId = useId()
const reasonId = useId()

/**
 * Imágenes con su texto leído (feature 002), solo mientras el envío está pendiente: al aprobarlo el texto
 * pasa al archivo y al rechazarlo se elimina. El resto de archivos no tiene panel.
 */
const images = computed(() => props.submission.status === 'pending' ? props.submission.files.filter(f => f.category === 'image') : [])

const left = computed(() => daysLeft(props.submission.expiresAt))
const expiry = computed(() => left.value === 0 ? 'caduca hoy' : left.value === 1 ? 'caduca en 1 día' : `caduca en ${left.value} días`)

const STATUS: Record<Submission['status'], { label: string, badge: string }> = {
  pending: { label: 'Pendiente', badge: 'badge-warning' },
  approved: { label: 'Aprobado', badge: 'badge-success badge-soft' },
  rejected: { label: 'Rechazado', badge: 'badge-ghost' },
  expired: { label: 'Caducado', badge: 'badge-ghost' },
}

function openReject() {
  reason.value = ''
  rejecting.value = true
  nextTick(() => rejectDialog.value?.showModal())
}

function closeReject() {
  rejectDialog.value?.close()
  rejecting.value = false
}

function confirmReject() {
  emit('reject', reason.value.trim())
  closeReject()
}
</script>

<template>
  <article class="card border border-base-300 bg-base-100" :aria-label="`Envío de ${submission.senderName}`">
    <div class="card-body gap-3 p-4">
      <header class="flex flex-wrap items-center gap-2">
        <h2 class="min-w-0 flex-1 truncate text-lg font-semibold">{{ submission.senderName }}</h2>
        <span class="badge" :class="STATUS[submission.status].badge">{{ STATUS[submission.status].label }}</span>
      </header>
      <p class="text-sm text-base-content/70">
        {{ timeAgo(submission.createdAt) }}
        <template v-if="submission.status === 'pending'"> · {{ expiry }}</template>
        · {{ pluralize(submission.files.length, 'archivo', 'archivos') }}
      </p>
      <p v-if="submission.note" class="whitespace-pre-line break-words">{{ submission.note }}</p>

      <ul class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label="Archivos del envío">
        <li v-for="file in submission.files" :key="file.id" class="flex flex-col gap-1">
          <a :href="file.previewUrl" target="_blank" rel="noopener" class="flex aspect-square items-center justify-center overflow-hidden rounded-field bg-base-200" :aria-label="`Abrir ${file.name}`">
            <img v-if="file.category === 'image'" :src="file.previewUrl" :alt="file.name" loading="lazy" decoding="async" width="160" height="160" class="size-full object-cover">
            <Icon v-else :name="fileIcon(file.category)" class="size-8 text-base-content/60" aria-hidden="true" />
          </a>
          <span class="truncate text-xs" :title="file.name">{{ file.name }}</span>
          <span class="text-xs text-base-content/70">{{ formatBytes(file.size) }}</span>
        </li>
      </ul>

      <!-- Texto de cada imagen (feature 002): solo lectura. -->
      <div v-if="images.length" class="flex flex-col gap-2">
        <LazyImageTextPanel
          v-for="file in images"
          :key="file.id"
          :endpoint="`/api/submissions/${submission.id}/files/${file.id}/text`"
          :initial="file.text"
          :title="`Texto de «${file.name}»`"
          :heic="getExtension(file.name) === 'heic'"
          auto-read
          :editable="false"
          compact
        />
      </div>

      <div v-if="submission.status === 'pending'" class="card-actions justify-end">
        <button type="button" class="btn" :disabled="busy" @click="openReject">
          <Icon name="lucide:x" class="size-4" aria-hidden="true" />
          Rechazar
        </button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="picking = true">
          <span v-if="busy" class="loading loading-spinner loading-sm" aria-hidden="true" />
          <Icon v-else name="lucide:check" class="size-4" aria-hidden="true" />
          Aprobar
        </button>
      </div>
    </div>

    <LazyFolderPicker
      v-if="picking"
      title="Aprobar hacia…"
      confirm-label="Aprobar aquí"
      @select="folderId => { picking = false; emit('approve', folderId) }"
      @close="picking = false"
    />

    <dialog v-if="rejecting" ref="rejectDialog" class="modal modal-bottom sm:modal-middle" :aria-labelledby="rejectTitleId" @cancel.prevent="closeReject">
      <form class="modal-box flex flex-col gap-3" @submit.prevent="confirmReject">
        <h3 :id="rejectTitleId" class="text-lg font-semibold">¿Rechazar el envío de {{ submission.senderName }}?</h3>
        <p class="text-sm text-base-content/70">Los archivos se eliminarán y no se podrán recuperar.</p>
        <label :for="reasonId" class="label">Motivo (opcional)</label>
        <textarea :id="reasonId" v-model="reason" class="textarea w-full" rows="2" maxlength="300" />
        <div class="modal-action mt-0">
          <button type="button" class="btn" @click="closeReject">Cancelar</button>
          <button type="submit" class="btn btn-error">Rechazar envío</button>
        </div>
      </form>
    </dialog>
  </article>
</template>
