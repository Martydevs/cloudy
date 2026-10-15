<script setup lang="ts">
import type { Breadcrumb } from '#shared/types/api'

defineProps<{ items: Breadcrumb[] }>()
</script>

<template>
  <!-- `breadcrumbs` de daisyUI ya desplaza horizontalmente dentro de sí mismo en pantallas angostas. -->
  <nav aria-label="Ruta de la carpeta" class="breadcrumbs max-w-full text-sm">
    <ul>
      <li v-for="(crumb, index) in items" :key="crumb.id ?? 'root'">
        <NuxtLink
          v-if="index < items.length - 1"
          :to="crumb.id ? `/archivos/${crumb.id}` : '/archivos'"
          class="inline-flex min-h-11 items-center gap-1"
        >
          <Icon v-if="!crumb.id" name="lucide:hard-drive" class="size-4" aria-hidden="true" />
          {{ crumb.name }}
        </NuxtLink>
        <span v-else aria-current="page" class="inline-flex min-h-11 items-center gap-1 font-medium">
          <Icon v-if="!crumb.id" name="lucide:hard-drive" class="size-4" aria-hidden="true" />
          {{ crumb.name }}
        </span>
      </li>
    </ul>
  </nav>
</template>
