<script setup lang="ts">
import type { ActivityEntry, Paginated, UsersPage } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['admin'] })
useHead({ title: 'Actividad · Cloudy' })

const api = useApi()
const action = ref('')
const actor = ref('')
const filters = computed(() => ({
  ...(action.value ? { action: action.value } : {}),
  ...(actor.value ? { actor: actor.value } : {}),
}))

// La primera página llega con el SSR (LCP sin esperar a la hidratación); al cambiar un filtro se vuelve a pedir.
const { data: firstPage, error, pending, refresh } = await useApiFetch<Paginated<ActivityEntry>>('/api/activity', {
  lazy: true,
  query: filters,
})

// Páginas siguientes del scroll infinito; se descartan cuando cambia la primera página.
const more = ref<ActivityEntry[]>([])
const nextCursor = ref<string | null>(null)
const loadingMore = ref(false)
const moreFailed = ref(false)
watch(firstPage, (page) => {
  more.value = []
  nextCursor.value = page?.nextCursor ?? null
  moreFailed.value = false
}, { immediate: true })

const items = computed(() => [...(firstPage.value?.items ?? []), ...more.value])

async function loadMore() {
  if (loadingMore.value || !nextCursor.value) return
  loadingMore.value = true
  moreFailed.value = false
  try {
    const page = await api<Paginated<ActivityEntry>>('/api/activity', { query: { ...filters.value, cursor: nextCursor.value } })
    more.value = [...more.value, ...page.items]
    nextCursor.value = page.nextCursor
  }
  catch {
    moreFailed.value = true
  }
  finally {
    loadingMore.value = false
  }
}

// Scroll infinito: cuando el centinela del final entra en pantalla se pide la página siguiente.
const sentinel = useTemplateRef<HTMLElement>('sentinel')
const sentinelVisible = useElementVisibility(sentinel)
watch(sentinelVisible, (visible) => {
  if (visible) loadMore()
})

// Filtro por persona: la lista de cuentas (sin las eliminadas) es corta.
const { data: users } = await useApiFetch<UsersPage>('/api/users', { lazy: true, query: { pageSize: 50 } })

const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold">Actividad</h1>
      <p class="text-base-content/70">Quién hizo qué en el disco del equipo.</p>
    </header>

    <div class="flex flex-col gap-2 sm:flex-row">
      <label class="flex min-w-0 flex-1 items-center gap-2">
        <span class="shrink-0 text-sm">Acción</span>
        <select v-model="action" class="select min-w-0 flex-1">
          <option value="">Todas</option>
          <option v-for="key in ACTIVITY_ACTIONS" :key="key" :value="key">{{ activityLabel(key) }}</option>
        </select>
      </label>
      <label class="flex min-w-0 flex-1 items-center gap-2">
        <span class="shrink-0 text-sm">Persona</span>
        <select v-model="actor" class="select min-w-0 flex-1">
          <option value="">Todas</option>
          <option v-for="user in users?.items ?? []" :key="user.userId" :value="user.userId">{{ user.name }}</option>
        </select>
      </label>
    </div>

    <SkeletonList v-if="!firstPage && pending" :rows="8" />
    <ErrorState v-else-if="error" message="No pudimos cargar la actividad. Revisa tu conexión." @retry="refresh()" />
    <EmptyState
      v-else-if="items.length === 0"
      icon="lucide:activity"
      title="Sin actividad todavía"
      description="Aquí verás las subidas, cambios y aprobaciones del equipo."
    />
    <template v-else>
      <ul class="list rounded-box border border-base-300 bg-base-100" aria-label="Actividad">
        <li v-for="entry in items" :key="entry.id" class="list-row items-center">
          <Icon :name="activityIcon(entry.action)" class="size-6 text-primary" aria-hidden="true" />
          <div class="list-col-grow flex min-w-0 flex-col">
            <span class="break-words">
              <span class="font-medium">{{ entry.actorLabel }}</span>
              {{ activityLabel(entry.action) }}
              <span class="font-medium">{{ entry.targetLabel }}</span>
              <span v-if="activityDetail(entry.action, entry.meta)" class="text-base-content/70"> · {{ activityDetail(entry.action, entry.meta) }}</span>
            </span>
            <time :datetime="entry.createdAt" class="text-xs text-base-content/70" :title="dateFormat.format(new Date(entry.createdAt))">
              {{ timeAgo(entry.createdAt) }}
            </time>
          </div>
        </li>
      </ul>
      <div ref="sentinel" class="flex min-h-11 justify-center py-2">
        <span v-if="loadingMore" class="loading loading-spinner" aria-label="Cargando más actividad" />
        <button v-else-if="nextCursor" type="button" class="btn" @click="loadMore()">Cargar más</button>
        <p v-else-if="moreFailed" role="alert" class="text-error">No pudimos cargar más. <button type="button" class="link" @click="loadMore()">Reintentar</button></p>
      </div>
    </template>
  </div>
</template>
