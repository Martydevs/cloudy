<script setup lang="ts">
// Contenido de un evento del calendario (`eventContent`). Es un botón: se enfoca con el teclado y abre el detalle de su
// día. El tipo y el estado se dicen con icono y texto, no solo con el color (WCAG 1.4.1). El título es texto plano.
import { WORK_DAY_KIND_LABELS, WORK_DAY_STATUS_LABELS } from '#shared/constants/calendar'
import type { WorkCalendarEvent } from '~/utils/work-calendar'

const props = defineProps<{ event: WorkCalendarEvent, mode?: string }>()

const open = inject(OPEN_WORK_DAY, () => {})
const compact = computed(() => props.mode === 'grid')
const time = computed(() => `${formatEventTime(props.event.start)}–${formatEventTime(props.event.end)}`)
const special = computed(() => props.event.kind === 'special')
const statusLabel = computed(() => (props.event.status === 'not_started' ? '' : WORK_DAY_STATUS_LABELS[props.event.status]))
const label = computed(() => [
  props.event.text,
  time.value,
  `Día ${WORK_DAY_KIND_LABELS[props.event.kind].toLowerCase()}`,
  WORK_DAY_STATUS_LABELS[props.event.status],
].join(', '))
</script>

<template>
  <!-- `mousedown.stop`: el calendario no debe tratar el clic como selección propia; el detalle lo abre este botón. -->
  <button
    type="button"
    class="cloudy-ev__btn"
    :class="{ 'cloudy-ev__btn--grid': compact }"
    :aria-label="label"
    :title="compact ? label : undefined"
    @mousedown.stop
    @click.stop="open(event.workDayId)"
  >
    <template v-if="compact">
      <span class="cloudy-ev__meta">{{ formatEventTime(event.start) }}</span>
      <Icon v-if="special" :name="WORK_DAY_KIND_ICON.special" class="size-3.5 shrink-0" aria-hidden="true" />
      <span v-if="event.status === 'in_progress'" class="cloudy-ev__dot" aria-hidden="true" />
      <Icon v-else-if="event.status === 'finished'" :name="WORK_DAY_STATUS_ICON.finished" class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="cloudy-ev__title">{{ event.text }}</span>
    </template>
    <span v-else class="flex min-w-0 flex-col">
      <span class="cloudy-ev__title">{{ event.text }}</span>
      <span class="cloudy-ev__meta">{{ time }}</span>
      <span v-if="special" class="flex items-center gap-1">
        <Icon :name="WORK_DAY_KIND_ICON.special" class="size-3.5 shrink-0" aria-hidden="true" />
        {{ WORK_DAY_KIND_LABELS.special }}
      </span>
      <span v-if="statusLabel" class="flex items-center gap-1">
        <span v-if="event.status === 'in_progress'" class="cloudy-ev__dot" aria-hidden="true" />
        <Icon v-else :name="WORK_DAY_STATUS_ICON.finished" class="size-3.5 shrink-0" aria-hidden="true" />
        {{ statusLabel }}
      </span>
    </span>
  </button>
</template>
