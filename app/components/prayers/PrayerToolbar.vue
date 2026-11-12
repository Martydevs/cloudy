<script setup lang="ts">
// Barra de filtros de Peticiones (feature 007, contracts/ui.md): búsqueda con botón de limpiar, presets de fecha de
// aprobación, fechas solo con **Rango**, orden y el resumen del filtro activo con **Quitar filtros**. Solo presenta: el
// estado y la query viven en `usePrayerFilters`. Mobile first: en columna en teléfono, en fila desde `lg:`; todo ≥ 44 px.
import type { PrayersDir } from '#shared/validation/prayers'
import type { PrayerDatePreset } from '~/composables/usePrayerFilters'

withDefaults(defineProps<{
  /** Resumen del filtro activo (`usePrayerFilters().activeSummary`); sin él no hay **Quitar filtros**. */
  summary?: string | null
  rangeError?: string | null
}>(), { summary: null, rangeError: null })
const emit = defineEmits<{ reset: [] }>()

const q = defineModel<string>('q', { required: true })
const preset = defineModel<PrayerDatePreset>('preset', { required: true })
const from = defineModel<string>('from', { required: true })
const to = defineModel<string>('to', { required: true })
const dir = defineModel<PrayersDir>('dir', { required: true })

const m = messages.prayers
const PRESETS: PrayerDatePreset[] = ['all', 'today', 'week', 'range']
</script>

<template>
  <form role="search" :aria-label="m.filters" class="flex flex-col gap-3" @submit.prevent>
    <div class="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <div class="join w-full lg:w-80">
        <label class="input join-item min-h-11 w-full">
          <Icon name="lucide:search" class="size-4 shrink-0 opacity-60" aria-hidden="true" />
          <!-- Sin la ✕ nativa de `type="search"`: **Limpiar búsqueda** es la única (con nombre y ≥ 44 px). -->
          <input
            v-model="q"
            type="search"
            class="grow [&::-webkit-search-cancel-button]:appearance-none"
            :placeholder="m.search"
            :aria-label="m.search"
            enterkeyhint="search"
          >
        </label>
        <button v-if="q" type="button" class="btn join-item min-h-11" :aria-label="m.clearSearch" @click="q = ''">
          <Icon name="lucide:x" class="size-4" aria-hidden="true" />
        </button>
      </div>

      <div class="join w-full sm:w-auto" role="group" :aria-label="m.dateFilter">
        <button
          v-for="key in PRESETS"
          :key="key"
          type="button"
          class="btn join-item min-h-11 flex-1 whitespace-nowrap sm:flex-none"
          :class="{ 'btn-active btn-primary': preset === key }"
          :aria-pressed="preset === key"
          @click="preset = key"
        >
          {{ m.presets[key] }}
        </button>
      </div>

      <div v-if="preset === 'range'" class="grid grid-cols-2 gap-2 lg:flex">
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-sm">{{ m.rangeFrom }}</span>
          <input v-model="from" type="date" class="input min-h-11 w-full" :max="to || undefined">
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-sm">{{ m.rangeTo }}</span>
          <input v-model="to" type="date" class="input min-h-11 w-full" :min="from || undefined">
        </label>
      </div>

      <label class="flex items-center gap-2 lg:ms-auto">
        <span class="shrink-0 text-sm">{{ m.sort }}</span>
        <select v-model="dir" class="select min-h-11 min-w-0 flex-1 lg:w-56">
          <option value="desc">{{ m.sortDesc }}</option>
          <option value="asc">{{ m.sortAsc }}</option>
        </select>
      </label>
    </div>

    <template v-if="preset === 'range'">
      <p v-if="rangeError" class="text-sm text-error" role="alert">{{ rangeError }}</p>
      <p v-else-if="!from || !to" class="text-sm text-base-content/70">{{ m.rangeHint }}</p>
    </template>

    <div v-if="summary" class="flex flex-wrap items-center gap-2">
      <p class="min-w-0 break-words text-sm text-base-content/80" role="status">{{ summary }}</p>
      <button type="button" class="btn btn-ghost min-h-11" @click="emit('reset')">
        <Icon name="lucide:filter-x" class="size-4" aria-hidden="true" />
        {{ m.clearFilters }}
      </button>
    </div>
  </form>
</template>
