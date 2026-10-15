<script setup lang="ts">
import type { ActivityEntry, Paginated, UsersPage } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['admin'] })
useHead({ title: 'Actividad · Cloudy' })

const api = useApi()
const action = ref('')
const actor = ref('')

const items = ref<ActivityEntry[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const failed = ref(false)
const loadedOnce = ref(false)

async function load(reset = false) {
  if (loading.value) return
  if (reset) {
    items.value = []
    nextCursor.value = null
    loadedOnce.value = false
  }
  loading.value = true
  failed.value = false
  try {
    const page = await api<Paginated<ActivityEntry>>('/api/activity', {
      query: {
        ...(action.value ? { action: action.value } : {}),
        ...(actor.value ? { actor: actor.value } : {}),
        ...(nextCursor.value ? { cursor: nextCursor.value } : {}),
      },
    })
    items.value = reset ? page.items : [...items.value, ...page.items]
    nextCursor.value = page.nextCursor
    loadedOnce.value = true
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

watch([action, actor], () => load(true))
onMounted(() => load(true))

// Scroll infinito: cuando el centinela del final entra en pantalla se pide la página siguiente.
const sentinel = useTemplateRef<HTMLElement>('sentinel')
const sentinelVisible = useElementVisibility(sentinel)
watch(sentinelVisible, (visible) => {
  if (visible && nextCursor.value && !loading.value) load()
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

    <SkeletonList v-if="!loadedOnce && loading" :rows="8" />
    <ErrorState v-else-if="failed && items.length === 0" message="No pudimos cargar la actividad. Revisa tu conexión." @retry="load(true)" />
    <EmptyState
      v-else-if="loadedOnce && items.length === 0"
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
      <div ref="sentinel" class="flex justify-center py-2">
        <span v-if="loading" class="loading loading-spinner" aria-label="Cargando más actividad" />
        <button v-else-if="nextCursor" type="button" class="btn" @click="load()">Cargar más</button>
        <p v-else-if="failed" role="alert" class="text-error">No pudimos cargar más. <button type="button" class="link" @click="load()">Reintentar</button></p>
      </div>
    </template>
  </div>
</template>
