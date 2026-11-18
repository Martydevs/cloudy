<script setup lang="ts">
// Página Peticiones (feature 007, contracts/ui.md, enmienda de historial). Tres secciones, en este orden: las peticiones
// aprobadas como tarjetas seleccionables en una sola fila desplazable en horizontal (con desplazamiento infinito dentro de la
// fila), las colecciones de imágenes generadas (con el SSR) y el historial de imágenes generadas (diferido e hidratado cuando
// el navegador está libre), con la cola en curso arriba. Delgada: la lista, la selección, la cola, el historial y las
// colecciones viven en sus composables. «Generar imágenes» abre la revisión del texto de cada petición elegida
// (`LazyPrayerReviewDialog`); con todas verificadas, su botón crea la generación y lleva a su página
// (`/peticiones/generaciones/:id`), que se queda con la cola en curso.
import type { PrayerGeneratedImage, PrayerGenerationCreated } from '#shared/types/api'
import type { SubmissionResult } from '~/composables/useGuestSubmission'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['editor', 'admin'] })
useHead({ title: 'Peticiones · Cloudy' })
// Solo en el SSR (el endpoint es configuración privada): la foto de la primera tarjeta es el LCP y llega por el almacenamiento.
if (import.meta.server) useHead({ link: storagePreconnect(useRuntimeConfig().awsEndpointUrlS3) })

const m = messages.prayers
const toast = useToast()
const { copyGuestLink } = useGuestLink()

// Cambiar un filtro reinicia la lista; la selección no se toca (FR-031).
const filters = usePrayerFilters()
const requests = usePrayerRequests(filters.query)
const { items, firstPage, error, pending, loadingMore, moreError, done } = requests
const selection = usePrayerSelection()
const images = usePrayerImages()
const review = usePrayerReview()
const api = useApi()
const approvedHeading = useId()

// ---- Colecciones de imágenes generadas
const collections = usePrayerCollections()
const { data: collectionList, pending: collectionsPending, error: collectionsError, refresh: refreshCollections } = usePrayerCollectionList()
/** `{}` = crear vacía; `collectionId` = ver; `imageId` = guardar una imagen. */
const collectionDialog = ref<{ collectionId?: string, imageId?: string } | null>(null)

function saveToCollection(image: PrayerGeneratedImage) {
  collectionDialog.value = { imageId: image.id }
}

// La cola y la selección viven en la página: al salir se liberan (el guardián ya confirmó si hacía falta), salvo al ir a la
// página de una generación, que se queda con la cola. Lo generado ya está guardado en el historial.
usePrayerLeaveGuard({ keep: isPrayerGenerationPath })

/** Quita de la selección las peticiones que ya no están disponibles (`409 request_unavailable`). */
function dropUnavailable(ids: string[]) {
  selection.remove(ids)
  toast.info(m.removedUnavailable(ids.length))
}
images.onUnavailable(dropUnavailable)
review.onUnavailable(dropUnavailable)

/** La revisión del texto está abierta: nada se crea ni se encola hasta que su botón «Generar imágenes» lo pida. */
const reviewing = ref(false)
// Sin peticiones elegidas no hay nada que revisar (se retiraron todas por no estar disponibles).
watch(() => selection.count.value, (count) => {
  if (count === 0) reviewing.value = false
})

const creating = ref(false)

// ---- Alta manual («Agregar petición»): el diálogo sube las fotos y la petición nace aprobada.
const adding = ref(false)
const grid = useTemplateRef<{ scrollToStart: () => void }>('grid')

/**
 * La petición nueva es la más reciente por fecha de aprobación: la lista se recarga, la trae primero y la fila vuelve a su
 * inicio para que se vea.
 */
async function onManualDone(result: SubmissionResult) {
  adding.value = false
  toast.success(result.rejected > 0 ? m.manual.addedPartial(result.accepted, result.rejected) : m.manual.added(result.accepted))
  await requests.refresh()
  await nextTick()
  grid.value?.scrollToStart()
}

/**
 * Lo confirma la revisión, con cada petición verificada: crea la generación (el servidor comprueba que las peticiones sigan
 * disponibles y verificadas; el texto no viaja desde aquí), encola una imagen por grupo de 4 ligada a ella y lleva a su
 * página. La selección se vacía: un segundo clic no gasta crédito dos veces.
 */
async function generate() {
  const groups = selection.groups.value
  if (creating.value || groups.length === 0) return
  creating.value = true
  try {
    const { id } = await api<PrayerGenerationCreated>('/api/peticiones/generaciones', {
      method: 'POST',
      body: { groups: groups.map(group => group.map(request => request.id)) },
    })
    const queued = images.enqueue(groups, { generationId: id })
    toast.info(m.queuedImages(queued))
    reviewing.value = false
    selection.clear()
    await navigateTo(`/peticiones/generaciones/${id}`)
  }
  catch (error) {
    const data = (error as { data?: { data?: { code?: unknown, ids?: unknown } } } | null)?.data?.data
    if (data?.code === 'request_unavailable' && Array.isArray(data.ids)) {
      dropUnavailable(data.ids.filter((id): id is string => typeof id === 'string'))
      return
    }
    // Otra persona cambió un texto mientras se revisaba: la revisión se pone al día y sigue abierta.
    if (data?.code === 'transcript_unverified' && Array.isArray(data.ids)) {
      toast.error(m.review.staleVerification(data.ids.length))
      void review.reload()
      return
    }
    toast.error(serverMessage(error, m.generation.createFailed))
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6" :class="{ 'pb-56 sm:pb-32': selection.count.value > 0 }">
    <header class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">{{ m.title }}</h1>
        <p class="max-w-2xl text-base-content/70">{{ m.description }}</p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <button type="button" class="btn btn-primary" @click="adding = true">
          <Icon name="lucide:plus" class="size-5" aria-hidden="true" />
          {{ m.manual.open }}
        </button>
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
        <button type="button" class="btn btn-primary" @click="adding = true">
          <Icon name="lucide:plus" class="size-5" aria-hidden="true" />
          {{ m.manual.open }}
        </button>
        <NuxtLink to="/solicitudes" class="btn">
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
        ref="grid"
        :items="items"
        :loading-more="loadingMore"
        :more-error="moreError"
        :done="done"
        :is-selected="selection.isSelected"
        :limit-reached="selection.limitReached.value"
        @toggle="selection.toggle"
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
    <div id="historial" class="scroll-mt-20">
      <LazyPrayerHistory hydrate-on-idle @collection="saveToCollection" />
    </div>

    <PrayerSelectionBar
      v-if="selection.count.value > 0"
      :count="selection.count.value"
      :images="selection.groups.value.length"
      :limit="selection.limitReached.value"
      @generate="reviewing = true"
      @clear="selection.clear()"
    />

    <LazyPrayerReviewDialog
      v-if="reviewing && selection.count.value > 0"
      :requests="selection.ordered.value"
      :busy="creating"
      @close="reviewing = false"
      @generate="generate"
      @remove="id => selection.remove([id])"
    />

    <LazyPrayerManualDialog v-if="adding" @close="adding = false" @done="onManualDone" />

    <LazyPrayerCollectionDialog
      v-if="collectionDialog"
      :collection-id="collectionDialog.collectionId"
      :image-id="collectionDialog.imageId"
      @close="collectionDialog = null"
    />
  </div>
</template>
