<script setup lang="ts">
// Página Peticiones (feature 007, contracts/ui.md): las imágenes de invitados ya aprobadas como tarjetas seleccionables, con
// desplazamiento infinito, y las imágenes de «peticiones del día» generadas a partir de la selección. Delgada: la lista, la
// selección y la cola viven en sus composables.
definePageMeta({ layout: 'dashboard', access: 'private', roles: ['editor', 'admin'] })
useHead({ title: 'Peticiones · Cloudy' })

const m = messages.prayers
const toast = useToast()
const { confirm } = useConfirm()
const { copyGuestLink } = useGuestLink()

const requests = usePrayerRequests({ dir: 'desc' })
const { items, firstPage, error, pending, loadingMore, moreError, done } = requests
const selection = usePrayerSelection()
const images = usePrayerImages()
const reviewing = ref(false)
const results = useTemplateRef<HTMLElement>('results')

usePrayerLeaveGuard()
// Los resultados y la selección viven en la página: al salir se liberan (el guardián ya confirmó si hacía falta).
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
  results.value?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
}
</script>

<template>
  <div class="flex flex-col gap-6" :class="{ 'pb-56 sm:pb-32': selection.count.value > 0 }">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">{{ m.title }}</h1>
        <p class="max-w-2xl text-base-content/70">{{ m.description }}</p>
      </div>
      <button type="button" class="btn shrink-0" @click="copyGuestLink">
        <Icon name="lucide:link" class="size-5" aria-hidden="true" />
        Copiar enlace para invitados
      </button>
    </header>

    <div ref="results" class="scroll-mt-20">
      <LazyPrayerResults v-if="images.hasItems.value" />
    </div>

    <div v-if="!firstPage && pending" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-busy="true">
      <span class="sr-only" role="status">{{ m.loading }}</span>
      <PrayerCardSkeleton v-for="n in 6" :key="n" />
    </div>
    <ErrorState v-else-if="error && !firstPage" :message="m.load" @retry="requests.refresh()" />
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
      @load-more="requests.loadMore()"
      @retry-more="requests.loadMore()"
    />

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
  </div>
</template>
