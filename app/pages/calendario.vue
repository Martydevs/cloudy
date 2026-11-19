<script setup lang="ts">
// Página Calendario: los días de trabajo del equipo. La lista «Próximos días» va en el SSR (lectura rápida y alternativa
// accesible); el calendario (SVAR) se carga diferido, solo en el navegador, con un esqueleto de su misma altura (sin
// saltos de diseño). Los administradores agendan, editan, cambian el estado y eliminan; los editores solo ven.
import { can } from '#shared/permissions'
import type { WorkDay, WorkDayDetail, WorkDayStatus } from '#shared/types/api'
import type { CalendarView } from '~/utils/work-calendar'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['editor', 'admin'] })
useHead({ title: 'Calendario · Cloudy' })

const m = messages.calendar
const { profile } = useMe()
const canManage = computed(() => can(profile.value?.role, 'calendar.manage'))
const calendar = useWorkCalendar()
const upcomingHeading = useId()
const calendarHeading = useId()

// ---- Próximos días (SSR)
const { data: upcoming, pending: upcomingPending, error: upcomingError, refresh: refreshUpcoming } = useUpcomingWorkDays()
const statusBusy = ref<string | null>(null)

async function changeStatus(day: WorkDay, status: WorkDayStatus) {
  statusBusy.value = day.id
  await calendar.setStatus(day, status)
  statusBusy.value = null
}

// ---- Calendario (solo cliente): mes desde 640 px y día por debajo, decidido al montar
const date = ref(new Date())
const view = ref<CalendarView>('month')
const ready = ref(false)
const events = computed(() => toCalendarEvents(calendar.days.value))
const month = computed(() => calendar.monthOf(date.value))
const monthFailed = computed(() => month.value?.status === 'error' && month.value.items.length === 0)
const monthLoading = computed(() => !month.value || month.value.status === 'loading')
const periodEmpty = computed(() => month.value?.status === 'ready' && month.value.items.length === 0)

onMounted(() => {
  if (!window.matchMedia('(min-width: 640px)').matches) view.value = 'day'
  ready.value = true
  // Los meses guardados de una visita anterior se muestran al instante y se vuelven a pedir.
  calendar.revalidate()
  calendar.show(date.value)
})
watch(date, value => calendar.show(value))

// ---- Diálogos
const detailId = ref<string | null>(null)
/** `day` = editar; sin `day` = agendar, con la fecha que muestra el calendario. */
const form = ref<{ day: WorkDayDetail | null, date: string } | null>(null)

function schedule() {
  form.value = { day: null, date: toIsoDate(date.value) }
}

function edit(day: WorkDayDetail) {
  detailId.value = null
  form.value = { day, date: day.date }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div class="flex flex-1 flex-col gap-1">
        <h1 class="text-2xl font-semibold">{{ m.title }}</h1>
        <p class="text-base-content/70">{{ m.description }}</p>
      </div>
      <button v-if="canManage" type="button" class="btn btn-primary" @click="schedule">
        <Icon name="lucide:calendar-plus" class="size-5" aria-hidden="true" />
        {{ m.schedule }}
      </button>
    </header>

    <section class="flex flex-col gap-3" :aria-labelledby="upcomingHeading">
      <h2 :id="upcomingHeading" class="text-lg font-semibold">{{ m.upcomingTitle }}</h2>
      <UpcomingWorkDays
        :days="upcoming?.items ?? null"
        :pending="upcomingPending"
        :error="upcomingError"
        :can-manage="canManage"
        :busy-id="statusBusy"
        @retry="refreshUpcoming()"
        @open="day => (detailId = day.id)"
        @status="changeStatus"
        @schedule="schedule"
      />
    </section>

    <section class="flex flex-col gap-3" :aria-labelledby="calendarHeading">
      <h2 :id="calendarHeading" class="text-lg font-semibold">{{ m.title }}</h2>
      <ErrorState v-if="monthFailed" :message="m.load.month" @retry="calendar.loadMonth(monthKey(date), true)" />
      <!-- El esqueleto mide lo mismo que el calendario (`h-[44rem]`): al llegar el componente no se mueve nada. -->
      <ClientOnly>
        <LazyWorkCalendar
          v-if="ready"
          v-model:date="date"
          v-model:view="view"
          :events="events"
          :busy="monthLoading"
          @open="id => (detailId = id)"
        />
        <div v-else class="skeleton h-[44rem] w-full" aria-hidden="true" />
        <template #fallback>
          <div class="skeleton h-[44rem] w-full" aria-busy="true">
            <span class="sr-only">Cargando el calendario…</span>
          </div>
        </template>
      </ClientOnly>
      <p role="status" class="min-h-6 text-sm text-base-content/70">{{ periodEmpty ? m.monthEmpty : '' }}</p>
    </section>

    <LazyWorkDayDetailDialog
      v-if="detailId"
      :key="detailId"
      :day-id="detailId"
      :can-manage="canManage"
      @close="detailId = null"
      @edit="edit"
    />
    <LazyWorkDayDialog
      v-if="form"
      :day="form.day"
      :initial-date="form.date"
      @close="form = null"
      @saved="form = null"
    />
  </div>
</template>
