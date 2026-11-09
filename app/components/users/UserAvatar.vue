<script setup lang="ts">
// Círculo con la inicial de una persona (menú de cuenta del lateral y tarjeta «Cuenta» de Mi perfil). Es decorativo:
// el nombre siempre se muestra o se anuncia al lado, así que queda fuera del árbol de accesibilidad.
const props = withDefaults(defineProps<{
  /** Nombre de la persona; sin nombre se muestra «?». */
  name?: string | null
  /** `fill` llena a su contenedor (el botón redondo del lateral contraído); `sm` 36 px; `lg` 80 px. */
  size?: 'fill' | 'sm' | 'lg'
}>(), { name: null, size: 'sm' })

// Clases completas (Tailwind no ve las que se arman por partes).
const SIZES = {
  fill: 'size-full',
  sm: 'size-9 font-medium',
  lg: 'size-20 text-3xl font-medium',
} as const

const initial = computed(() => props.name?.trim().slice(0, 1).toUpperCase() || '?')
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full bg-neutral text-neutral-content"
    :class="SIZES[size]"
    aria-hidden="true"
  >{{ initial }}</span>
</template>
