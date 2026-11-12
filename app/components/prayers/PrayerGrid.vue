<script setup lang="ts">
// Rejilla de peticiones (feature 007, contracts/ui.md): tarjetas en una rejilla CSS (nunca tabla) y, al final, el centinela
// del desplazamiento infinito con sus estados: esqueletos mientras carga, error con «Reintentar» (sin perder lo cargado),
// «Cargar más» para teclado y el aviso de fin.
import type { PrayerRequest } from '#shared/types/api'
import { isSelectable } from '#shared/prayers'

const props = defineProps<{
  items: PrayerRequest[]
  loadingMore: boolean
  moreError: boolean
  done: boolean
  isSelected: (id: string) => boolean
  limitReached: boolean
}>()
const emit = defineEmits<{ 'toggle': [request: PrayerRequest], 'fix': [request: PrayerRequest], 'load-more': [], 'retry-more': [] }>()

const m = messages.prayers

/** Sin texto no se puede elegir; con el tope, solo las ya elegidas siguen activas. */
function reason(request: PrayerRequest): string | null {
  if (props.isSelected(request.id)) return null
  if (!isSelectable(request)) return m.noText
  return props.limitReached ? m.limitReached : null
}

// Página siguiente cuando el centinela se acerca a la pantalla.
const sentinel = useTemplateRef<HTMLElement>('sentinel')
const sentinelVisible = useElementVisibility(sentinel, { rootMargin: '400px' })
watch(sentinelVisible, (visible) => {
  if (visible && !props.done && !props.moreError) emit('load-more')
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Peticiones aprobadas">
      <li v-for="(request, index) in items" :key="request.id" class="flex flex-col">
        <PrayerCard
          class="h-full"
          :request="request"
          :priority="index === 0"
          :selected="isSelected(request.id)"
          :disabled="!!reason(request)"
          :disabled-reason="reason(request)"
          @toggle="emit('toggle', request)"
          @fix="emit('fix', request)"
        />
      </li>
    </ul>

    <div ref="sentinel" class="flex min-h-11 flex-col items-center gap-4">
      <div v-if="loadingMore" class="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" role="status" :aria-label="m.loadMore">
        <PrayerCardSkeleton v-for="n in 3" :key="n" />
      </div>
      <ErrorState v-else-if="moreError" class="w-full" :message="m.loadMoreError" @retry="emit('retry-more')" />
      <p v-else-if="done" class="py-2 text-sm text-base-content/70">{{ m.end }}</p>
      <button v-else type="button" class="btn" @click="emit('load-more')">Cargar más</button>
    </div>
  </div>
</template>
