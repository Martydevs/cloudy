<script setup lang="ts">
// Página de una generación (enmienda «Página de generación» de Peticiones, 2026-11-15): todo lo que produjo un clic en
// «Generar imágenes», como un pase de diapositivas (`Slideshow`, genérico). Las imágenes aparecen a medida que terminan;
// las que faltan muestran su estado (en cola, generándose, fallida, cancelada o sin terminar). Desde aquí se descargan
// (una o varias), se guardan en el drive o en una colección. La cola en curso viene de /peticiones y esta página toma el
// guardián de salida mientras haya imágenes en curso.
import type { PrayerGenerationSlide } from '~/composables/usePrayerGeneration'

definePageMeta({
  layout: 'dashboard',
  access: 'private',
  roles: ['editor', 'admin'],
  // Cada generación es una página nueva.
  key: route => route.path,
})

const route = useRoute()
const generationId = computed(() => String(route.params.id ?? ''))
const m = messages.prayers
const g = messages.prayers.generation
const toast = useToast()
const { timeAgo } = useRelativeTime()
const mounted = useMounted()

// Solo en el SSR (el endpoint es configuración privada): la imagen actual es el LCP y llega por el almacenamiento.
if (import.meta.server) useHead({ link: storagePreconnect(useRuntimeConfig().awsEndpointUrlS3) })

const { generation, error, pending, refresh, notFound, slides, ready, unfinished, generateMissing, retry, cancel, requeue, dismiss } = usePrayerGeneration(generationId)

// Ir y volver entre /peticiones y sus generaciones no vacía la cola ni avisa.
usePrayerLeaveGuard({ keep: path => path === '/peticiones' || isPrayerGenerationPath(path) })

const title = computed(() => {
  const createdAt = generation.value?.createdAt
  if (!createdAt) return 'Generación'
  return mounted.value ? g.title(formatDayTime(createdAt)) : g.titleRelative(timeAgo(createdAt))
})
useHead({ title: () => `${title.value} · Peticiones · Cloudy` })

const author = computed(() => {
  const person = generation.value?.author
  return person ? (person.active ? person.name : messages.youtube.inactiveUser) : ''
})

const current = ref(0)

// ---- Pie de la diapositiva
function caption(slide: PrayerGenerationSlide, total: number) {
  const base = g.caption(slide.index, total, m.history.count(slide.fileIds.length))
  if (slide.image) {
    const by = slide.image.author.active ? slide.image.author.name : messages.youtube.inactiveUser
    return `${base} · ${g.captionBy(timeAgo(slide.image.createdAt), by)}`
  }
  return `${base} · ${g.states[slide.state]}`
}

// ---- Elegir varias (descargar o guardar en el drive)
const selecting = ref(false)
const chosen = ref<string[]>([])
const readySlides = computed(() => slides.value.filter(slide => slide.image))
const chosenSlides = computed(() => readySlides.value.filter(slide => chosen.value.includes(slide.key)))
// Lo elegido se limita a lo que está listo.
watch(readySlides, (list) => {
  const keys = new Set(list.map(slide => slide.key))
  if (chosen.value.some(key => !keys.has(key))) chosen.value = chosen.value.filter(key => keys.has(key))
})

function startSelecting() {
  selecting.value = true
  chosen.value = []
}
function stopSelecting() {
  selecting.value = false
  chosen.value = []
}

// ---- Descargar varias: de una en una (sin zip), con una pausa para que el navegador no bloquee las siguientes.
const downloading = ref<{ done: number, total: number } | null>(null)
async function downloadChosen() {
  const list = chosenSlides.value
  if (list.length === 0 || downloading.value) return
  downloading.value = { done: 0, total: list.length }
  for (const [i, slide] of list.entries()) {
    downloading.value = { done: i + 1, total: list.length }
    triggerDownload(slide.image!.downloadUrl, prayerImageFileName(slide.image!, 'image/png'))
    if (i < list.length - 1) await new Promise(resolve => setTimeout(resolve, 700))
  }
  downloading.value = null
  toast.success(g.downloaded(list.length))
}

// ---- Guardar en el drive (por el navegador, sin backend nuevo)
const drive = usePrayerDriveSave()
function saveToDrive(list: readonly PrayerGenerationSlide[]) {
  const queued = drive.save(list.filter(slide => slide.image).map(slide => ({ image: slide.image!, label: g.drive.item(slide.index) })))
  if (queued > 1) toast.info(g.drive.queuedMany(queued))
}

// ---- Guardar en colección
const collectionImageId = ref<string | null>(null)

function thumbLabel(slide: PrayerGenerationSlide) {
  return g.thumb(slide.index, g.states[slide.state])
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 v-if="!generation" class="sr-only">Generación</h1>

    <SkeletonList v-if="!generation && pending" :rows="4" />

    <template v-else-if="notFound">
      <NuxtLink to="/peticiones" class="btn btn-ghost self-start">
        <Icon name="lucide:arrow-left" class="size-5" aria-hidden="true" />
        {{ g.back }}
      </NuxtLink>
      <div role="alert" class="alert alert-error alert-soft flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Icon name="lucide:circle-alert" class="size-6 shrink-0" aria-hidden="true" />
        <span class="flex-1">{{ g.notFound }}</span>
        <NuxtLink to="/peticiones" class="btn">{{ g.back }}</NuxtLink>
      </div>
    </template>

    <ErrorState v-else-if="!generation && error" :message="g.load" @retry="refresh()" />

    <template v-else-if="generation && slides.length === 0">
      <NuxtLink to="/peticiones" class="btn btn-ghost self-start">
        <Icon name="lucide:arrow-left" class="size-5" aria-hidden="true" />
        {{ g.back }}
      </NuxtLink>
      <EmptyState icon="lucide:images" :title="g.empty" :description="g.emptyHint" />
    </template>

    <Slideshow
      v-else-if="generation"
      v-model:index="current"
      v-model:selected="chosen"
      :slides="slides"
      :labels="g.slideshow"
      :thumb-label="thumbLabel"
      :selectable="selecting"
      :can-select="slide => !!slide.image"
      :select-label="slide => g.select(slide.index)"
      :preload="slide => slide.image?.previewUrl ?? null"
      query="i"
    >
      <template #header>
        <header class="flex flex-col gap-3">
          <NuxtLink to="/peticiones" class="btn btn-ghost self-start">
            <Icon name="lucide:arrow-left" class="size-5" aria-hidden="true" />
            {{ g.back }}
          </NuxtLink>
          <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div class="flex min-w-0 flex-col gap-1">
              <h1 class="text-2xl font-semibold">{{ title }}</h1>
              <p class="text-base-content/70">{{ g.byAuthor(author) }}</p>
            </div>
            <p class="font-medium" role="status">{{ g.progress(ready, slides.length) }}</p>
          </div>
          <div v-if="unfinished.length > 0" class="alert alert-info alert-soft flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Icon name="lucide:info" class="size-6 shrink-0" aria-hidden="true" />
            <span class="flex-1">{{ g.unfinished(unfinished.length) }}</span>
            <button type="button" class="btn btn-primary" @click="generateMissing()">
              <Icon name="lucide:sparkles" class="size-5" aria-hidden="true" />
              {{ g.generateMissing }}
            </button>
          </div>
        </header>
      </template>

      <template #slide="{ slide, first }">
        <PrayerGenerationSlide
          :key="slide.key"
          :slide="slide"
          :priority="first"
          @retry="slide.item && retry(slide.item.key)"
          @cancel="slide.item && cancel(slide.item.key)"
          @requeue="slide.item && requeue(slide.item.key)"
          @dismiss="slide.item && dismiss(slide.item.key)"
          @missing="generateMissing()"
        />
      </template>

      <template #thumb="{ slide, near }">
        <img
          v-if="slide.image && near"
          :src="slide.image.previewUrl"
          alt=""
          loading="lazy"
          decoding="async"
          class="size-full object-cover"
        >
        <span v-else-if="slide.state === 'queued' || slide.state === 'running'" class="skeleton block size-full rounded-none motion-reduce:animate-none" />
        <span v-else class="flex size-full items-center justify-center text-base-content/60">
          <Icon :name="slide.image ? 'lucide:image' : slide.state === 'failed' ? 'lucide:image-off' : 'lucide:images'" class="size-6" aria-hidden="true" />
        </span>
      </template>

      <template #caption="{ slide, total }">{{ caption(slide, total) }}</template>

      <template #actions="{ slide }">
        <div class="flex flex-col gap-4">
          <div v-if="selecting" class="flex flex-col gap-3 rounded-box border border-base-300 p-4">
            <div class="flex flex-col gap-1">
              <p class="font-medium" role="status">{{ g.selectedCount(chosenSlides.length) }}</p>
              <p class="text-sm text-base-content/70">{{ g.selectHint }}</p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button type="button" class="btn" @click="chosen = readySlides.map(other => other.key)">{{ g.selectAll }}</button>
              <button type="button" class="btn" :disabled="chosen.length === 0" @click="chosen = []">{{ g.clearSelection }}</button>
              <button
                type="button"
                class="btn btn-primary"
                :disabled="chosenSlides.length === 0 || !!downloading"
                :aria-busy="!!downloading"
                @click="downloadChosen"
              >
                <Icon name="lucide:download" class="size-5" aria-hidden="true" />
                {{ downloading ? g.downloading(downloading.done, downloading.total) : g.downloadSelected(chosenSlides.length) }}
              </button>
              <button type="button" class="btn" :disabled="chosenSlides.length === 0" @click="saveToDrive(chosenSlides)">
                <Icon name="lucide:hard-drive-upload" class="size-5" aria-hidden="true" />
                {{ g.saveSelectedToDrive(chosenSlides.length) }}
              </button>
              <button type="button" class="btn btn-ghost" @click="stopSelecting">{{ g.exitSelection }}</button>
            </div>
          </div>

          <div v-else class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <a v-if="slide?.image" :href="slide.image.downloadUrl" download class="btn btn-primary">
              <Icon name="lucide:download" class="size-5" aria-hidden="true" />
              {{ g.download }}
            </a>
            <button v-if="readySlides.length > 1" type="button" class="btn" @click="startSelecting">
              <Icon name="lucide:list-checks" class="size-5" aria-hidden="true" />
              {{ g.downloadMany }}
            </button>
            <button v-if="slide?.image" type="button" class="btn" @click="saveToDrive([slide])">
              <Icon name="lucide:hard-drive-upload" class="size-5" aria-hidden="true" />
              {{ g.saveToDrive }}
            </button>
            <button v-if="slide?.image" type="button" class="btn" @click="collectionImageId = slide.image.id">
              <Icon name="lucide:list-plus" class="size-5" aria-hidden="true" />
              {{ g.saveToCollection }}
            </button>
            <NuxtLink to="/peticiones" class="btn btn-ghost">
              <Icon name="lucide:arrow-left" class="size-5" aria-hidden="true" />
              {{ g.backShort }}
            </NuxtLink>
          </div>

          <LazyPrayerDriveSaveList v-if="drive.hasSaves.value" />
        </div>
      </template>
    </Slideshow>

    <LazyPrayerCollectionDialog v-if="collectionImageId" :image-id="collectionImageId" @close="collectionImageId = null" />
  </div>
</template>
