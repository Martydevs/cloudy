<script setup lang="ts">
// Barra de la selección múltiple del historial (FR-020): fija abajo, al alcance del pulgar, respetando el área segura
// inferior y sin taparse con la bandeja de descargas.
//
// Desde `md` es una tarjeta abajo que siempre deja libre la esquina de la bandeja (anclada abajo a la derecha, `w-96`):
// va entre el menú lateral (`--app-sidebar-w`) y esa esquina, esté o no la bandeja a la vista, así no cambia de ancho ni
// de sitio cuando la bandeja aparece o la persona la cierra. En pantallas más angostas no caben lado a lado: ocupa todo
// el ancho y se apoya encima de las bandejas (`--youtube-tray-h` y, si hay presentaciones de Canciones abiertas, que se apilan
// sobre la de descargas, también `--song-tray-h`). El contenido se acomoda al ancho de la barra (container queries `@…`), no
// al de la pantalla: si es angosta, los botones pasan a ocupar todo el ancho, uno debajo del otro.
import type { YoutubeFormat } from '#shared/types/api'
import { YOUTUBE_DRIVE_FORMATS } from '#shared/constants/youtube'
import type { YoutubeDriveFormat } from '#shared/constants/youtube'

const props = defineProps<{ count: number }>()
const emit = defineEmits<{ download: [format: YoutubeFormat], drive: [format: YoutubeDriveFormat], clear: [] }>()

const { filesFor } = useYoutubeDownloads()
const format = ref<YoutubeFormat>('mp3')
const driveFormat = ref<YoutubeDriveFormat>('mp3')
const files = computed(() => filesFor(props.count))
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
        {{ pluralize(count, 'seleccionado', 'seleccionados') }}
        <span v-if="files > 1" class="block text-sm font-normal text-base-content/70 @2xl:inline @2xl:pl-2">{{ messages.youtube.downloads.filesCount(files) }}</span>
      </p>
      <div class="flex flex-col gap-2 @md:flex-row @max-md:[&_.dropdown]:w-full @max-md:[&_.dropdown>.btn]:w-full">
        <YoutubeFormatPicker v-model="format" label="Descargar selección" top block @select="f => emit('download', f)" />
        <YoutubeFormatPicker
          v-model="driveFormat"
          :label="messages.youtube.drive.action"
          icon="lucide:hard-drive-upload"
          :formats="YOUTUBE_DRIVE_FORMATS"
          :primary="false"
          top
          block
          @select="f => emit('drive', f)"
        />
        <!-- Si la barra es angosta «Limpiar» sube a la fila del conteo para que ocupe menos pantalla. -->
        <button type="button" class="btn btn-ghost @max-2xl:absolute @max-2xl:right-2 @max-2xl:top-0 @md:w-auto" @click="emit('clear')">Limpiar</button>
      </div>
    </div>
  </div>
</template>
