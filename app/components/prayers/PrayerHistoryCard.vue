<script setup lang="ts">
// Una imagen del historial (feature 007, enmienda de historial): la imagen guardada en una caja con la proporción de la
// plantilla (1376×768), cuántas peticiones lleva, cuándo y quién la generó, **Descargar** (un enlace: el servidor redirige a
// la URL firmada con `Content-Disposition`), **Ver en grande** y el menú con **Guardar en colección**, **Generar de nuevo** y
// **Eliminar** (solo su autora o un administrador). No hay miniatura: el `src` llega cuando la tarjeta se acerca a la pantalla.
import type { PrayerGeneratedImage } from '#shared/types/api'
import type { ActionMenuItem } from '~/components/ui/ActionMenu.vue'

const props = withDefaults(defineProps<{ image: PrayerGeneratedImage, canRemove?: boolean }>(), { canRemove: false })
const emit = defineEmits<{ preview: [], collection: [], regenerate: [], remove: [] }>()

const m = messages.prayers
const h = messages.prayers.history
const { timeAgo } = useRelativeTime()
const titleId = useId()

const root = useTemplateRef<HTMLElement>('root')
const near = useElementVisibility(root, { rootMargin: '200px', once: true })
const failed = ref(false)

const ago = computed(() => timeAgo(props.image.createdAt))
const author = computed(() => (props.image.author.active ? props.image.author.name : messages.youtube.inactiveUser))
const count = computed(() => h.count(props.image.requestCount))
const alt = computed(() => h.alt(count.value, ago.value))

const menu = computed<ActionMenuItem[]>(() => [
  { key: 'collection', label: h.saveTo, icon: 'lucide:list-plus' },
  { key: 'regenerate', label: m.regenerate, icon: 'lucide:refresh-cw' },
  ...(props.canRemove ? [{ key: 'remove', label: h.remove, icon: 'lucide:trash-2', danger: true }] : []),
])

function onSelect(key: string) {
  if (key === 'collection') emit('collection')
  else if (key === 'regenerate') emit('regenerate')
  else if (key === 'remove') emit('remove')
}
</script>

<template>
  <article ref="root" class="card overflow-hidden border border-base-300 bg-base-100" :aria-labelledby="titleId">
    <div class="aspect-[1376/768] w-full bg-base-200">
      <img
        v-if="near && !failed"
        :src="image.previewUrl"
        :alt="alt"
        decoding="async"
        loading="lazy"
        class="size-full object-contain"
        @error="failed = true"
      >
      <div v-else-if="failed" class="flex size-full flex-col items-center justify-center gap-2 text-base-content/70">
        <Icon name="lucide:image-off" class="size-8" aria-hidden="true" />
        <span class="text-sm">{{ m.noPreview }}</span>
      </div>
      <div v-else class="skeleton size-full rounded-none motion-reduce:animate-none" />
    </div>

    <div class="flex flex-col gap-3 p-4">
      <div class="flex min-w-0 flex-col">
        <h3 :id="titleId" class="font-semibold">{{ count }}</h3>
        <p class="break-words text-sm text-base-content/70">{{ h.generatedBy(ago, author) }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <a :href="image.downloadUrl" download class="btn btn-primary lg:btn-sm">
          <Icon name="lucide:download" class="size-5 lg:size-4" aria-hidden="true" />
          {{ m.download }}
        </a>
        <button type="button" class="btn lg:btn-sm" @click="emit('preview')">
          <Icon name="lucide:maximize-2" class="size-5 lg:size-4" aria-hidden="true" />
          {{ m.preview }}
        </button>
        <ActionMenu class="ml-auto" :label="h.options" :items="menu" floating @select="onSelect" />
      </div>
    </div>
  </article>
</template>
