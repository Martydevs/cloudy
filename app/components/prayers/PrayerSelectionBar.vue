<script setup lang="ts">
// Barra de la selección de Peticiones (feature 007, forma de `SongSelectionBar`): fija abajo, al alcance del pulgar, con el
// área segura inferior y apoyada encima de las bandejas de YouTube y Canciones. Dice cuántas imágenes saldrán, avisa de las
// peticiones con texto ilegible (con icono y texto, no solo color) y lleva **Generar imágenes**.
const props = withDefaults(defineProps<{ count: number, images: number, unreadable?: number, limit?: boolean }>(), { unreadable: 0, limit: false })
const emit = defineEmits<{ generate: [], review: [], clear: [] }>()
const m = messages.prayers
const reasonId = useId()
</script>

<template>
  <div
    class="@container fixed inset-x-0 bottom-[calc(var(--youtube-tray-h,0px)+var(--song-tray-h,0px))] z-30 border-t border-base-300 bg-base-100 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl md:bottom-4 md:left-4 md:right-4 md:mx-auto md:max-w-3xl md:rounded-box md:border lg:left-[calc(var(--app-sidebar-w,16rem)+1rem)]"
    role="region"
    aria-label="Selección de peticiones"
  >
    <div class="flex flex-col gap-2 @2xl:flex-row @2xl:items-center">
      <div class="flex-1 @max-2xl:pr-24" role="status">
        <p class="font-medium">{{ m.willGenerate(props.count, props.images) }}</p>
        <p v-if="unreadable > 0" class="flex items-center gap-1 text-sm">
          <Icon name="lucide:triangle-alert" class="size-4 shrink-0" aria-hidden="true" />
          {{ m.illegibleWarning(unreadable) }}
        </p>
        <p v-if="limit" class="text-sm text-base-content/70">{{ m.limit }}</p>
      </div>
      <div class="flex flex-col gap-2 @md:flex-row">
        <button
          type="button"
          class="btn btn-primary btn-block @md:w-auto"
          :disabled="count === 0"
          :aria-describedby="count === 0 ? reasonId : undefined"
          @click="emit('generate')"
        >
          <Icon name="lucide:sparkles" class="size-5" aria-hidden="true" />
          {{ m.generate }}
        </button>
        <span v-if="count === 0" :id="reasonId" class="sr-only">{{ m.generateDisabled }}</span>
        <button type="button" class="btn btn-block @md:w-auto" @click="emit('review')">
          <Icon name="lucide:list-checks" class="size-5" aria-hidden="true" />
          {{ m.review }}
        </button>
        <!-- Si la barra es angosta «Limpiar» sube a la fila del conteo para que ocupe menos pantalla. -->
        <button type="button" class="btn btn-ghost @max-2xl:absolute @max-2xl:right-2 @max-2xl:top-0 @md:w-auto" @click="emit('clear')">{{ m.clear }}</button>
      </div>
    </div>
  </div>
</template>
