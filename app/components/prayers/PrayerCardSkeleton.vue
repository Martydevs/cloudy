<script setup lang="ts">
// Esqueleto con la misma caja que `PrayerCard` (foto 4:3 + líneas de texto): la rejilla no salta al llegar los datos.
withDefaults(defineProps<{ rows?: number }>(), { rows: 3 })
</script>

<template>
  <div class="card overflow-hidden border border-base-300 bg-base-100" aria-hidden="true">
    <div class="skeleton aspect-[4/3] w-full rounded-none motion-reduce:animate-none" />
    <div class="flex flex-col gap-2 p-4">
      <div class="skeleton h-5 w-1/2 motion-reduce:animate-none" />
      <div class="skeleton h-4 w-2/3 motion-reduce:animate-none" />
      <div v-for="row in rows" :key="row" class="skeleton h-4 w-full motion-reduce:animate-none" />
    </div>
  </div>
</template>
