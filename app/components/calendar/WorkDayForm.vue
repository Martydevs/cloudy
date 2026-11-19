<script setup lang="ts">
// Formulario de un día de trabajo (solo administradores), como contenido de página: lo usan /calendario/nuevo (agendar)
// y /calendario/[id]/editar. El tipo empieza sin elegir y es obligatorio; si la fecha cae en miércoles o domingo solo se
// muestra una pista. Los rangos de hora se validan con `validateSlots` (la misma regla del servidor) y cada lista de
// material se pide al abrir su pestaña, no con el formulario. Al guardar vuelve al calendario, en el mes del día. Con
// cambios sin guardar pide confirmación antes de salir (navegación interna) y el navegador avisa al cerrar o recargar.
import {
  CALENDAR_MESSAGES,
  DEFAULT_AUDITORIUM,
  WORK_DAY_KINDS,
  WORK_DAY_KIND_LABELS,
  WORK_DAY_MAX_MATERIALS,
  WORK_DAY_MAX_MEMBERS,
  WORK_DAY_MAX_SLOTS,
  WORK_DAY_STATUSES,
  WORK_DAY_STATUS_LABELS,
} from '#shared/constants/calendar'
import type { CalendarMember, FolderTreeNode, SongCollection, WorkDayDetail, WorkDayKind, WorkDayMaterialType, WorkDayStatus, YoutubePlaylist } from '#shared/types/api'
import { usualWorkDay, validateSlots } from '#shared/validation/calendar'
import { workDaySchema } from '~/utils/form-schemas'

const props = withDefaults(defineProps<{ day?: WorkDayDetail | null, initialDate?: string }>(), { day: null, initialDate: '' })

const m = messages.calendar
const api = useApi()
const calendar = useWorkCalendar()
const { confirm } = useConfirm()
const router = useRouter()
const form = useTemplateRef<HTMLFormElement>('form')
const uid = useId()
const saving = ref(false)

// ---- campos de texto
const { r$ } = useFormSchema({
  title: props.day?.title ?? '',
  date: props.day?.date ?? props.initialDate,
  // Sin valor inicial: quien agenda lo elige siempre.
  kind: props.day?.kind ?? '',
  status: props.day?.status ?? 'not_started',
  auditorium: props.day?.auditorium ?? DEFAULT_AUDITORIUM,
}, workDaySchema)
type FieldName = 'title' | 'date' | 'kind' | 'status' | 'auditorium'
const fieldError = (name: FieldName) => r$.$errors[name][0] ?? ''
const usualDay = computed(() => usualWorkDay(r$.$value.date))

// ---- rangos de hora
let nextRow = 0
const row = (start = '', end = '') => ({ key: nextRow++, start, end })
const slots = ref(props.day ? props.day.slots.map(slot => row(slot.start, slot.end)) : [row()])
const submitted = ref(false)
const slotCheck = computed(() => validateSlots(slots.value))
/** El error de una fila se muestra al terminar de llenarla (o al enviar): nunca mientras está a medias. */
function slotError(index: number): string {
  const current = slots.value[index]!
  if (slotCheck.value.ok || (!submitted.value && !(current.start && current.end))) return ''
  return slotCheck.value.rows[index] ?? ''
}

function addSlot() {
  if (slots.value.length < WORK_DAY_MAX_SLOTS) slots.value.push(row())
}

function removeSlot(index: number) {
  slots.value.splice(index, 1)
}

// ---- miembros (cuentas activas; quien ya estaba asignado y se desactivó sigue apareciendo, como «Persona inactiva»)
const { data: memberList, pending: membersPending, error: membersError, refresh: refreshMembers } = useApiFetch<{ items: CalendarMember[] }>(
  '/api/calendario/miembros',
  { server: false, key: 'calendar-members' },
)
const memberIds = ref<string[]>(props.day?.members.map(member => member.userId) ?? [])
const memberFilter = ref('')
const memberOptions = computed(() => {
  const active = (memberList.value?.items ?? []).map(member => ({ id: member.id, name: member.name }))
  const known = new Set(active.map(member => member.id))
  const assigned = (props.day?.members ?? [])
    .filter(member => !known.has(member.userId))
    .map(member => ({ id: member.userId, name: m.inactiveMember }))
  const needle = memberFilter.value.trim().toLowerCase()
  return [...active, ...assigned].filter(member => !needle || member.name.toLowerCase().includes(needle))
})
const membersFull = computed(() => memberIds.value.length >= WORK_DAY_MAX_MEMBERS)

// ---- material (referencias a colecciones, listas y carpetas)
interface MaterialOption { id: string, name: string }
interface MaterialTab {
  type: WorkDayMaterialType
  label: string
  empty: string
  loadFailed: string
  load: () => Promise<MaterialOption[]>
}

/** Las carpetas se muestran con su ruta («Eventos / Navidad») para distinguir las que se llaman igual. */
function folderOptions(nodes: FolderTreeNode[]): MaterialOption[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const path = (node: FolderTreeNode): string => {
    const names = [node.name]
    for (let parent = node.parentId ? byId.get(node.parentId) : undefined; parent && names.length < 20; parent = parent.parentId ? byId.get(parent.parentId) : undefined) {
      names.unshift(parent.name)
    }
    return names.join(' / ')
  }
  return nodes.map(node => ({ id: node.id, name: path(node) })).sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

const TABS: MaterialTab[] = [
  {
    type: 'song_collection',
    label: 'Canciones',
    empty: 'Aún no hay colecciones de canciones',
    loadFailed: m.load.songCollections,
    load: async () => (await api<{ items: SongCollection[] }>('/api/songs/collections')).items.map(({ id, name }) => ({ id, name })),
  },
  {
    type: 'youtube_playlist',
    label: 'YouTube',
    empty: 'Aún no hay listas de YouTube',
    loadFailed: m.load.youtubePlaylists,
    load: async () => (await api<{ items: YoutubePlaylist[] }>('/api/youtube/playlists')).items.map(({ id, name }) => ({ id, name })),
  },
  {
    type: 'folder',
    label: 'Carpetas',
    empty: 'Aún no hay carpetas en el drive',
    loadFailed: m.load.folders,
    load: async () => folderOptions(await api<FolderTreeNode[]>('/api/folders/tree')),
  },
]

const tab = ref<WorkDayMaterialType | null>(null)
const activeTab = computed(() => TABS.find(item => item.type === tab.value) ?? null)
const lists = reactive<Record<WorkDayMaterialType, { status: 'idle' | 'loading' | 'ready' | 'error', items: MaterialOption[] }>>({
  song_collection: { status: 'idle', items: [] },
  youtube_playlist: { status: 'idle', items: [] },
  folder: { status: 'idle', items: [] },
})
const chosen = reactive<Record<WorkDayMaterialType, MaterialOption[]>>({
  song_collection: [],
  youtube_playlist: [],
  folder: [],
})
for (const material of props.day?.materials ?? []) chosen[material.type].push({ id: material.refId, name: material.name })
const chosenAll = computed(() => TABS.flatMap(item => chosen[item.type].map(option => ({ ...option, type: item.type, kind: item.label }))))

async function loadTab(item: MaterialTab) {
  const list = lists[item.type]
  list.status = 'loading'
  try {
    list.items = await item.load()
    list.status = 'ready'
  }
  catch {
    list.status = 'error'
  }
}

function openTab(item: MaterialTab) {
  tab.value = item.type
  if (lists[item.type].status === 'idle') loadTab(item)
}

const isChosen = (type: WorkDayMaterialType, id: string) => chosen[type].some(option => option.id === id)

function toggleMaterial(type: WorkDayMaterialType, option: MaterialOption) {
  if (isChosen(type, option.id)) chosen[type] = chosen[type].filter(item => item.id !== option.id)
  else if (chosen[type].length < WORK_DAY_MAX_MATERIALS) chosen[type].push(option)
}

// ---- cambios sin guardar
const snapshot = () => JSON.stringify([
  r$.$value,
  slots.value.map(({ start, end }) => [start, end]),
  [...memberIds.value].sort(),
  TABS.map(item => chosen[item.type].map(option => option.id).sort()),
])
const initial = snapshot()
const dirty = computed(() => snapshot() !== initial)

async function submit() {
  // El candado se pone antes de validar (que es asíncrono): un doble clic no envía dos veces.
  if (saving.value) return
  saving.value = true
  submitted.value = true
  const { valid, data } = await r$.$validate()
  const checked = slotCheck.value
  if (!valid || !checked.ok) {
    saving.value = false
    await nextTick()
    form.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  const saved = await calendar.save({
    title: data.title.trim(),
    date: data.date,
    kind: data.kind as WorkDayKind,
    status: data.status as WorkDayStatus,
    auditorium: data.auditorium.trim(),
    slots: checked.slots,
    memberIds: memberIds.value,
    songCollectionIds: chosen.song_collection.map(option => option.id),
    youtubePlaylistIds: chosen.youtube_playlist.map(option => option.id),
    folderIds: chosen.folder.map(option => option.id),
  }, props.day?.id)
  if (!saved) {
    saving.value = false
    return
  }
  // Ya está guardado: salir no pregunta. El calendario abre en el mes del día.
  done = true
  await navigateTo({ path: '/calendario', query: { fecha: saved.date } })
  saving.value = false
}

// ---- salir: de vuelta al calendario, en el mes del día (o de la fecha con la que se abrió)
const backDate = props.day?.date ?? props.initialDate
const backLink = { path: '/calendario', query: backDate ? { fecha: backDate } : {} }

/** «Cancelar» navega como el enlace de volver: el guardián de abajo decide si hay que preguntar. */
function cancel() {
  return navigateTo(backLink)
}

/** Guardado con éxito: ya no hay nada que perder. */
let done = false
let stopGuard: (() => void) | undefined
// El guardián vive mientras el formulario está montado (no depende de ser el componente de `<RouterView>`). Mientras
// guarda no se sale; con cambios sin guardar, pregunta antes.
onMounted(() => {
  stopGuard = router.beforeEach(async (to, from) => {
    if (done || to.path === from.path || !dirty.value) return true
    if (saving.value) return false
    return confirm({ title: m.discardConfirm, message: m.discardBody, confirmLabel: 'Salir sin guardar', danger: true })
  })
})
onBeforeUnmount(() => stopGuard?.())

if (import.meta.client) {
  useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
    if (done || !dirty.value) return
    event.preventDefault()
    // Navegadores que todavía piden `returnValue` para mostrar el aviso.
    event.returnValue = ''
  })
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-5xl flex-col gap-5">
    <header class="flex flex-col items-start gap-2">
      <NuxtLink :to="backLink" class="btn btn-ghost -ml-3">
        <Icon name="lucide:arrow-left" class="size-5" aria-hidden="true" />
        {{ m.back }}
      </NuxtLink>
      <h1 class="text-2xl font-semibold">{{ day ? m.editTitle : m.schedule }}</h1>
    </header>

    <form ref="form" class="flex flex-col gap-5" novalidate @submit.prevent="submit">
      <div class="grid items-start gap-5 lg:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-5 rounded-box border border-base-300 bg-base-100 p-4">
          <div class="flex flex-col gap-1">
            <label :for="`${uid}-name`" class="text-sm font-medium">Título del evento</label>
            <input
              :id="`${uid}-name`"
              v-model="r$.$value.title"
              type="text"
              class="input w-full"
              :class="{ 'input-error': fieldError('title') }"
              :aria-invalid="fieldError('title') ? 'true' : undefined"
              :aria-describedby="`${uid}-name-help`"
              @blur="r$.title?.$touch()"
            >
            <p :id="`${uid}-name-help`" class="text-sm" :class="fieldError('title') ? 'text-error' : 'text-base-content/70'">
              {{ fieldError('title') || 'Es el texto que se ve en el calendario.' }}
            </p>
          </div>

          <div class="flex flex-col gap-1">
            <label :for="`${uid}-date`" class="text-sm font-medium">Fecha</label>
            <input
              :id="`${uid}-date`"
              v-model="r$.$value.date"
              type="date"
              class="input w-full"
              :class="{ 'input-error': fieldError('date') }"
              :aria-invalid="fieldError('date') ? 'true' : undefined"
              :aria-describedby="fieldError('date') ? `${uid}-date-error` : undefined"
              @blur="r$.date?.$touch()"
            >
            <p v-if="fieldError('date')" :id="`${uid}-date-error`" class="text-sm text-error">{{ fieldError('date') }}</p>
          </div>

          <fieldset class="flex flex-col gap-2" :aria-describedby="`${uid}-kind-help`">
            <legend class="text-sm font-medium">Tipo de día</legend>
            <div class="flex flex-wrap gap-x-6 gap-y-1">
              <label v-for="kind in WORK_DAY_KINDS" :key="kind" class="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  v-model="r$.$value.kind"
                  type="radio"
                  class="radio radio-primary"
                  :name="`${uid}-kind`"
                  :value="kind"
                  :aria-invalid="fieldError('kind') ? 'true' : undefined"
                  @change="r$.kind?.$touch()"
                >
                {{ WORK_DAY_KIND_LABELS[kind] }}
              </label>
            </div>
            <div :id="`${uid}-kind-help`" class="flex flex-col gap-1">
              <p v-if="fieldError('kind')" class="text-sm text-error">{{ fieldError('kind') }}</p>
              <!-- La pista nunca elige por la persona: solo informa. -->
              <p role="status" class="text-sm text-base-content/70">{{ usualDay ? m.usualDayHint : '' }}</p>
            </div>
          </fieldset>

          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium">Rangos de hora</legend>
            <ul class="flex flex-col gap-3">
              <li v-for="(slot, index) in slots" :key="slot.key" class="flex flex-col gap-1">
                <div class="flex items-end gap-2">
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <label :for="`${uid}-start-${slot.key}`" class="text-sm text-base-content/70">Inicio<span class="sr-only"> del rango {{ index + 1 }}</span></label>
                    <input
                      :id="`${uid}-start-${slot.key}`"
                      v-model="slot.start"
                      type="time"
                      class="input w-full"
                      :class="{ 'input-error': slotError(index) }"
                      :aria-invalid="slotError(index) ? 'true' : undefined"
                      :aria-describedby="slotError(index) ? `${uid}-slot-error-${slot.key}` : undefined"
                    >
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <label :for="`${uid}-end-${slot.key}`" class="text-sm text-base-content/70">Fin<span class="sr-only"> del rango {{ index + 1 }}</span></label>
                    <input
                      :id="`${uid}-end-${slot.key}`"
                      v-model="slot.end"
                      type="time"
                      class="input w-full"
                      :class="{ 'input-error': slotError(index) }"
                      :aria-invalid="slotError(index) ? 'true' : undefined"
                      :aria-describedby="slotError(index) ? `${uid}-slot-error-${slot.key}` : undefined"
                    >
                  </div>
                  <button
                    type="button"
                    class="btn btn-ghost btn-square"
                    :disabled="slots.length === 1"
                    :aria-label="`Quitar el rango ${index + 1}`"
                    @click="removeSlot(index)"
                  >
                    <Icon name="lucide:trash-2" class="size-5" aria-hidden="true" />
                  </button>
                </div>
                <p v-if="slotError(index)" :id="`${uid}-slot-error-${slot.key}`" class="text-sm text-error">{{ slotError(index) }}</p>
              </li>
            </ul>
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn" :disabled="slots.length >= WORK_DAY_MAX_SLOTS" @click="addSlot">
                <Icon name="lucide:plus" class="size-4" aria-hidden="true" />
                Agregar rango
              </button>
              <span v-if="slots.length >= WORK_DAY_MAX_SLOTS" class="text-sm text-base-content/70">{{ m.slotsLimit }}</span>
            </div>
          </fieldset>

          <div class="flex flex-col gap-1">
            <label :for="`${uid}-auditorium`" class="text-sm font-medium">Auditorio</label>
            <input
              :id="`${uid}-auditorium`"
              v-model="r$.$value.auditorium"
              type="text"
              class="input w-full"
              :class="{ 'input-error': fieldError('auditorium') }"
              :aria-invalid="fieldError('auditorium') ? 'true' : undefined"
              :aria-describedby="fieldError('auditorium') ? `${uid}-auditorium-error` : undefined"
              @blur="r$.auditorium?.$touch()"
            >
            <p v-if="fieldError('auditorium')" :id="`${uid}-auditorium-error`" class="text-sm text-error">{{ fieldError('auditorium') }}</p>
          </div>

          <div class="flex flex-col gap-1">
            <label :for="`${uid}-status`" class="text-sm font-medium">Estado</label>
            <select :id="`${uid}-status`" v-model="r$.$value.status" class="select w-full">
              <option v-for="status in WORK_DAY_STATUSES" :key="status" :value="status">{{ WORK_DAY_STATUS_LABELS[status] }}</option>
            </select>
          </div>
        </div>

        <div class="flex min-w-0 flex-col gap-5 rounded-box border border-base-300 bg-base-100 p-4">
          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium">Miembros <span class="font-normal text-base-content/70">({{ memberIds.length }} de {{ WORK_DAY_MAX_MEMBERS }})</span></legend>
            <SkeletonList v-if="!memberList && membersPending" :rows="2" />
            <ErrorState v-else-if="membersError && !memberList" :message="m.load.members" @retry="refreshMembers()" />
            <template v-else>
              <label :for="`${uid}-member-filter`" class="sr-only">Buscar miembros</label>
              <input :id="`${uid}-member-filter`" v-model="memberFilter" type="search" class="input w-full" placeholder="Buscar por nombre">
              <p v-if="memberOptions.length === 0" class="text-sm text-base-content/70">Nadie coincide con la búsqueda.</p>
              <ul v-else class="grid max-h-52 lg:max-h-72 gap-x-4 overflow-y-auto sm:grid-cols-2" aria-label="Personas del equipo">
                <li v-for="member in memberOptions" :key="member.id">
                  <label class="flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      v-model="memberIds"
                      type="checkbox"
                      class="checkbox checkbox-primary"
                      :value="member.id"
                      :disabled="membersFull && !memberIds.includes(member.id)"
                    >
                    <span class="min-w-0 break-words">{{ member.name }}</span>
                  </label>
                </li>
              </ul>
              <p v-if="membersFull" class="text-sm text-base-content/70">{{ CALENDAR_MESSAGES.membersMax }}</p>
            </template>
          </fieldset>

          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium">Material</legend>
            <p v-if="chosenAll.length === 0" class="text-sm text-base-content/70">{{ m.noMaterial }}. Elige una pestaña para adjuntar.</p>
            <ul v-else class="flex flex-wrap gap-2" aria-label="Material adjunto">
              <li v-for="option in chosenAll" :key="`${option.type}-${option.id}`" class="max-w-full">
                <button type="button" class="btn btn-soft h-auto min-h-11 max-w-full py-1" :aria-label="`Quitar ${option.name} (${option.kind})`" @click="toggleMaterial(option.type, option)">
                  <span class="min-w-0 break-words text-left">{{ option.name }}</span>
                  <Icon name="lucide:x" class="size-4 shrink-0" aria-hidden="true" />
                </button>
              </li>
            </ul>
            <div role="tablist" class="tabs tabs-box" aria-label="Tipo de material">
              <button
                v-for="item in TABS"
                :id="`${uid}-tab-${item.type}`"
                :key="item.type"
                type="button"
                role="tab"
                class="tab min-h-11 flex-1"
                :class="{ 'tab-active': tab === item.type }"
                :aria-selected="tab === item.type"
                :aria-controls="`${uid}-panel`"
                @click="openTab(item)"
              >
                {{ item.label }}
              </button>
            </div>
            <div v-if="activeTab" :id="`${uid}-panel`" role="tabpanel" :aria-labelledby="`${uid}-tab-${activeTab.type}`" class="flex flex-col gap-2">
              <SkeletonList v-if="lists[activeTab.type].status === 'loading'" :rows="2" />
              <ErrorState v-else-if="lists[activeTab.type].status === 'error'" :message="activeTab.loadFailed" @retry="loadTab(activeTab)" />
              <p v-else-if="lists[activeTab.type].items.length === 0" class="text-sm text-base-content/70">{{ activeTab.empty }}.</p>
              <ul v-else class="flex max-h-52 lg:max-h-72 flex-col overflow-y-auto" :aria-label="activeTab.label">
                <li v-for="option in lists[activeTab.type].items" :key="option.id">
                  <label class="flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-primary"
                      :checked="isChosen(activeTab.type, option.id)"
                      :disabled="chosen[activeTab.type].length >= WORK_DAY_MAX_MATERIALS && !isChosen(activeTab.type, option.id)"
                      @change="toggleMaterial(activeTab.type, option)"
                    >
                    <span class="min-w-0 break-words">{{ option.name }}</span>
                  </label>
                </li>
              </ul>
            </div>
          </fieldset>
        </div>
      </div>

      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" class="btn" :disabled="saving" @click="cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="loading loading-spinner motion-reduce:animate-none" aria-hidden="true" />
          {{ day ? 'Guardar cambios' : m.schedule }}
        </button>
      </div>
    </form>
    <p v-if="saving" class="sr-only" role="status">Guardando…</p>
  </div>
</template>
