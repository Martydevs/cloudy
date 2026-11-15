<script setup lang="ts">
// Una miniatura de `Slideshow`: caja de tamaño fijo (sin saltos) que avisa a su ranura cuando se acerca al borde de la fila
// desplazable (`near`, una sola vez), para que la imagen pida su `src` solo entonces.
const props = defineProps<{ scrollRoot: HTMLElement | null }>()
defineSlots<{ default(props: { near: boolean }): unknown }>()

const box = useTemplateRef<HTMLElement>('box')
const near = useElementVisibility(box, { scrollTarget: () => props.scrollRoot, rootMargin: '0px 200px', once: true })
</script>

<template>
  <span ref="box" class="block size-full">
    <slot :near="near" />
  </span>
</template>
