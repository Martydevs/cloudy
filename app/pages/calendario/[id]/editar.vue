<script setup lang="ts">
// Editar un día de trabajo (solo administradores). El día se pide en el navegador y el formulario se monta cuando ya
// llegó (toma sus valores iniciales una vez); si el día ya no existe, lo dice y ofrece volver.
import type { WorkDayDetail } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['admin'] })
useHead({ title: 'Editar día · Cloudy' })

const m = messages.calendar
const route = useRoute()
const id = String(route.params.id)
// Clave propia: no comparte datos con el detalle (`work-day-<id>`), que pudo quedar con una copia anterior.
const { data: day, pending, error, refresh } = useApiFetch<WorkDayDetail>(`/api/calendario/${id}`, { server: false, key: `work-day-edit-${id}` })
const gone = computed(() => error.value?.statusCode === 404)
</script>

<template>
  <div v-if="gone" class="mx-auto flex w-full max-w-5xl flex-col gap-5">
    <h1 class="text-2xl font-semibold">{{ m.editTitle }}</h1>
    <EmptyState icon="lucide:calendar-x" :title="m.gone">
      <NuxtLink to="/calendario" class="btn btn-primary">{{ m.back }}</NuxtLink>
    </EmptyState>
  </div>
  <div v-else-if="error" class="mx-auto flex w-full max-w-5xl flex-col gap-5">
    <h1 class="text-2xl font-semibold">{{ m.editTitle }}</h1>
    <ErrorState :message="m.load.day" @retry="refresh()" />
  </div>
  <div v-else-if="pending || !day" class="mx-auto flex w-full max-w-5xl flex-col gap-5" aria-busy="true">
    <h1 class="text-2xl font-semibold">{{ m.editTitle }}</h1>
    <SkeletonList :rows="4" />
  </div>
  <WorkDayForm v-else :day="day" />
</template>
