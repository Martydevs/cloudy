<script setup lang="ts">
// Barra de la selección múltiple de Archivos: enviar lo marcado a la papelera (con confirmación, en `useItemActions`).
defineProps<{ count: number, busy?: boolean }>()
const emit = defineEmits<{ trash: [], clear: [] }>()
</script>

<template>
  <SelectionBar :count="count" @clear="emit('clear')">
    <button type="button" class="btn btn-error @max-md:w-full" :disabled="busy" @click="emit('trash')">
      <span v-if="busy" class="loading loading-spinner" aria-hidden="true" />
      <Icon v-else name="lucide:trash-2" class="size-4" aria-hidden="true" />
      Enviar a la papelera
    </button>
  </SelectionBar>
</template>
