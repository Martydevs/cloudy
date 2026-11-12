<script setup lang="ts">
// Una imagen generada (feature 007, contracts/ui.md): mientras se genera, un esqueleto con la proporción de la plantilla
// (1376×768) y una barra de progreso; lista, la vista previa con sus acciones; fallida, el motivo en español y
// **Reintentar** solo si sirve.
import type { PrayerImageItem } from '~/composables/usePrayerImages'

const props = defineProps<{ item: PrayerImageItem }>()
const emit = defineEmits<{ download: [], regenerate: [], retry: [], cancel: [], dismiss: [], preview: [] }>()

const m = messages.prayers
const active = computed(() => props.item.status === 'queued' || props.item.status === 'running')
const titleId = useId()
</script>

<template>
  <article class="card overflow-hidden border border-base-300 bg-base-100" :aria-labelledby="titleId">
    <div class="aspect-[1376/768] w-full bg-base-200">
      <img v-if="item.status === 'done' && item.url" :src="item.url" :alt="m.resultAlt(item.index)" class="size-full object-contain">
      <div v-else-if="active" class="skeleton size-full rounded-none motion-reduce:animate-none" />
      <div v-else class="flex size-full items-center justify-center text-base-content/50">
        <Icon :name="item.status === 'failed' ? 'lucide:image-off' : 'lucide:images'" class="size-10" aria-hidden="true" />
      </div>
    </div>

    <div class="flex flex-col gap-3 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 :id="titleId" class="font-semibold">{{ m.resultAlt(item.index) }}</h3>
        <span class="text-sm text-base-content/70">{{ pluralize(item.fileIds.length, 'petición', 'peticiones') }}</span>
      </div>

      <template v-if="active">
        <p class="text-sm text-base-content/70" role="status">{{ item.status === 'queued' ? m.queued : m.generating }}</p>
        <progress class="progress progress-primary w-full motion-reduce:animate-none" :aria-label="m.generating" />
      </template>
      <p v-else-if="item.status === 'failed'" class="text-sm text-error" role="alert">{{ item.error ?? m.failed }}</p>

      <div class="flex flex-wrap gap-2">
        <template v-if="item.status === 'done'">
          <button type="button" class="btn btn-primary" @click="emit('download')">
            <Icon name="lucide:download" class="size-5" aria-hidden="true" />
            {{ m.download }}
          </button>
          <button type="button" class="btn" @click="emit('preview')">
            <Icon name="lucide:maximize-2" class="size-5" aria-hidden="true" />
            {{ m.preview }}
          </button>
          <button type="button" class="btn" @click="emit('regenerate')">
            <Icon name="lucide:refresh-cw" class="size-5" aria-hidden="true" />
            {{ m.regenerate }}
          </button>
        </template>
        <button v-if="item.status === 'failed' && item.retryable" type="button" class="btn btn-primary" @click="emit('retry')">
          <Icon name="lucide:refresh-cw" class="size-5" aria-hidden="true" />
          {{ m.retry }}
        </button>
        <button v-if="item.status === 'canceled'" type="button" class="btn" @click="emit('regenerate')">
          <Icon name="lucide:refresh-cw" class="size-5" aria-hidden="true" />
          {{ m.regenerate }}
        </button>
        <button v-if="active" type="button" class="btn" @click="emit('cancel')">{{ m.cancel }}</button>
        <button v-else type="button" class="btn btn-ghost" @click="emit('dismiss')">{{ m.dismiss }}</button>
      </div>
    </div>
  </article>
</template>
