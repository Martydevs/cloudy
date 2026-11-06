<script setup lang="ts">
// Bandeja de presentaciones de Canciones (feature 006, research D10): una fila por canción con su estado, las diapositivas, la
// nota del reparto de respaldo y sus acciones. Va diferida en el layout `dashboard` (`LazySongPresentationTray`). Si la bandeja
// de YouTube también está abierta, se apoya encima (`--youtube-tray-h`) y publica su propio alto en `--song-tray-h`.
import { breakpointsTailwind } from '@vueuse/core'
import type { PresentationItem } from '~/composables/useSongPresentations'

const presentations = useSongPresentations()
const m = messages.songs.present

const collapsed = ref(false)
const titleId = useId()

const tray = useTemplateRef<HTMLElement>('tray')
const { height } = useElementSize(tray, undefined, { box: 'border-box' })
const isDesktop = useBreakpoints(breakpointsTailwind).greaterOrEqual('sm')
watchEffect(() => {
  if (import.meta.client) document.documentElement.style.setProperty('--song-tray-h', `${Math.ceil(height.value) + (isDesktop.value ? 16 : 0)}px`)
})
onScopeDispose(() => {
  if (import.meta.client) document.documentElement.style.removeProperty('--song-tray-h')
})

const STATUS_TEXT: Record<PresentationItem['status'], string> = {
  queued: m.queued,
  running: m.running,
  done: 'Lista',
  failed: 'No se pudo generar',
  canceled: m.cancelled,
}

const busyCount = computed(() => presentations.items.value.filter(item => item.status === 'queued' || item.status === 'running').length)

// Anuncio para lectores de pantalla: solo los cambios de estado.
const announcement = ref('')
const seen = new Map<string, string>()
watch(() => presentations.items.value.map(item => ({ songId: item.songId, title: item.title, status: item.status, slides: item.slides ?? null })), (current) => {
  for (const item of current) {
    if (seen.get(item.songId) === item.status) continue
    seen.set(item.songId, item.status)
    announcement.value = `${item.title}: ${item.status === 'done' ? m.done(item.slides) : STATUS_TEXT[item.status]}`
  }
}, { immediate: true })
</script>

<template>
  <section
    ref="tray"
    class="fixed inset-x-0 bottom-[var(--youtube-tray-h,0px)] z-40 border-t border-base-300 bg-base-100 shadow-2xl sm:inset-x-auto sm:bottom-[calc(var(--youtube-tray-h,0px)+1rem)] sm:right-4 sm:w-96 sm:rounded-box sm:border"
    :aria-labelledby="titleId"
  >
    <header class="flex items-center gap-2 px-4 py-2">
      <Icon name="lucide:presentation" class="size-5 text-primary" aria-hidden="true" />
      <h2 :id="titleId" class="flex-1 font-semibold">
        {{ m.trayTitle }}
        <span v-if="busyCount" class="badge badge-primary badge-soft ml-1">{{ busyCount }} en curso</span>
      </h2>
      <button
        type="button"
        class="btn btn-ghost btn-square"
        :aria-label="collapsed ? 'Mostrar presentaciones' : 'Ocultar presentaciones'"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        <Icon :name="collapsed ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="size-5" aria-hidden="true" />
      </button>
    </header>
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
    <ul v-show="!collapsed" class="flex max-h-[40dvh] flex-col gap-3 overflow-y-auto px-4 pb-4 sm:max-h-[50dvh]" aria-label="Presentaciones de canciones">
      <li v-for="item in presentations.items.value" :key="item.songId" class="flex flex-col gap-2 rounded-box border border-base-300 p-3">
        <div class="flex min-w-0 flex-col">
          <span class="break-words font-medium">{{ item.title }}</span>
          <span class="text-sm text-base-content/70">{{ item.status === 'done' ? m.done(item.slides ?? null) : STATUS_TEXT[item.status] }}</span>
        </div>

        <progress v-if="item.status === 'running'" class="progress progress-primary w-full" :aria-label="`Generando ${item.title}`" />

        <p v-if="item.status === 'done' && item.arrangedBy === 'fallback'" class="text-sm text-base-content/80">{{ m.fallback }}</p>
        <p v-if="item.status === 'failed' && item.error" class="text-sm text-error">{{ item.error }}</p>

        <div class="flex flex-wrap gap-2">
          <button v-if="item.status === 'queued' || item.status === 'running'" type="button" class="btn lg:btn-sm" @click="presentations.cancel(item.songId)">
            <Icon name="lucide:x" class="size-4" aria-hidden="true" />
            {{ m.cancel }}
          </button>
          <button v-if="item.status === 'failed' && item.retryable" type="button" class="btn btn-primary lg:btn-sm" @click="presentations.retry(item.songId)">
            <Icon name="lucide:refresh-cw" class="size-4" aria-hidden="true" />
            {{ m.retry }}
          </button>
          <button v-if="item.status === 'done' && presentations.canRedownload(item.songId)" type="button" class="btn lg:btn-sm" @click="presentations.redownload(item.songId)">
            <Icon name="lucide:download" class="size-4" aria-hidden="true" />
            {{ m.redownload }}
          </button>
          <button
            v-if="item.status !== 'queued' && item.status !== 'running'"
            type="button"
            class="btn btn-ghost lg:btn-sm"
            :aria-label="`${m.dismiss} ${item.title}`"
            @click="presentations.dismiss(item.songId)"
          >
            <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />
            {{ m.dismiss }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
