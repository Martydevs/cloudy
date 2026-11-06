<script setup lang="ts">
// Barra de la selección múltiple del historial de Canciones (feature 006, FR-030; forma de `YoutubeSelectionBar`): fija abajo,
// al alcance del pulgar, con el área segura inferior y apoyada encima de las bandejas (`--youtube-tray-h` + `--song-tray-h`).
const props = defineProps<{ count: number }>()
const emit = defineEmits<{ generate: [], clear: [] }>()

const files = computed(() => props.count)
</script>

<template>
  <div
    class="@container fixed inset-x-0 bottom-[calc(var(--youtube-tray-h,0px)+var(--song-tray-h,0px))] z-30 border-t border-base-300 bg-base-100 px-4 pt-3 shadow-2xl md:bottom-4 md:left-4 md:right-[26rem] md:mx-auto md:max-w-3xl md:rounded-box md:border lg:left-[calc(var(--app-sidebar-w,16rem)+1rem)]"
    :style="{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }"
    role="region"
    aria-label="Selección"
  >
    <div class="flex flex-col gap-2 @2xl:flex-row @2xl:items-center">
      <p class="flex-1 font-medium @max-2xl:pr-24" role="status">
        {{ pluralize(count, 'seleccionada', 'seleccionadas') }}
        <span class="block text-sm font-normal text-base-content/70 @2xl:inline @2xl:pl-2">{{ messages.songs.present.filesCount(files) }}</span>
      </p>
      <div class="flex flex-col gap-2 @md:flex-row">
        <button type="button" class="btn btn-primary btn-block @md:w-auto" @click="emit('generate')">
          <Icon name="lucide:presentation" class="size-5" aria-hidden="true" />
          Generar selección
        </button>
        <!-- Si la barra es angosta «Limpiar» sube a la fila del conteo para que ocupe menos pantalla. -->
        <button type="button" class="btn btn-ghost @max-2xl:absolute @max-2xl:right-2 @max-2xl:top-0 @md:w-auto" @click="emit('clear')">Limpiar</button>
      </div>
    </div>
  </div>
</template>
