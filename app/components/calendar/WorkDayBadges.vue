<script setup lang="ts">
// Tipo y estado de un día como insignias con icono y texto (el color nunca es la única señal).
import { WORK_DAY_KIND_LABELS, WORK_DAY_STATUS_LABELS } from '#shared/constants/calendar'
import type { WorkDayKind, WorkDayStatus } from '#shared/types/api'

defineProps<{ kind: WorkDayKind, status: WorkDayStatus }>()
</script>

<template>
  <span class="flex flex-wrap gap-2">
    <span class="badge badge-soft" :class="kind === 'special' ? 'badge-primary' : 'badge-secondary'">
      <Icon :name="WORK_DAY_KIND_ICON[kind]" class="size-3.5" aria-hidden="true" />
      {{ WORK_DAY_KIND_LABELS[kind] }}
    </span>
    <span class="badge" :class="WORK_DAY_STATUS_BADGE[status]">
      <Icon :name="WORK_DAY_STATUS_ICON[status]" class="size-3.5" aria-hidden="true" />
      {{ WORK_DAY_STATUS_LABELS[status] }}
    </span>
  </span>
</template>
