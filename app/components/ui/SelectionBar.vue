<script setup lang="ts">
// Barra fija de una selección múltiple (Archivos, Usuarios): abajo, al alcance del pulgar, con el conteo anunciado,
// las acciones de la selección (ranura) y «Limpiar». Misma colocación que `YoutubeSelectionBar`: respeta el área
// segura inferior, se apoya encima de la bandeja de descargas (`--youtube-tray-h`) y, desde `md`, es una tarjeta entre
// el menú lateral (`--app-sidebar-w`) y la esquina de la bandeja. El contenido se acomoda al ancho de la barra
// (container queries), no al de la pantalla. La página que la muestra deja `pb-40 sm:pb-24` para que no tape contenido.
defineProps<{ count: number }>()
const emit = defineEmits<{ clear: [] }>()
</script>

<template>
  <div
    class="@container fixed inset-x-0 bottom-[var(--youtube-tray-h,0px)] z-30 border-t border-base-300 bg-base-100 px-4 pt-3 shadow-2xl md:bottom-4 md:left-4 md:right-[26rem] md:mx-auto md:max-w-3xl md:rounded-box md:border lg:left-[calc(var(--app-sidebar-w,16rem)+1rem)]"
    :style="{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }"
    role="region"
    aria-label="Selección"
  >
    <div class="flex flex-col gap-2 @2xl:flex-row @2xl:items-center">
      <p class="flex-1 font-medium @max-2xl:pr-24" role="status">{{ pluralize(count, 'seleccionado', 'seleccionados') }}</p>
      <div class="flex flex-col gap-2 @md:flex-row @md:flex-wrap @max-md:[&_.dropdown]:w-full @max-md:[&_.dropdown>.btn]:w-full">
        <slot />
        <!-- Si la barra es angosta «Limpiar» sube a la fila del conteo para que ocupe menos pantalla. -->
        <button type="button" class="btn btn-ghost @max-2xl:absolute @max-2xl:right-2 @max-2xl:top-0 @md:w-auto" @click="emit('clear')">Limpiar</button>
      </div>
    </div>
  </div>
</template>
