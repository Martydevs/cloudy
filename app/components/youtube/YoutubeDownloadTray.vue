<script setup lang="ts">
// Bandeja de descargas de YouTube (feature 005, research D3–D4): una fila por trabajo con su lote, avance, estado por
// video y acciones. Va en el layout `dashboard` como `LazyYoutubeDownloadTray` y es dueña del sondeo.
import { breakpointsTailwind } from '@vueuse/core'
import type { DownloadRow } from '~/composables/useYoutubeDownloads'
import { isActiveDownload } from '~/composables/useYoutubeDownloads'
import { youtubeFormatLabel, YOUTUBE_FORMATS } from '#shared/constants/youtube'

const downloads = useYoutubeDownloads()
useYoutubeDownloadsPolling()
const m = messages.youtube

const collapsed = ref(false)
const titleId = useId()

// La barra de selección del historial se coloca encima de la bandeja: se publica su alto (más el margen de escritorio).
const tray = useTemplateRef<HTMLElement>('tray')
const { height } = useElementSize(tray, undefined, { box: 'border-box' })
const isDesktop = useBreakpoints(breakpointsTailwind).greaterOrEqual('sm')
watchEffect(() => {
  if (import.meta.client) document.documentElement.style.setProperty('--youtube-tray-h', `${Math.ceil(height.value) + (isDesktop.value ? 16 : 0)}px`)
})
onScopeDispose(() => {
  if (import.meta.client) document.documentElement.style.removeProperty('--youtube-tray-h')
})

const STATUS_TEXT: Record<DownloadRow['status'], string> = {
  creating: 'Preparando…',
  queued: 'En cola',
  running: 'Descargando',
  zipping: 'Empaquetando',
  done: 'Listo',
  failed: 'No se pudo descargar',
  expired: 'Expiró',
  paused: 'En pausa',
  cancelled: 'Cancelada',
}

const ITEM_TEXT = { queued: 'En cola', running: 'Descargando', done: 'Listo', failed: 'Falló' } as const

const drive = useYoutubeDriveImport()
const busyCount = computed(() =>
  downloads.rows.value.filter(row => isActiveDownload(row.status)).length
  + drive.list.value.filter(item => drive.isActive(item.stage)).length)

/** Videos con su estado y la calidad entregada cuando 1080p no estaba disponible (FR-007). */
function itemsOf(row: DownloadRow) {
  const requested = YOUTUBE_FORMATS.find(f => f.value === row.format)?.height ?? null
  return (row.job?.items ?? []).map(item => ({
    ...item,
    label: item.title ?? item.videoId,
    delivered: requested && item.actualHeight && item.actualHeight < requested ? m.downloads.delivered(item.actualHeight) : null,
  }))
}

// Anuncios para lectores de pantalla: solo cambios de estado y cada 25 % de avance (no cada 2,5 s).
const announcement = ref('')
const lastSeen = new Map<number, { status: string, quarter: number }>()
watch(() => downloads.rows.value.map(row => ({ id: row.id, status: row.status, progress: row.job?.progress ?? 0, label: row.label, batch: row.batch, total: row.total })), (current) => {
  for (const row of current) {
    const quarter = Math.floor(row.progress / 25)
    const before = lastSeen.get(row.id)
    lastSeen.set(row.id, { status: row.status, quarter })
    const name = row.total > 1 ? `${row.label}, ${m.downloads.batch(row.batch, row.total).toLowerCase()}` : row.label
    if (!before || before.status !== row.status) announcement.value = `${name}: ${STATUS_TEXT[row.status as DownloadRow['status']]}`
    else if (quarter > before.quarter && row.status === 'running') announcement.value = `${name}: ${row.progress} %`
  }
}, { deep: true, immediate: true })

// Importaciones al drive: se anuncia solo el cambio de etapa (en cola, listo, falló), no cada avance.
const driveStages = new Map<string, string>()
watch(() => drive.list.value.map(item => ({ videoId: item.videoId, title: item.title, stage: item.stage })), (current) => {
  for (const { videoId, title, stage } of current) {
    if (driveStages.get(videoId) === stage) continue
    driveStages.set(videoId, stage)
    const text = stage === 'done' ? 'Guardado en el drive' : stage === 'error' ? 'No se pudo guardar' : stage === 'queued' ? m.drive.queued : null
    if (text) announcement.value = `${title}: ${text}`
  }
}, { immediate: true })
</script>

<template>
  <section
    ref="tray"
    class="fixed inset-x-0 bottom-0 z-40 border-t border-base-300 bg-base-100 shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96 sm:rounded-box sm:border"
    :aria-labelledby="titleId"
  >
    <header class="flex items-center gap-2 px-4 py-2">
      <Icon name="lucide:download" class="size-5 text-primary" aria-hidden="true" />
      <h2 :id="titleId" class="flex-1 font-semibold">
        Descargas
        <span v-if="busyCount" class="badge badge-primary badge-soft ml-1">{{ busyCount }} en curso</span>
      </h2>
      <button
        type="button"
        class="btn btn-ghost btn-square"
        :aria-label="collapsed ? 'Mostrar descargas' : 'Ocultar descargas'"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        <Icon :name="collapsed ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="size-5" aria-hidden="true" />
      </button>
    </header>
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
    <ul v-show="!collapsed" class="flex max-h-[45dvh] flex-col gap-3 overflow-y-auto px-4 pb-4 sm:max-h-[60dvh]" aria-label="Trabajos de descarga">
      <li v-for="row in downloads.rows.value" :key="row.id" class="flex flex-col gap-2 rounded-box border border-base-300 p-3">
        <div class="flex items-start gap-2">
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="break-words font-medium">{{ row.label }}</span>
            <span class="text-sm text-base-content/70">{{ [youtubeFormatLabel(row.format), row.total > 1 ? m.downloads.batch(row.batch, row.total) : null, STATUS_TEXT[row.status]].filter(Boolean).join(' · ') }}</span>
          </div>
          <button
            v-if="!isActiveDownload(row.status)"
            type="button"
            class="btn btn-ghost btn-square"
            :aria-label="`Cerrar ${row.label}`"
            @click="downloads.dismiss(row.id)"
          >
            <Icon name="lucide:x" class="size-5" aria-hidden="true" />
          </button>
        </div>

        <progress
          v-if="isActiveDownload(row.status)"
          class="progress progress-primary w-full"
          :value="row.job?.progress ?? 0"
          max="100"
          :aria-label="`Avance de ${row.label}`"
        />

        <p v-if="row.message" class="text-sm" :class="row.status === 'paused' ? 'text-base-content/80' : 'text-error'">{{ row.message }}</p>
        <ul v-if="row.rejected.length" class="list-disc pl-5 text-sm">
          <li v-for="video in row.rejected" :key="video.videoId">{{ video.videoId }}: {{ video.message }}</li>
        </ul>

        <ul v-if="row.job && row.job.items.length > 1 || itemsOf(row).some(i => i.error || i.delivered)" class="flex flex-col gap-1 text-sm">
          <li v-for="item in itemsOf(row)" :key="item.videoId" class="flex flex-col">
            <span class="flex items-center gap-2">
              <Icon
                :name="item.status === 'done' ? 'lucide:circle-check' : item.status === 'failed' ? 'lucide:circle-x' : 'lucide:circle-dashed'"
                class="size-4 shrink-0"
                :class="item.status === 'done' ? 'text-success' : item.status === 'failed' ? 'text-error' : 'text-base-content/60'"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate" :title="item.label">{{ item.label }}</span>
              <span class="shrink-0 text-base-content/70">{{ item.delivered ?? ITEM_TEXT[item.status] }}</span>
            </span>
            <!-- Si la fila ya dice esa misma causa (un solo lote que falló entero), no se repite en cada video. -->
            <span v-if="item.error && item.error.message !== row.message" class="pl-6 text-error">{{ item.error.message }}</span>
          </li>
        </ul>

        <div class="flex flex-wrap gap-2">
          <button v-if="row.status === 'done'" type="button" class="btn btn-primary btn-block sm:w-auto" @click="downloads.saveAgain(row.id)">
            <Icon name="lucide:save" class="size-4" aria-hidden="true" />
            Guardar archivo
          </button>
          <button v-if="isActiveDownload(row.status)" type="button" class="btn btn-block sm:w-auto" @click="downloads.cancel(row.id)">
            Cancelar
          </button>
          <button v-if="row.status === 'paused'" type="button" class="btn btn-block sm:w-auto" @click="downloads.retry(row.id)">
            <Icon name="lucide:refresh-cw" class="size-4" aria-hidden="true" />
            Reintentar
          </button>
          <button
            v-if="row.status === 'expired' || (row.status === 'failed' && !row.rejected.length)"
            type="button"
            class="btn btn-block sm:w-auto"
            @click="downloads.retry(row.id)"
          >
            <Icon name="lucide:rotate-ccw" class="size-4" aria-hidden="true" />
            Preparar de nuevo
          </button>
        </div>
      </li>
      <li v-if="drive.hasImports.value" class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-base-content/70">{{ m.drive.trayTitle }}</h3>
        <ul class="flex flex-col gap-3" :aria-label="m.drive.trayTitle">
          <YoutubeDriveImportRow
            v-for="item in drive.list.value"
            :key="item.videoId"
            :item="item"
            @retry="drive.retry"
            @dismiss="drive.dismiss"
            @cancel="drive.cancel"
          />
        </ul>
      </li>
    </ul>
  </section>
</template>
