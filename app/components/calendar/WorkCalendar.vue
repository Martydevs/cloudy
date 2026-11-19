<script setup lang="ts">
// Única frontera con SVAR Vue Calendar (`@svar-ui/*`; `architecture.spec.ts` lo vigila): si el componente se cambia, se
// toca este archivo. Su CSS y el tema Cloudy se importan aquí para que viajen solo en el chunk de /calendario.
//
// Lo que se comprobó en el paquete instalado (2.7.1) y por qué está así:
// - Solo lectura: un día tiene varios rangos y arrastrar uno cambiaría la fecha del día. Se edita con nuestro formulario.
//   Va como `:readonly="true"`: SVAR declara la prop sin tipo, y el atributo a secas le llegaría como `''` (falso).
// - La barra de navegación es nuestra (`toolbar: null`): la de SVAR pinta sus flechas con una fuente de iconos que baja de
//   su CDN, y con `fonts: false` (no pedimos Open Sans: ya hay DM Sans) quedarían vacías. Así los botones son `btn` de
//   daisyUI (45 px), con iconos lucide y textos nuestros.
// - Al cambiar `events`, SVAR se reinicia con las props `view` y `date`: por eso la vista y la fecha viven fuera (v-model)
//   y se actualizan cuando el propio calendario navega (clic en el número de un día del mes → vista de día).
// - SVAR abre un evento solo con el ratón; el botón de `WorkCalendarEvent` lo abre también con el teclado.
// - La semana empieza en domingo (`calendar.weekStart`) y la hora es de 24 h (`timeScaleFormat` del idioma `es`).
// - No renderiza en el servidor (usa `ResizeObserver`): se monta dentro de `<ClientOnly>`.
import { Calendar, Willow } from '@svar-ui/vue-calendar'
import { Locale } from '@svar-ui/vue-core'
import { es as calendarEs } from '@svar-ui/calendar-locales'
import { es as coreEs } from '@svar-ui/core-locales'
import '@svar-ui/vue-calendar/all.css'
import '~/assets/css/svar-calendar-cloudy.css'
import type { CalendarView, WorkCalendarEvent as CalendarEvent } from '~/utils/work-calendar'
import WorkCalendarEvent from './WorkCalendarEvent.vue'

const props = withDefaults(defineProps<{ events: CalendarEvent[], busy?: boolean }>(), { busy: false })
const emit = defineEmits<{ open: [workDayId: string] }>()
const date = defineModel<Date>('date', { required: true })
const view = defineModel<CalendarView>('view', { required: true })

provide(OPEN_WORK_DAY, workDayId => emit('open', workDayId))

const words = { ...coreEs, ...calendarEs, calendar: { ...coreEs.calendar, weekStart: 0, clockFormat: 24 } }

// Rejilla de día y semana: de la primera hora con eventos (o las 6) a medianoche; por defecto SVAR solo muestra 8–18.
const views = computed(() => {
  const timeGrid = { yScale: { startHour: firstGridHour(props.events), endHour: 24, ui: { minUnitHeight: 56 } } }
  return [
    { id: 'day', sections: { timeGrid } },
    { id: 'week', sections: { timeGrid } },
    // Sin «+N more» (texto fijo en inglés): la fila crece para mostrar todos los eventos del día.
    { id: 'month', sections: { month: { ui: { eventOverflow: 'expand' } } } },
  ]
})

const label = computed(() => rangeLabel(date.value, view.value))

function step(direction: -1 | 1) {
  date.value = shiftDate(date.value, view.value, direction)
}

function today() {
  date.value = new Date()
}

interface CalendarApi { on: (action: string, handler: (payload: { date?: Date, view?: string }) => void) => void }

/** Navegación que nace dentro del calendario (clic en el número de un día): se refleja en la vista y la fecha de fuera. */
function init(api: CalendarApi) {
  api.on('navigate-to', (payload) => {
    if (payload.date) date.value = payload.date
    if (payload.view && CALENDAR_VIEWS.some(item => item.id === payload.view)) view.value = payload.view as CalendarView
  })
}

// SVAR tipa el evento como genérico; los nuestros siempre llevan `kind` y `status` (`toCalendarEvents`).
const eventCss = ({ event }: { event: Record<string, unknown> }) => eventClass(event as unknown as CalendarEvent)
</script>

<template>
  <div class="cloudy-calendar flex h-[44rem] flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="join" role="group" aria-label="Cambiar de periodo">
        <button type="button" class="btn btn-square join-item" aria-label="Periodo anterior" @click="step(-1)">
          <Icon name="lucide:chevron-left" class="size-5" aria-hidden="true" />
        </button>
        <button type="button" class="btn join-item" @click="today">Hoy</button>
        <button type="button" class="btn btn-square join-item" aria-label="Periodo siguiente" @click="step(1)">
          <Icon name="lucide:chevron-right" class="size-5" aria-hidden="true" />
        </button>
      </div>
      <p class="order-last w-full text-base font-semibold first-letter:uppercase sm:order-none sm:w-auto sm:flex-1" aria-live="polite" data-calendar-label>
        {{ label }}
      </p>
      <span v-if="busy" class="loading loading-spinner motion-reduce:animate-none" role="status" aria-label="Cargando el calendario" />
      <div class="join ml-auto" role="group" aria-label="Vista del calendario">
        <button
          v-for="item in CALENDAR_VIEWS"
          :key="item.id"
          type="button"
          class="btn join-item"
          :class="{ 'btn-primary': view === item.id }"
          :aria-pressed="view === item.id"
          @click="view = item.id"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden rounded-box border border-base-300">
      <Willow :fonts="false">
        <Locale :words="words">
          <Calendar
            :events="events"
            :view="view"
            :date="date"
            :views="views"
            :toolbar="null"
            :event-css="eventCss"
            :event-content="WorkCalendarEvent"
            :init="init"
            :readonly="true"
          />
        </Locale>
      </Willow>
    </div>
  </div>
</template>
