<script setup lang="ts">
// Diálogo de colecciones (feature 006, FR-020–FR-024, contracts/ui.md). Tres modos:
// - sin `songId` ni `collectionId`: **crear vacía** (botón Nueva colección de la fila);
// - con `songId`: crear una colección con esa canción o agregarla a una existente;
// - con `collectionId`: ver la colección (abrir, generar y quitar cada canción; generar todas; renombrar y eliminar si eres su
//   autor o administrador).
// Se carga diferido (`LazySongCollectionDialog`).
import type { SongCollection, SongCollectionDetail, SongCollectionItem } from '#shared/types/api'
import { songCollectionSchema } from '~/utils/form-schemas'

const props = withDefaults(defineProps<{ songId?: string | null, songTitle?: string, collectionId?: string | null }>(), {
  songId: null,
  songTitle: '',
  collectionId: null,
})
const emit = defineEmits<{ close: [] }>()

const collections = useSongCollections()
const presentations = useSongPresentations()
const m = messages.songs.collection
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const nameId = useId()
const nameErrorId = useId()
const tab = ref<'new' | 'existing'>('new')
const saving = ref(false)
const mode = computed(() => (props.collectionId ? 'view' : props.songId ? 'song' : 'create'))

// ---- crear (vacía o con la canción) y agregar a una existente
const { data: list, pending: listPending, error: listError, refresh: refreshList } = useSongCollectionList()
const { r$ } = useFormSchema({ name: '' }, songCollectionSchema)
const nameError = computed(() => r$.$errors.name[0] ?? '')

async function create() {
  const { valid, data } = await r$.$validate()
  if (!valid) return
  saving.value = true
  const created = await collections.create(data.name.trim(), props.songId ?? undefined)
  saving.value = false
  if (created) close()
}

async function addTo(collection: SongCollection) {
  if (!props.songId || saving.value) return
  saving.value = true
  const ok = await collections.addSong(collection, props.songId)
  saving.value = false
  if (ok) close()
}

// ---- ver una colección
const detailUrl = computed(() => `/api/songs/collections/${props.collectionId}`)
const { data: detail, pending: detailPending, error: detailError, refresh: refreshDetail } = useApiFetch<SongCollectionDetail>(detailUrl, {
  immediate: !!props.collectionId,
  server: false,
})
const canManage = computed(() => !!detail.value && collections.canManage(detail.value))
const renaming = ref(false)
const rename$ = useFormSchema({ name: '' }, songCollectionSchema).r$
const renameError = computed(() => rename$.$errors.name[0] ?? '')

function startRename() {
  rename$.$reset({ toState: { name: detail.value?.name ?? '' } })
  renaming.value = true
}

async function saveRename() {
  const { valid, data } = await rename$.$validate()
  if (!valid || !detail.value) return
  saving.value = true
  const updated = await collections.rename(detail.value, data.name.trim())
  saving.value = false
  if (updated) {
    renaming.value = false
    await refreshDetail()
  }
}

async function removeCollection() {
  if (!detail.value) return
  if (await collections.remove(detail.value)) close()
}

async function removeItem(item: SongCollectionItem) {
  if (!detail.value) return
  if (await collections.removeSong(detail.value, item)) await refreshDetail()
}

function generateItem(item: SongCollectionItem) {
  presentations.enqueue([item])
}

async function generateAll() {
  if (detail.value) await collections.generateSongs(detail.value.items)
}

function addedBy(item: SongCollectionItem) {
  return item.addedBy.active ? item.addedBy.name : messages.youtube.inactiveUser
}

const heading = computed(() => {
  if (mode.value === 'view') return detail.value?.name ?? 'Colección'
  return mode.value === 'song' ? 'Guardar en una colección' : m.new
})

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

      <template v-if="mode !== 'view'">
        <template v-if="mode === 'song'">
          <p v-if="songTitle" class="text-sm text-base-content/70">Canción: <span class="font-medium text-base-content">{{ songTitle }}</span></p>
          <div role="tablist" class="tabs tabs-box">
            <button type="button" role="tab" class="tab min-h-11 flex-1" :class="{ 'tab-active': tab === 'new' }" :aria-selected="tab === 'new'" @click="tab = 'new'">
              {{ m.new }}
            </button>
            <button type="button" role="tab" class="tab min-h-11 flex-1" :class="{ 'tab-active': tab === 'existing' }" :aria-selected="tab === 'existing'" @click="tab = 'existing'">
              Agregar a una existente
            </button>
          </div>
        </template>

        <form v-if="mode === 'create' || tab === 'new'" :role="mode === 'song' ? 'tabpanel' : undefined" class="flex flex-col gap-2" novalidate @submit.prevent="create">
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
              <span v-if="saving" class="loading loading-spinner motion-reduce:animate-none" aria-hidden="true" />
              {{ m.create }}
            </button>
          </div>
        </form>

        <div v-else role="tabpanel" class="flex min-h-0 flex-col gap-2 overflow-y-auto">
          <SkeletonList v-if="!list && listPending" :rows="3" />
          <ErrorState v-else-if="listError && !list" :message="messages.songs.load.collections" @retry="refreshList()" />
          <EmptyState v-else-if="!list?.items.length" icon="lucide:list-music" title="Aún no hay colecciones" :description="`Crea la primera en la pestaña «${m.new}».`" />
          <ul v-else class="flex flex-col gap-2" aria-label="Colecciones del equipo">
            <li v-for="collection in list.items" :key="collection.id">
              <button type="button" class="btn btn-block justify-start" :disabled="saving" @click="addTo(collection)">
                <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-left">{{ collection.name }}</span>
                <span class="text-sm font-normal text-base-content/70">{{ pluralize(collection.itemCount, 'canción', 'canciones') }}</span>
              </button>
            </li>
          </ul>
        </div>
      </template>

      <template v-else>
        <SkeletonList v-if="!detail && detailPending" :rows="3" />
        <ErrorState v-else-if="detailError && !detail" :message="messages.songs.load.collection" @retry="refreshDetail()" />
        <template v-else-if="detail">
          <p class="text-sm text-base-content/70">
            Creada por {{ detail.author.active ? detail.author.name : messages.youtube.inactiveUser }} · {{ pluralize(detail.itemCount, 'canción', 'canciones') }}
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
          <div v-else class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary" :disabled="detail.items.length === 0" @click="generateAll">
              <Icon name="lucide:presentation" class="size-4" aria-hidden="true" />
              Generar colección
            </button>
            <template v-if="canManage">
              <button type="button" class="btn" @click="startRename">
                <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
                Renombrar
              </button>
              <button type="button" class="btn btn-error btn-soft" @click="removeCollection">
                <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />
                Eliminar colección
              </button>
            </template>
          </div>

          <EmptyState v-if="detail.items.length === 0" icon="lucide:music" :title="m.empty" description="Abre una canción y pulsa Agregar a colección." />
          <ul v-else class="flex min-h-0 flex-col gap-3 overflow-y-auto" :aria-label="`Canciones de ${detail.name}`">
            <li v-for="item in detail.items" :key="item.id" class="flex flex-col gap-2 rounded-box border border-base-300 p-3 sm:flex-row sm:items-center">
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="break-words font-medium">{{ item.title }}</span>
                <span class="truncate text-sm text-base-content/70">{{ [item.artist, `Agregada por ${addedBy(item)}`].filter(Boolean).join(' · ') }}</span>
              </span>
              <div class="flex flex-wrap gap-2">
                <NuxtLink :to="`/canciones/${item.id}`" class="btn" :aria-label="`Abrir ${item.title}`" @click="close">
                  <Icon name="lucide:file-text" class="size-4" aria-hidden="true" />
                  Abrir
                </NuxtLink>
                <button type="button" class="btn" :disabled="presentations.isBusy(item.id)" :aria-label="`Generar la presentación de ${item.title}`" @click="generateItem(item)">
                  <Icon name="lucide:presentation" class="size-4" aria-hidden="true" />
                  Generar
                </button>
                <button type="button" class="btn btn-ghost btn-square" :aria-label="`Quitar ${item.title} de la colección`" @click="removeItem(item)">
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
