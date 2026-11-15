<script setup lang="ts">
// La diapositiva grande de una generación (enmienda «Página de generación», 2026-11-15). Lista: la imagen guardada,
// ocupando la caja de proporción fija del escenario, con un esqueleto hasta que carga y «Sin vista previa» si falla. En
// cola o generándose: esqueleto y estado. Fallida: el motivo y **Reintentar** si sirve. Cancelada: **Volver a poner en
// cola**. Sin terminar: qué pasó y **Generar las faltantes**. La página la monta con `:key` por diapositiva.
import type { PrayerGenerationSlide } from '~/composables/usePrayerGeneration'

const props = withDefaults(defineProps<{
  slide: PrayerGenerationSlide
  /** Primera pintura: la imagen es el LCP y va con prioridad alta. */
  priority?: boolean
}>(), { priority: false })
const emit = defineEmits<{ retry: [], cancel: [], requeue: [], dismiss: [], missing: [] }>()

const m = messages.prayers
const g = messages.prayers.generation
const img = useTemplateRef<HTMLImageElement>('img')
const loaded = ref(false)
const failed = ref(false)
const alt = computed(() => g.slideAlt(props.slide.index, m.history.count(props.slide.fileIds.length)))

// La imagen del SSR pudo terminar de cargar (o fallar) antes de hidratar: sus eventos ya pasaron.
onMounted(() => {
  const el = img.value
  if (!el?.complete) return
  if (el.naturalWidth > 0) loaded.value = true
  else failed.value = true
})
</script>

<template>
  <div class="absolute inset-0">
    <template v-if="slide.state === 'ready' && slide.image">
      <div v-if="failed" class="flex size-full flex-col items-center justify-center gap-2 text-base-content/70">
        <Icon name="lucide:image-off" class="size-10" aria-hidden="true" />
        <span>{{ m.noPreview }}</span>
      </div>
      <template v-else>
        <div v-if="!loaded" class="skeleton absolute inset-0 rounded-none motion-reduce:animate-none" aria-hidden="true" />
        <img
          ref="img"
          :src="slide.image.previewUrl"
          :alt="alt"
          decoding="async"
          :fetchpriority="priority ? 'high' : 'auto'"
          class="relative size-full object-contain"
          @load="loaded = true"
          @error="failed = true"
        >
      </template>
    </template>

    <div v-else-if="slide.state === 'queued' || slide.state === 'running'" class="relative size-full">
      <div class="skeleton absolute inset-0 rounded-none motion-reduce:animate-none" aria-hidden="true" />
      <!-- `px-14`: los botones ‹ › del escenario quedan encima de los bordes. -->
      <div class="relative flex size-full flex-col items-center justify-center gap-2 overflow-y-auto px-14 py-3 text-center sm:gap-3">
        <span class="loading loading-spinner loading-md text-primary motion-reduce:animate-none" aria-hidden="true" />
        <p class="max-w-sm font-medium">{{ slide.state === 'queued' ? g.queuedHint : g.runningHint }}</p>
        <button type="button" class="btn" @click="emit('cancel')">{{ m.cancel }}</button>
      </div>
    </div>

    <div v-else class="flex size-full flex-col items-center justify-center gap-2 overflow-y-auto px-14 py-3 text-center sm:gap-3">
      <Icon :name="slide.state === 'failed' ? 'lucide:image-off' : 'lucide:images'" class="size-8 shrink-0 text-base-content/60 sm:size-10" aria-hidden="true" />
      <template v-if="slide.state === 'failed'">
        <p class="max-w-md text-error" role="alert">{{ slide.item?.error ?? m.failed }}</p>
        <div class="flex flex-wrap justify-center gap-2">
          <button v-if="slide.item?.retryable" type="button" class="btn btn-primary" @click="emit('retry')">
            <Icon name="lucide:refresh-cw" class="size-5" aria-hidden="true" />
            {{ m.retry }}
          </button>
          <button type="button" class="btn btn-ghost" @click="emit('dismiss')">{{ m.dismiss }}</button>
        </div>
      </template>
      <template v-else-if="slide.state === 'canceled'">
        <p class="max-w-md">{{ g.canceledHint }}</p>
        <button type="button" class="btn btn-primary" @click="emit('requeue')">
          <Icon name="lucide:refresh-cw" class="size-5" aria-hidden="true" />
          {{ m.regenerate }}
        </button>
      </template>
      <template v-else>
        <p class="font-semibold">{{ g.unfinishedTitle }}</p>
        <p class="max-w-md text-base-content/80">{{ g.unfinishedHint }}</p>
        <button type="button" class="btn btn-primary" @click="emit('missing')">
          <Icon name="lucide:sparkles" class="size-5" aria-hidden="true" />
          {{ g.generateMissing }}
        </button>
      </template>
    </div>
  </div>
</template>
