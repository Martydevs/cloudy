<script setup lang="ts">
// Detalle de un día de trabajo: solo lectura para todo el equipo; quien administra además edita y elimina. El estado lo
// cambia quien administra y también el editor asignado al día (`canSetWorkDayStatus`; el servidor lo vuelve a comprobar).
// El material llega resuelto (nombres actuales) y enlaza a su página. Se carga diferido (`LazyWorkDayDetailDialog`).
// Título y auditorio son texto plano.
import { WORK_DAY_STATUSES, WORK_DAY_STATUS_LABELS } from '#shared/constants/calendar'
import { canSetWorkDayStatus } from '#shared/permissions'
import type { WorkDayDetail, WorkDayMaterial, WorkDayStatus } from '#shared/types/api'

const props = withDefaults(defineProps<{ dayId: string, canManage?: boolean }>(), { canManage: false })
const emit = defineEmits<{ close: [], edit: [day: WorkDayDetail] }>()

const m = messages.calendar
const calendar = useWorkCalendar()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const statusId = useId()
const busy = ref(false)

const url = computed(() => `/api/calendario/${props.dayId}`)
const { data: day, pending, error, refresh } = useApiFetch<WorkDayDetail>(url, { server: false, key: `work-day-${props.dayId}` })
const gone = computed(() => error.value?.statusCode === 404)

const { profile } = useMe()
const canStatus = computed(() => !!day.value && canSetWorkDayStatus(profile.value?.role, profile.value?.userId, day.value.members))

const MATERIAL: Record<WorkDayMaterial['type'], { icon: string, label: string, noun: [string, string] }> = {
  song_collection: { icon: 'lucide:music', label: 'Colección de canciones', noun: ['canción', 'canciones'] },
  youtube_playlist: { icon: 'lucide:circle-play', label: 'Lista de YouTube', noun: ['video', 'videos'] },
  folder: { icon: 'lucide:folder', label: 'Carpeta', noun: ['elemento', 'elementos'] },
}

function itemLink(material: WorkDayMaterial, id: string): string {
  return material.type === 'song_collection' ? `/canciones/${id}` : `/youtube/${id}`
}

async function changeStatus(event: Event) {
  if (!day.value) return
  const status = (event.target as HTMLSelectElement).value as WorkDayStatus
  busy.value = true
  await calendar.setStatus(day.value, status)
  await refresh()
  busy.value = false
}

async function remove() {
  if (!day.value) return
  busy.value = true
  const removed = await calendar.remove(day.value)
  busy.value = false
  if (removed) close()
}

onMounted(() => {
  dialog.value?.showModal()
})

function close() {
  dialog.value?.close()
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle" :aria-labelledby="titleId" @cancel.prevent="close">
    <div class="modal-box flex max-h-[90dvh] flex-col gap-4 sm:max-w-2xl">
      <header class="flex items-start gap-2">
        <h2 :id="titleId" class="flex-1 break-words text-lg font-semibold">{{ day?.title ?? 'Día de trabajo' }}</h2>
        <button type="button" class="btn btn-ghost btn-square" aria-label="Cerrar" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>

      <div class="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1 pb-1">
        <SkeletonList v-if="!day && pending" :rows="3" />
        <EmptyState v-else-if="gone && !day" icon="lucide:calendar-x" :title="m.gone" />
        <ErrorState v-else-if="error && !day" :message="m.load.day" @retry="refresh()" />
        <template v-else-if="day">
          <WorkDayBadges :kind="day.kind" :status="day.status" />
          <p v-if="!canStatus" class="text-sm text-base-content/70">{{ m.statusOnlyAssigned }}</p>

          <dl class="grid gap-3 sm:grid-cols-2">
            <div>
              <dt class="text-sm text-base-content/70">Fecha</dt>
              <dd class="font-medium first-letter:uppercase">{{ formatWorkDate(day.date, true) }}</dd>
            </div>
            <div>
              <dt class="text-sm text-base-content/70">Auditorio</dt>
              <dd class="break-words font-medium">{{ day.auditorium }}</dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="text-sm text-base-content/70">Horario</dt>
              <dd>
                <ul class="flex flex-wrap gap-2" aria-label="Rangos de hora">
                  <li v-for="slot in day.slots" :key="slot.id" class="badge badge-ghost font-medium">{{ formatSlot(slot) }}</li>
                </ul>
              </dd>
            </div>
          </dl>

          <section class="flex flex-col gap-2">
            <h3 class="font-semibold">Miembros</h3>
            <p v-if="day.members.length === 0" class="text-base-content/70">{{ m.noMembers }}</p>
            <ul v-else class="flex flex-wrap gap-2" aria-label="Miembros asignados">
              <li v-for="member in day.members" :key="member.userId" class="badge badge-ghost" :class="{ 'italic text-base-content/70': !member.active }">
                {{ member.active ? member.name : m.inactiveMember }}
              </li>
            </ul>
          </section>

          <section class="flex flex-col gap-2">
            <h3 class="font-semibold">Material</h3>
            <p v-if="day.materials.length === 0" class="text-base-content/70">{{ m.noMaterial }}</p>
            <ul v-else class="flex flex-col gap-3" aria-label="Material adjunto">
              <li v-for="material in day.materials" :key="`${material.type}-${material.refId}`" class="flex flex-col gap-2 rounded-box border border-base-300 p-3">
                <div class="flex items-start gap-2">
                  <Icon :name="MATERIAL[material.type].icon" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="break-words font-medium">{{ material.name }}</span>
                    <span class="text-sm text-base-content/70">
                      {{ MATERIAL[material.type].label }} · {{ pluralize(material.itemCount, ...MATERIAL[material.type].noun) }}
                    </span>
                  </div>
                  <NuxtLink v-if="material.type === 'folder'" :to="`/archivos/${material.refId}`" class="btn" :aria-label="`Abrir la carpeta ${material.name}`" @click="close">
                    <Icon name="lucide:folder-open" class="size-4" aria-hidden="true" />
                    Abrir
                  </NuxtLink>
                </div>
                <ul v-if="material.items.length > 0" class="flex flex-col" :aria-label="`Contenido de ${material.name}`">
                  <li v-for="item in material.items" :key="item.id">
                    <NuxtLink :to="itemLink(material, item.id)" class="link link-hover flex min-h-11 items-center break-words" @click="close">
                      {{ item.title }}
                    </NuxtLink>
                  </li>
                </ul>
                <p v-if="material.itemCount > material.items.length && material.type !== 'folder'" class="text-sm text-base-content/70">
                  Se muestran los primeros {{ material.items.length }}.
                </p>
              </li>
            </ul>
          </section>

          <p class="text-sm text-base-content/70">
            Agendado por {{ day.createdBy.active ? day.createdBy.name : m.inactiveMember }}
          </p>

          <div v-if="canStatus || canManage" class="flex flex-col gap-3 border-t border-base-300 pt-4 sm:flex-row sm:items-end">
            <div v-if="canStatus" class="flex flex-1 flex-col gap-1">
              <label :for="statusId" class="text-sm font-medium">Estado</label>
              <select :id="statusId" class="select w-full" :value="day.status" :disabled="busy" @change="changeStatus">
                <option v-for="status in WORK_DAY_STATUSES" :key="status" :value="status">{{ WORK_DAY_STATUS_LABELS[status] }}</option>
              </select>
            </div>
            <button v-if="canManage" type="button" class="btn" :disabled="busy" @click="emit('edit', day)">
              <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
              Editar
            </button>
            <button v-if="canManage" type="button" class="btn btn-error btn-soft" :disabled="busy" @click="remove">
              <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />
              Eliminar
            </button>
          </div>
        </template>
      </div>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">Cerrar</button>
    </div>
  </dialog>
</template>
