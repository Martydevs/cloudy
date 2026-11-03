<script setup lang="ts">
// Diálogo de listas (FR-015–FR-018, FR-027, contracts/ui.md § Diálogo de lista). Con `videoId`: crear una lista nueva
// con ese video o agregarlo a una existente. Con `playlistId`: el detalle de la lista (abrir, descargar y quitar cada
// video; renombrar y eliminar si eres su autor o administrador). Se carga diferido (`LazyYoutubePlaylistDialog`).
import type { YoutubeFormat, YoutubePlaylist, YoutubePlaylistDetail, YoutubePlaylistItem } from '#shared/types/api'
import { youtubePlaylistSchema } from '~/utils/form-schemas'

const props = withDefaults(defineProps<{ videoId?: string | null, videoTitle?: string, playlistId?: string | null }>(), {
  videoId: null,
  videoTitle: '',
  playlistId: null,
})
const emit = defineEmits<{ close: [] }>()

const playlists = useYoutubePlaylists()
const downloads = useYoutubeDownloads()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const nameId = useId()
const nameErrorId = useId()
const tab = ref<'new' | 'existing'>('new')
const saving = ref(false)

// ---- modo video: crear o agregar
const { data: list, pending: listPending, error: listError, refresh: refreshList } = useYoutubePlaylistList()
const { r$ } = useFormSchema({ name: '' }, youtubePlaylistSchema)
const nameError = computed(() => r$.$errors.name[0] ?? '')

async function createWithVideo() {
  const { valid, data } = await r$.$validate()
  if (!valid || !props.videoId) return
  saving.value = true
  const created = await playlists.create(data.name.trim(), props.videoId)
  saving.value = false
  if (created) close()
}

async function addTo(playlist: YoutubePlaylist) {
  if (!props.videoId || saving.value) return
  saving.value = true
  const ok = await playlists.addVideo(playlist, props.videoId)
  saving.value = false
  if (ok) close()
}

// ---- modo detalle
const detailUrl = computed(() => `/api/youtube/playlists/${props.playlistId}`)
const { data: detail, pending: detailPending, error: detailError, refresh: refreshDetail } = useApiFetch<YoutubePlaylistDetail>(detailUrl, {
  immediate: !!props.playlistId,
  server: false,
})
const canManage = computed(() => !!detail.value && playlists.canManage(detail.value))
const renaming = ref(false)
const rename$ = useFormSchema({ name: '' }, youtubePlaylistSchema).r$
const renameError = computed(() => rename$.$errors.name[0] ?? '')

function startRename() {
  rename$.$reset({ toState: { name: detail.value?.name ?? '' } })
  renaming.value = true
}

async function saveRename() {
  const { valid, data } = await rename$.$validate()
  if (!valid || !detail.value) return
  saving.value = true
  const updated = await playlists.rename(detail.value, data.name.trim())
  saving.value = false
  if (updated) {
    renaming.value = false
    await refreshDetail()
  }
}

async function removePlaylist() {
  if (!detail.value) return
  if (await playlists.remove(detail.value)) close()
}

async function removeItem(item: YoutubePlaylistItem) {
  if (!detail.value) return
  if (await playlists.removeVideo(detail.value, item)) await refreshDetail()
}

function downloadItem(item: YoutubePlaylistItem, format: YoutubeFormat) {
  downloads.enqueue([item.videoId], format, item.title)
}

function addedBy(item: YoutubePlaylistItem) {
  return item.addedBy.active ? item.addedBy.name : messages.youtube.inactiveUser
}

const heading = computed(() => (props.playlistId ? detail.value?.name ?? 'Lista' : 'Guardar en una lista'))

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
        <h2 :id="titleId" class="flex-1 break-words text-lg font-semibold">{{ heading }}</h2>
        <button type="button" class="btn btn-ghost btn-square" aria-label="Cerrar" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>

      <!-- Modo video: crear una lista o agregar a una existente. -->
      <template v-if="videoId">
        <p v-if="videoTitle" class="text-sm text-base-content/70">Video: <span class="font-medium text-base-content">{{ videoTitle }}</span></p>
        <div role="tablist" class="tabs tabs-box">
          <button type="button" role="tab" class="tab min-h-11 flex-1" :class="{ 'tab-active': tab === 'new' }" :aria-selected="tab === 'new'" @click="tab = 'new'">
            Nueva lista
          </button>
          <button type="button" role="tab" class="tab min-h-11 flex-1" :class="{ 'tab-active': tab === 'existing' }" :aria-selected="tab === 'existing'" @click="tab = 'existing'">
            Agregar a una existente
          </button>
        </div>

        <form v-if="tab === 'new'" role="tabpanel" class="flex flex-col gap-2" novalidate @submit.prevent="createWithVideo">
          <label :for="nameId" class="text-sm font-medium">Nombre</label>
          <input
            :id="nameId"
            v-model="r$.$value.name"
            type="text"
            class="input w-full"
            :class="{ 'input-error': nameError }"
            :aria-invalid="nameError ? 'true' : undefined"
            :aria-describedby="nameError ? nameErrorId : undefined"
            @blur="r$.name?.$touch()"
          >
          <p v-if="nameError" :id="nameErrorId" class="text-sm text-error">{{ nameError }}</p>
          <div class="modal-action mt-2">
            <button type="button" class="btn" @click="close">Cancelar</button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <span v-if="saving" class="loading loading-spinner" aria-hidden="true" />
              Crear lista
            </button>
          </div>
        </form>

        <div v-else role="tabpanel" class="flex min-h-0 flex-col gap-2 overflow-y-auto">
          <SkeletonList v-if="!list && listPending" :rows="3" />
          <ErrorState v-else-if="listError && !list" :message="messages.youtube.load.playlists" @retry="refreshList()" />
          <EmptyState v-else-if="!list?.items.length" icon="lucide:list-video" title="Aún no hay listas" description="Crea la primera en la pestaña «Nueva lista»." />
          <ul v-else class="flex flex-col gap-2" aria-label="Listas del equipo">
            <li v-for="playlist in list.items" :key="playlist.id">
              <button type="button" class="btn btn-block justify-start" :disabled="saving" @click="addTo(playlist)">
                <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-left">{{ playlist.name }}</span>
                <span class="text-sm font-normal text-base-content/70">{{ pluralize(playlist.itemCount, 'video', 'videos') }}</span>
              </button>
            </li>
          </ul>
        </div>
      </template>

      <!-- Modo detalle de una lista. -->
      <template v-else-if="playlistId">
        <SkeletonList v-if="!detail && detailPending" :rows="3" />
        <ErrorState v-else-if="detailError && !detail" :message="messages.youtube.load.playlist" @retry="refreshDetail()" />
        <template v-else-if="detail">
          <p class="text-sm text-base-content/70">
            Creada por {{ detail.author.active ? detail.author.name : messages.youtube.inactiveUser }} · {{ pluralize(detail.itemCount, 'video', 'videos') }}
          </p>

          <form v-if="renaming" class="flex flex-col gap-2" novalidate @submit.prevent="saveRename">
            <label :for="nameId" class="text-sm font-medium">Nuevo nombre</label>
            <input
              :id="nameId"
              v-model="rename$.$value.name"
              type="text"
              class="input w-full"
              :class="{ 'input-error': renameError }"
              :aria-invalid="renameError ? 'true' : undefined"
              :aria-describedby="renameError ? nameErrorId : undefined"
              @blur="rename$.name?.$touch()"
            >
            <p v-if="renameError" :id="nameErrorId" class="text-sm text-error">{{ renameError }}</p>
            <div class="flex flex-wrap gap-2">
              <button type="submit" class="btn btn-primary" :disabled="saving">Guardar</button>
              <button type="button" class="btn" @click="renaming = false">Cancelar</button>
            </div>
          </form>
          <div v-else-if="canManage" class="flex flex-wrap gap-2">
            <button type="button" class="btn" @click="startRename">
              <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
              Renombrar
            </button>
            <button type="button" class="btn btn-error btn-soft" @click="removePlaylist">
              <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />
              Eliminar lista
            </button>
          </div>

          <EmptyState v-if="detail.items.length === 0" icon="lucide:film" title="Esta lista aún no tiene videos" description="Abre un video y pulsa Crear lista para agregarlo." />
          <ul v-else class="flex min-h-0 flex-col gap-3 overflow-y-auto" :aria-label="`Videos de ${detail.name}`">
            <li v-for="item in detail.items" :key="item.videoId" class="flex flex-col gap-2 rounded-box border border-base-300 p-2 sm:flex-row sm:items-center">
              <div class="flex min-w-0 flex-1 items-center gap-3">
                <span class="relative w-28 shrink-0 overflow-hidden rounded-box bg-base-300">
                  <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" alt="" width="112" height="63" loading="lazy" class="aspect-video w-full object-cover">
                  <span v-else class="flex aspect-video items-center justify-center"><Icon name="lucide:film" class="size-5 text-base-content/40" aria-hidden="true" /></span>
                  <span v-if="item.durationSeconds !== null" class="badge badge-neutral badge-sm absolute bottom-1 right-1">{{ formatDuration(item.durationSeconds) }}</span>
                </span>
                <span class="flex min-w-0 flex-col">
                  <span class="line-clamp-2 break-words font-medium">{{ item.title }}</span>
                  <span class="truncate text-sm text-base-content/70">Agregado por {{ addedBy(item) }}</span>
                </span>
              </div>
              <div class="flex flex-wrap gap-2">
                <NuxtLink :to="`/youtube/${item.videoId}`" class="btn" :aria-label="`Abrir ${item.title}`" @click="close">
                  <Icon name="lucide:play" class="size-4" aria-hidden="true" />
                  Abrir
                </NuxtLink>
                <YoutubeFormatPicker label="Descargar" :primary="false" inline @select="(format: YoutubeFormat) => downloadItem(item, format)" />
                <button type="button" class="btn btn-ghost btn-square" :aria-label="`Quitar ${item.title} de la lista`" @click="removeItem(item)">
                  <Icon name="lucide:x" class="size-5" aria-hidden="true" />
                </button>
              </div>
            </li>
          </ul>
        </template>
      </template>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">Cerrar</button>
    </div>
  </dialog>
</template>
