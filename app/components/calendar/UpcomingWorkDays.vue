<script setup lang="ts">
// Lista «Próximos días» (30 días). Va en el SSR: es la lectura rápida en el teléfono y la alternativa accesible al
// calendario (todo lo que se ve allí está aquí como texto y botones). Quien administra avanza el estado con un toque.
import { WORK_DAY_STATUS_LABELS } from '#shared/constants/calendar'
import type { WorkDay, WorkDayStatus } from '#shared/types/api'

const props = withDefaults(defineProps<{
  days: WorkDay[] | null
  pending?: boolean
  error?: Error | null
  canManage?: boolean
  /** Id del día cuyo estado se está guardando. */
  busyId?: string | null
}>(), { pending: false, error: null, canManage: false, busyId: null })

const emit = defineEmits<{
  retry: []
  open: [day: WorkDay]
  status: [day: WorkDay, status: WorkDayStatus]
  schedule: []
}>()

const m = messages.calendar
const ADVANCE: Partial<Record<WorkDayStatus, { label: string, icon: string }>> = {
  not_started: { label: 'Iniciar', icon: 'lucide:play' },
  in_progress: { label: 'Finalizar', icon: 'lucide:check' },
}

function people(day: WorkDay): string {
  if (day.members.length === 0) return m.noMembers
  return day.members.map(member => (member.active ? member.name : m.inactiveMember)).join(', ')
}

function advance(day: WorkDay) {
  const status = nextStatus(day.status)
  if (status) emit('status', day, status)
}

const items = computed(() => props.days ?? [])
</script>

<template>
  <SkeletonList v-if="!days && pending" :rows="3" />
  <ErrorState v-else-if="error && !days" :message="m.load.upcoming" @retry="emit('retry')" />
  <EmptyState
    v-else-if="items.length === 0"
    icon="lucide:calendar-days"
    :title="m.upcomingEmpty"
    :description="canManage ? m.upcomingEmptyAdmin : m.upcomingEmptyEditor"
  >
    <button v-if="canManage" type="button" class="btn btn-primary" @click="emit('schedule')">
      <Icon name="lucide:calendar-plus" class="size-5" aria-hidden="true" />
      {{ m.schedule }}
    </button>
  </EmptyState>
  <ul v-else class="grid gap-3 lg:grid-cols-2" :aria-label="m.upcomingTitle">
    <li
      v-for="day in items"
      :key="day.id"
      class="flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-3 sm:flex-row sm:items-center"
    >
      <button
        type="button"
        class="flex min-h-11 min-w-0 flex-1 flex-col gap-1 rounded-field text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :aria-label="`Ver ${day.title}, ${formatWorkDate(day.date)}`"
        @click="emit('open', day)"
      >
        <span class="text-sm text-base-content/70 first-letter:uppercase">{{ formatWorkDate(day.date) }} · {{ formatSlots(day.slots) }}</span>
        <span class="break-words font-semibold">{{ day.title }}</span>
        <WorkDayBadges :kind="day.kind" :status="day.status" />
        <span class="text-sm text-base-content/70">
          <Icon name="lucide:map-pin" class="size-3.5 align-[-2px]" aria-hidden="true" />
          {{ day.auditorium }}
        </span>
        <span class="text-sm text-base-content/70">
          <Icon name="lucide:users" class="size-3.5 align-[-2px]" aria-hidden="true" />
          {{ people(day) }}
          <template v-if="day.materialCount > 0"> · {{ pluralize(day.materialCount, 'adjunto', 'adjuntos') }}</template>
        </span>
      </button>
      <button
        v-if="canManage && ADVANCE[day.status]"
        type="button"
        class="btn sm:self-center"
        :disabled="busyId === day.id"
        :aria-label="`${ADVANCE[day.status]!.label} ${day.title} (ahora: ${WORK_DAY_STATUS_LABELS[day.status]})`"
        @click="advance(day)"
      >
        <span v-if="busyId === day.id" class="loading loading-spinner motion-reduce:animate-none" aria-hidden="true" />
        <Icon v-else :name="ADVANCE[day.status]!.icon" class="size-4" aria-hidden="true" />
        {{ ADVANCE[day.status]!.label }}
      </button>
    </li>
  </ul>
</template>
