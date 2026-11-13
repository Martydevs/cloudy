<script setup lang="ts">
// Diálogo de colecciones de imágenes (feature 007, enmienda de historial; forma de `SongCollectionDialog`). Tres modos:
// - sin `imageId` ni `collectionId`: **crear vacía** (botón Nueva colección de la fila);
// - con `imageId`: crear una colección con esa imagen o guardarla en una existente;
// - con `collectionId`: ver la colección (ampliar, descargar y quitar cada imagen; renombrar y eliminar si eres su autor o
//   administrador).
// Se carga diferido (`LazyPrayerCollectionDialog`).
import type { PrayerImageCollection, PrayerImageCollectionDetail, PrayerImageCollectionItem } from '#shared/types/api'
import { prayerCollectionSchema } from '~/utils/form-schemas'

const props = withDefaults(defineProps<{ imageId?: string | null, collectionId?: string | null }>(), {
  imageId: null,
  collectionId: null,
})
const emit = defineEmits<{ close: [] }>()

const collections = usePrayerCollections()
const m = messages.prayers.collection
const p = messages.prayers
const { timeAgo } = useRelativeTime()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const nameId = useId()
const nameErrorId = useId()
const tab = ref<'new' | 'existing'>('new')
const saving = ref(false)
const mode = computed(() => (props.collectionId ? 'view' : props.imageId ? 'image' : 'create'))

// ---- crear (vacía o con la imagen) y guardar en una existente
const { data: list, pending: listPending, error: listError, refresh: refreshList } = usePrayerCollectionList()
const { r$ } = useFormSchema({ name: '' }, prayerCollectionSchema)
const nameError = computed(() => r$.$errors.name[0] ?? '')

async function create() {
  const { valid, data } = await r$.$validate()
  if (!valid) return
  saving.value = true
  const created = await collections.create(data.name.trim(), props.imageId ?? undefined)
  saving.value = false
  if (created) close()
}

async function addTo(collection: PrayerImageCollection) {
  if (!props.imageId || saving.value) return
  saving.value = true
  const ok = await collections.addImage(collection, props.imageId)
  saving.value = false
  if (ok) close()
}

// ---- ver una colección
const detailUrl = computed(() => `/api/peticiones/colecciones/${props.collectionId}`)
const { data: detail, pending: detailPending, error: detailError, refresh: refreshDetail } = useApiFetch<PrayerImageCollectionDetail>(detailUrl, {
  immediate: !!props.collectionId,
  server: false,
})
const canManage = computed(() => !!detail.value && collections.canManage(detail.value))
const renaming = ref(false)
const rename$ = useFormSchema({ name: '' }, prayerCollectionSchema).r$
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

async function removeItem(item: PrayerImageCollectionItem) {
  if (!detail.value) return
  if (await collections.removeImage(detail.value, item)) await refreshDetail()
}

function person(who: PrayerImageCollectionItem['addedBy']) {
  return who.active ? who.name : messages.youtube.inactiveUser
}

function itemTitle(item: PrayerImageCollectionItem) {
  return p.history.alt(p.history.count(item.requestCount), timeAgo(item.createdAt))
}

const previewing = ref<{ url: string, title: string } | null>(null)

const heading = computed(() => {
  if (mode.value === 'view') return detail.value?.name ?? m.title
  return mode.value === 'image' ? m.saveTitle : m.new
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
    <div class="modal-box flex max-h-[90dvh] flex-col gap-4 sm:max-w-3xl">
      <header class="flex items-start gap-2">
        <h2 :id="titleId" class="flex-1 break-words text-lg font-semibold">{{ heading }}</h2>
        <button type="button" class="btn btn-ghost btn-square" :aria-label="p.close" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>

      <template v-if="mode !== 'view'">
        <div v-if="mode === 'image'" role="tablist" class="tabs tabs-box">
          <button type="button" role="tab" class="tab min-h-11 flex-1" :class="{ 'tab-active': tab === 'new' }" :aria-selected="tab === 'new'" @click="tab = 'new'">
            {{ m.new }}
          </button>
          <button type="button" role="tab" class="tab min-h-11 flex-1" :class="{ 'tab-active': tab === 'existing' }" :aria-selected="tab === 'existing'" @click="tab = 'existing'">
            {{ m.existing }}
          </button>
        </div>

        <form v-if="mode === 'create' || tab === 'new'" :role="mode === 'image' ? 'tabpanel' : undefined" class="flex flex-col gap-2" novalidate @submit.prevent="create">
          <label :for="nameId" class="text-sm font-medium">{{ m.name }}</label>
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
            <button type="button" class="btn" @click="close">{{ p.cancel }}</button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <span v-if="saving" class="loading loading-spinner motion-reduce:animate-none" aria-hidden="true" />
              {{ m.create }}
            </button>
          </div>
        </form>

        <div v-else role="tabpanel" class="flex min-h-0 flex-col gap-2 overflow-y-auto">
          <SkeletonList v-if="!list && listPending" :rows="3" />
          <ErrorState v-else-if="listError && !list" :message="m.load" @retry="refreshList()" />
          <EmptyState v-else-if="!list?.items.length" icon="lucide:images" :title="m.empty" :description="m.emptyExisting(m.new)" />
          <ul v-else class="flex flex-col gap-2" :aria-label="m.list">
            <li v-for="collection in list.items" :key="collection.id">
              <button type="button" class="btn btn-block justify-start" :disabled="saving" @click="addTo(collection)">
                <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-left">{{ collection.name }}</span>
                <span class="text-sm font-normal text-base-content/70">{{ m.count(collection.itemCount) }}</span>
              </button>
            </li>
          </ul>
        </div>
      </template>

      <template v-else>
        <SkeletonList v-if="!detail && detailPending" :rows="3" />
        <ErrorState v-else-if="detailError && !detail" :message="m.loadOne" @retry="refreshDetail()" />
        <template v-else-if="detail">
          <p class="text-sm text-base-content/70">
            {{ m.createdBy(person(detail.author)) }} · {{ m.count(detail.itemCount) }}
          </p>

          <form v-if="renaming" class="flex flex-col gap-2" novalidate @submit.prevent="saveRename">
            <label :for="nameId" class="text-sm font-medium">{{ m.newName }}</label>
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
              <button type="submit" class="btn btn-primary" :disabled="saving">{{ m.save }}</button>
              <button type="button" class="btn" @click="renaming = false">{{ p.cancel }}</button>
            </div>
          </form>
          <div v-else-if="canManage" class="flex flex-wrap gap-2">
            <button type="button" class="btn" @click="startRename">
              <Icon name="lucide:pencil" class="size-4" aria-hidden="true" />
              {{ m.rename }}
            </button>
            <button type="button" class="btn btn-error btn-soft" @click="removeCollection">
              <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />
              {{ m.remove }}
            </button>
          </div>

          <EmptyState v-if="detail.items.length === 0" icon="lucide:image" :title="m.emptyItems" :description="m.emptyItemsHint" />
          <ul v-else class="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2" :aria-label="m.items(detail.name)">
            <li v-for="item in detail.items" :key="item.id" class="flex flex-col overflow-hidden rounded-box border border-base-300">
              <div class="aspect-[1376/768] w-full bg-base-200">
                <img :src="item.previewUrl" :alt="itemTitle(item)" loading="lazy" decoding="async" class="size-full object-contain">
              </div>
              <div class="flex flex-col gap-2 p-3">
                <span class="text-sm text-base-content/70">{{ p.history.count(item.requestCount) }} · {{ m.addedBy(person(item.addedBy)) }}</span>
                <div class="flex flex-wrap gap-2">
                  <a :href="item.downloadUrl" download class="btn btn-primary lg:btn-sm" :aria-label="`${p.download}: ${itemTitle(item)}`">
                    <Icon name="lucide:download" class="size-4" aria-hidden="true" />
                    {{ p.download }}
                  </a>
                  <button type="button" class="btn lg:btn-sm" :aria-label="`${p.preview}: ${itemTitle(item)}`" @click="previewing = { url: item.previewUrl, title: itemTitle(item) }">
                    <Icon name="lucide:maximize-2" class="size-4" aria-hidden="true" />
                    {{ p.preview }}
                  </button>
                  <button type="button" class="btn btn-ghost btn-square lg:btn-sm" :aria-label="`${m.removeItem}: ${itemTitle(item)}`" @click="removeItem(item)">
                    <Icon name="lucide:x" class="size-5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </template>
      </template>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">{{ p.close }}</button>
    </div>
  </dialog>
  <!-- Fuera del `<dialog>`: «Ver en grande» abre su propio modal encima. -->
  <LazyPrayerImagePreview v-if="previewing" :url="previewing.url" :title="previewing.title" @close="previewing = null" />
</template>
