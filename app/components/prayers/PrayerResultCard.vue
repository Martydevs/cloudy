<script setup lang="ts">
// Una imagen en curso (feature 007, contracts/ui.md, enmienda de historial): en cola o generándose, un esqueleto con la
// proporción de la plantilla (1376×768) y una barra de progreso; fallida, el motivo en español y **Reintentar** solo si
// sirve; cancelada, **Volver a poner en cola**. Lista, sale de la cola y aparece en el historial (`PrayerHistoryCard`).
import type { PrayerImageItem } from '~/composables/usePrayerImages'

const props = defineProps<{ item: PrayerImageItem }>()
const emit = defineEmits<{ regenerate: [], retry: [], cancel: [], dismiss: [] }>()

const m = messages.prayers
const active = computed(() => props.item.status === 'queued' || props.item.status === 'running')
const titleId = useId()
</script>

<template>
  <article class="card overflow-hidden border border-base-300 bg-base-100" :aria-labelledby="titleId">
    <div class="aspect-[1376/768] w-full bg-base-200">
      <div v-if="active" class="skeleton size-full rounded-none motion-reduce:animate-none" />
      <div v-else class="flex size-full items-center justify-center text-base-content/50">
        <Icon :name="item.status === 'failed' ? 'lucide:image-off' : 'lucide:images'" class="size-10" aria-hidden="true" />
      </div>
    </div>

    <div class="flex flex-col gap-3 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 :id="titleId" class="font-semibold">{{ m.resultAlt(item.index) }}</h3>
        <span class="text-sm text-base-content/70">{{ pluralize(item.requests.length, 'petición', 'peticiones') }}</span>
      </div>

      <template v-if="active">
        <p class="text-sm text-base-content/70" role="status">{{ item.status === 'queued' ? m.queued : m.generating }}</p>
        <progress class="progress progress-primary w-full motion-reduce:animate-none" :aria-label="m.generating" />
      </template>
      <p v-else-if="item.status === 'failed'" class="text-sm text-error" role="alert">{{ item.error ?? m.failed }}</p>

      <div class="flex flex-wrap gap-2">
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
