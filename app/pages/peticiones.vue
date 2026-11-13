<script setup lang="ts">
// Página Peticiones (feature 007, contracts/ui.md, enmienda de historial). Tres secciones, en este orden: las peticiones
// aprobadas como tarjetas seleccionables en una sola fila desplazable en horizontal (con desplazamiento infinito dentro de la
// fila), las colecciones de imágenes generadas (con el SSR) y el historial de imágenes generadas (diferido e hidratado cuando
// el navegador está libre), con la cola en curso arriba. Delgada: la lista, la selección, la cola, el historial y las
// colecciones viven en sus composables.
import type { ImageText, PrayerGeneratedImage, PrayerRequest } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['editor', 'admin'] })
useHead({ title: 'Peticiones · Cloudy' })
// Solo en el SSR (el endpoint es configuración privada): la foto de la primera tarjeta es el LCP y llega por el almacenamiento.
if (import.meta.server) useHead({ link: storagePreconnect(useRuntimeConfig().awsEndpointUrlS3) })

const m = messages.prayers
const toast = useToast()
const { confirm } = useConfirm()
const { copyGuestLink } = useGuestLink()

// Cambiar un filtro reinicia la lista; la selección no se toca (FR-031).
const filters = usePrayerFilters()
const requests = usePrayerRequests(filters.query)
const { items, firstPage, error, pending, loadingMore, moreError, done } = requests
const selection = usePrayerSelection()
const images = usePrayerImages()
const reviewing = ref(false)
/** Petición cuya transcripción se corrige (`LazyPrayerTextDialog`). */
const fixing = ref<PrayerRequest | null>(null)
const historySection = useTemplateRef<HTMLElement>('historySection')
const approvedHeading = useId()

// ---- Colecciones de imágenes generadas
const collections = usePrayerCollections()
const { data: collectionList, pending: collectionsPending, error: collectionsError, refresh: refreshCollections } = usePrayerCollectionList()
/** `{}` = crear vacía; `collectionId` = ver; `imageId` = guardar una imagen. */
const collectionDialog = ref<{ collectionId?: string, imageId?: string } | null>(null)

function saveToCollection(image: PrayerGeneratedImage) {
  collectionDialog.value = { imageId: image.id }
}

// La tarjeta y la copia elegida toman el texto nuevo (el panel ya avisa con su toast «Texto guardado»).
function onTextChange(text: ImageText) {
  const request = fixing.value
  if (!request) return
  requests.patchText(request.id, text)
  selection.sync({ ...request, text })
}

usePrayerLeaveGuard()
// La cola y la selección viven en la página: al salir se liberan (el guardián ya confirmó si hacía falta). Lo generado ya
// está guardado en el historial.
onBeforeUnmount(() => {
  images.reset()
  selection.clear()
})

// Un `409` retira de la selección las peticiones que ya no están disponibles.
images.onUnavailable((ids) => {
  selection.remove(ids)
  toast.info(m.removedUnavailable(ids.length))
})

async function generate() {
  const count = selection.count.value
  const groups = selection.groups.value
  const unreadable = selection.unreadable.value.length
  const message = [m.confirmBody(count, groups.length), ...(unreadable > 0 ? [`${m.illegibleWarning(unreadable)}.`, m.confirmIllegible] : [])].join(' ')
  const ok = await confirm({ title: m.confirmTitle, message, confirmLabel: unreadable > 0 ? m.confirmAnyway : m.confirm })
  if (!ok) return
  images.enqueue(groups)
  // La selección se conserva para poder corregir y volver a generar.
  await nextTick()
  const smooth = import.meta.client && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  historySection.value?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
}
</script>

<template>
  <div class="flex flex-col gap-6" :class="{ 'pb-56 sm:pb-32': selection.count.value > 0 }">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">{{ m.title }}</h1>
        <p class="max-w-2xl text-base-content/70">{{ m.description }}</p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <a href="#historial" class="btn">
          <Icon name="lucide:images" class="size-5" aria-hidden="true" />
          {{ m.history.jump }}
        </a>
        <button type="button" class="btn" @click="copyGuestLink">
          <Icon name="lucide:link" class="size-5" aria-hidden="true" />
          Copiar enlace para invitados
        </button>
      </div>
    </header>

    <section class="flex min-w-0 flex-col gap-4" :aria-labelledby="approvedHeading">
      <h2 :id="approvedHeading" class="text-lg font-semibold">{{ m.approvedTitle }}</h2>
      <PrayerToolbar
        v-model:q="filters.q.value"
        v-model:preset="filters.preset.value"
        v-model:from="filters.from.value"
        v-model:to="filters.to.value"
        v-model:dir="filters.dir.value"
        :summary="filters.activeSummary.value"
        :range-error="filters.rangeError.value"
        @reset="filters.reset()"
      />

      <!-- Misma fila que `PrayerGrid` (anchos de tarjeta incluidos): la fila no salta al llegar los datos. -->
      <div v-if="!firstPage && pending" class="-mx-1 flex gap-4 overflow-hidden p-1 pb-3" aria-busy="true">
        <span class="sr-only" role="status">{{ m.loading }}</span>
        <PrayerCardSkeleton v-for="n in 5" :key="n" class="w-72 shrink-0 sm:w-80" />
      </div>
      <ErrorState v-else-if="error && !firstPage" :message="m.load" @retry="requests.refresh()" />
      <EmptyState v-else-if="items.length === 0 && filters.hasFilters.value" icon="lucide:search-x" :title="m.emptyFiltered" :description="m.emptyFilteredHint">
        <button type="button" class="btn btn-primary" @click="filters.reset()">
          <Icon name="lucide:filter-x" class="size-5" aria-hidden="true" />
          {{ m.clearFilters }}
        </button>
      </EmptyState>
      <EmptyState v-else-if="items.length === 0" icon="lucide:hand-heart" :title="m.emptyApproved" :description="m.emptyApprovedHint">
        <NuxtLink to="/solicitudes" class="btn btn-primary">
          <Icon name="lucide:inbox" class="size-5" aria-hidden="true" />
          {{ m.goToRequests }}
        </NuxtLink>
        <button type="button" class="btn" @click="copyGuestLink">
          <Icon name="lucide:link" class="size-5" aria-hidden="true" />
          Copiar enlace para invitados
        </button>
      </EmptyState>
      <PrayerGrid
        v-else
        :items="items"
        :loading-more="loadingMore"
        :more-error="moreError"
        :done="done"
        :is-selected="selection.isSelected"
        :limit-reached="selection.limitReached.value"
        @toggle="selection.toggle"
        @fix="request => fixing = request"
        @load-more="requests.loadMore()"
        @retry-more="requests.loadMore()"
      />
    </section>

    <PrayerCollectionRow
      :collections="collectionList?.items ?? null"
      :pending="collectionsPending"
      :error="collectionsError"
      :can-manage="collections.canManage"
      @retry="refreshCollections()"
      @create="collectionDialog = {}"
      @open="collection => (collectionDialog = { collectionId: collection.id })"
      @rename="collection => (collectionDialog = { collectionId: collection.id })"
      @remove="collection => collections.remove(collection)"
    />

    <!-- Bajo el pliegue: su JS llega y se hidrata cuando el navegador está libre (no al verse: la cola en curso debe estar
         viva al pulsar **Generar**); la primera página se pide en el navegador. -->
    <div id="historial" ref="historySection" class="scroll-mt-20">
      <LazyPrayerHistory hydrate-on-idle @collection="saveToCollection" />
    </div>

    <PrayerSelectionBar
      v-if="selection.count.value > 0"
      :count="selection.count.value"
      :images="selection.groups.value.length"
      :unreadable="selection.unreadable.value.length"
      :limit="selection.limitReached.value"
      @generate="generate"
      @review="reviewing = true"
      @clear="selection.clear()"
    />

    <LazyPrayerSelectionDialog
      v-if="reviewing"
      :items="selection.ordered.value"
      @remove="id => selection.remove([id])"
      @close="reviewing = false"
    />

    <LazyPrayerCollectionDialog
      v-if="collectionDialog"
      :collection-id="collectionDialog.collectionId"
      :image-id="collectionDialog.imageId"
      @close="collectionDialog = null"
    />

    <LazyPrayerTextDialog
      v-if="fixing"
      :key="fixing.id"
      :request="fixing"
      @change="onTextChange"
      @close="fixing = null"
    />
  </div>
</template>
