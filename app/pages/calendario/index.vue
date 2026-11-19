<script setup lang="ts">
// Página Calendario: los días de trabajo del equipo, a todo el ancho (layout `calendar`). Arriba van el título, el
// conmutador Calendario / Lista y «Agendar día»; debajo, en la caja de `--calendar-h` (80 % del alto), el calendario
// (SVAR, diferido y solo en el navegador, tras un esqueleto de su mismo tamaño) o la lista «Próximos días» (SSR,
// alternativa accesible), según `?vista=`. `?fecha=AAAA-MM-DD` fija el periodo visible (así vuelve el formulario).
// Los administradores agendan y editan en sus propias páginas; los editores ven y cambian el estado de los días en los
// que están asignados.
import { can, canSetWorkDayStatus } from '#shared/permissions'
import type { WorkDay, WorkDayDetail, WorkDayStatus } from '#shared/types/api'
import { parseIsoDate } from '#shared/validation/calendar'
import type { CalendarView } from '~/utils/work-calendar'

definePageMeta({ layout: 'calendar', access: 'private', roles: ['editor', 'admin'] })
useHead({ title: 'Calendario · Cloudy' })

const m = messages.calendar
const route = useRoute()
const { profile } = useMe()
const canManage = computed(() => can(profile.value?.role, 'calendar.manage'))
const canChangeStatus = (day: WorkDay) => canSetWorkDayStatus(profile.value?.role, profile.value?.userId, day.members)
const calendar = useWorkCalendar()
const today = useCalendarToday()
const upcomingHeading = useId()

// ---- Calendario o lista, en la dirección (enlazable y con SSR)
const showList = computed(() => route.query.vista === 'lista')

function setList(list: boolean) {
  if (list === showList.value) return
  const query = { ...route.query }
  delete query.vista
  if (list) query.vista = 'lista'
  return navigateTo({ path: route.path, query }, { replace: true })
}

// ---- Próximos días (SSR)
const { data: upcoming, pending: upcomingPending, error: upcomingError, refresh: refreshUpcoming } = useUpcomingWorkDays()
const statusBusy = ref<string | null>(null)

async function changeStatus(day: WorkDay, status: WorkDayStatus) {
  statusBusy.value = day.id
  await calendar.setStatus(day, status)
  statusBusy.value = null
}

// ---- Calendario (solo cliente): mes desde 640 px y día por debajo, decidido al montar. La fecha inicial es la de
// `?fecha=` si es válida y, si no, «hoy» en la zona de la iglesia (el mismo valor en el SSR y en el navegador).
const requested = typeof route.query.fecha === 'string' && parseIsoDate(route.query.fecha) !== null ? route.query.fecha : null
const date = ref(localDate(requested ?? today.value))
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

// ---- Detalle (diálogo) y formulario (páginas)
const detailId = ref<string | null>(null)
/** «Agendar día» lleva la fecha que muestra el calendario. */
const scheduleLink = computed(() => ({ path: '/calendario/nuevo', query: { fecha: toIsoDate(date.value) } }))

function edit(day: WorkDayDetail) {
  return navigateTo(`/calendario/${day.id}/editar`)
}
</script>

<template>
  <div class="flex flex-col gap-3 lg:gap-4">
    <header class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div class="flex min-w-0 flex-1 flex-col gap-1 sm:basis-80">
        <h1 class="text-2xl font-semibold">{{ m.title }}</h1>
        <p class="text-base-content/70">{{ m.description }}</p>
      </div>
      <div class="join" role="group" :aria-label="m.switchLabel">
        <button
          type="button"
          class="btn join-item flex-1 sm:flex-none"
          :class="{ 'btn-primary': !showList }"
          :aria-pressed="!showList"
          @click="setList(false)"
        >
          <Icon name="lucide:calendar-days" class="size-5" aria-hidden="true" />
          {{ m.viewCalendar }}
        </button>
        <button
          type="button"
          class="btn join-item flex-1 sm:flex-none"
          :class="{ 'btn-primary': showList }"
          :aria-pressed="showList"
          @click="setList(true)"
        >
          <Icon name="lucide:list" class="size-5" aria-hidden="true" />
          {{ m.viewList }}
        </button>
      </div>
      <NuxtLink v-if="canManage" :to="scheduleLink" class="btn btn-primary">
        <Icon name="lucide:calendar-plus" class="size-5" aria-hidden="true" />
        {{ m.schedule }}
      </NuxtLink>
    </header>

    <!-- La lista y el calendario ocupan la misma caja (`--calendar-h`, del layout); la lista se desplaza dentro. -->
    <section v-if="showList" class="flex h-[var(--calendar-h,44rem)] flex-col gap-3" :aria-labelledby="upcomingHeading">
      <h2 :id="upcomingHeading" class="text-lg font-semibold">{{ m.upcomingTitle }}</h2>
      <div class="-m-1 min-h-0 flex-1 overflow-y-auto p-1">
        <UpcomingWorkDays
          :days="upcoming?.items ?? null"
          :pending="upcomingPending"
          :error="upcomingError"
          :can-manage="canManage"
          :can-change-status="canChangeStatus"
          :busy-id="statusBusy"
          @retry="refreshUpcoming()"
          @open="day => (detailId = day.id)"
          @status="changeStatus"
          @schedule="navigateTo(scheduleLink)"
        />
      </div>
    </section>

    <section v-else class="flex h-[var(--calendar-h,44rem)] flex-col gap-2" :aria-label="m.title">
      <ErrorState v-if="monthFailed" :message="m.load.month" @retry="calendar.loadMonth(monthKey(date), true)" />
      <!-- El esqueleto llena la misma caja que el calendario: al llegar el componente no se mueve nada. -->
      <div class="min-h-0 flex-1">
        <ClientOnly>
          <LazyWorkCalendar
            v-if="ready"
            v-model:date="date"
            v-model:view="view"
            :events="events"
            :busy="monthLoading"
            @open="id => (detailId = id)"
          />
          <div v-else class="skeleton size-full" aria-hidden="true" />
          <template #fallback>
            <div class="skeleton size-full" aria-busy="true">
              <span class="sr-only">Cargando el calendario…</span>
            </div>
          </template>
        </ClientOnly>
      </div>
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
  </div>
</template>
