<script setup lang="ts">
import type { FileItem, FolderChildren, FolderItem } from '#shared/types/api'
import type { FileCategory } from '#shared/constants/files'
import { FILE_CATEGORIES } from '#shared/constants/files'
import type { ItemAction } from '~/utils/file-actions'
import type { ItemKind } from '~/composables/useItemActions'

const props = defineProps<{ folderId: string | null }>()

interface SearchResult {
  folders: (FolderItem & { path: string[] })[]
  files: FileItem[]
  nextCursor: string | null
}

const route = useRoute()
const router = useRouter()
const api = useApi()
const upload = useUploadDialog()
const view = useLocalStorage<'grid' | 'list'>('cloudy-files-view', 'grid', { initOnMounted: true })

// ---------------------------------------------------------------- filtros en la URL
const q = computed(() => (typeof route.query.q === 'string' ? route.query.q.trim() : ''))
const type = computed(() => (FILE_CATEGORIES as readonly string[]).includes(route.query.type as string) ? route.query.type as FileCategory : undefined)

const SORTS = {
  'name-asc': { label: 'Nombre (A–Z)', sort: 'name', dir: 'asc' },
  'date-desc': { label: 'Más recientes', sort: 'date', dir: 'desc' },
  'date-asc': { label: 'Más antiguos', sort: 'date', dir: 'asc' },
  'size-desc': { label: 'Tamaño (mayor primero)', sort: 'size', dir: 'desc' },
  'size-asc': { label: 'Tamaño (menor primero)', sort: 'size', dir: 'asc' },
} as const
type SortOption = keyof typeof SORTS
const sortOption = computed<SortOption>(() => {
  const key = `${route.query.sort ?? 'name'}-${route.query.dir ?? 'asc'}`
  return key in SORTS ? key as SortOption : 'name-asc'
})

// `route.query` se actualiza recién al terminar la navegación: dos cambios seguidos (p. ej. quitar
// el filtro y ordenar) se acumulan aquí para que el segundo no reponga el valor anterior.
let pendingQuery: Record<string, unknown> | null = null

function setQuery(changes: Record<string, string | undefined>) {
  const next = { ...(pendingQuery ?? route.query), ...changes }
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key]
  }
  pendingQuery = next
  router.replace({ query: next as Record<string, string> }).finally(() => {
    if (pendingQuery === next) pendingQuery = null
  })
}

function setSort(option: SortOption) {
  const { sort, dir } = SORTS[option]
  setQuery({ sort, dir })
}

// ---------------------------------------------------------------- datos
const url = computed(() => (q.value ? '/api/files/search' : `/api/folders/${props.folderId ?? 'root'}/children`))
const query = computed(() => ({
  ...(q.value ? { q: q.value } : {}),
  ...(type.value ? { type: type.value } : {}),
  sort: SORTS[sortOption.value].sort,
  dir: SORTS[sortOption.value].dir,
}))

// `lazy`: la vista se muestra al instante con el skeleton en lugar de dejar la página anterior.
const { data, error, refresh } = await useApiFetch<FolderChildren | SearchResult>(url, { query, lazy: true })

const moreFiles = ref<FileItem[]>([])
const cursor = ref<string | null>(null)
const loadingMore = ref(false)
watch(data, (value) => {
  moreFiles.value = []
  cursor.value = value?.nextCursor ?? null
}, { immediate: true })

const folders = computed(() => data.value?.folders ?? [])
const files = computed(() => [...(data.value?.files ?? []), ...moreFiles.value])
const breadcrumbs = computed(() => (data.value && 'breadcrumbs' in data.value ? data.value.breadcrumbs : []))
const title = computed(() => {
  if (q.value) return `Resultados para «${q.value}»`
  return data.value && 'folder' in data.value && data.value.folder ? data.value.folder.name : 'Archivos'
})
const isEmpty = computed(() => folders.value.length === 0 && files.value.length === 0)

useHead({ title: computed(() => `${title.value} · Cloudy`) })

async function loadMore() {
  if (!cursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const page = await api<FolderChildren | SearchResult>(url.value, { query: { ...query.value, cursor: cursor.value } })
    moreFiles.value.push(...page.files)
    cursor.value = page.nextCursor
  }
  catch {
    useToast().error('No pudimos cargar más archivos. Desplázate de nuevo para reintentar.')
  }
  finally {
    loadingMore.value = false
  }
}

if (import.meta.client) {
  useInfiniteScroll(window, loadMore, { distance: 400, canLoadMore: () => !!cursor.value })
}

watch(upload.version, () => refresh())

// ---------------------------------------------------------------- acciones
const actions = useItemActions((change, kind, item) => {
  if (change === 'trashed' && kind === 'file') {
    // Se quita de la vista al instante; `refresh` corrige el resto.
    moreFiles.value = moreFiles.value.filter(f => f.id !== item.id)
  }
  refresh()
})

function onAction(action: ItemAction, kind: ItemKind, item: FileItem | FolderItem) {
  if (action === 'rename' || action === 'move') actions.open({ type: action, kind, item })
  else if (action === 'trash') actions.trash(kind, item)
}

const TYPE_FILTERS: { value: FileCategory | undefined, label: string }[] = [
  { value: undefined, label: 'Todos' },
  ...FILE_CATEGORIES.map(value => ({ value, label: CATEGORY_LABELS[value] })),
]
</script>

<template>
  <div class="flex flex-col gap-4">
    <Breadcrumbs v-if="!q && breadcrumbs.length > 1" :items="breadcrumbs" />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="min-w-0 truncate text-2xl font-semibold">{{ title }}</h1>
      <div class="flex flex-wrap gap-2">
        <NuxtLink v-if="q" :to="{ path: '/archivos', query: {} }" class="btn">
          <Icon name="lucide:x" class="size-4" aria-hidden="true" />
          Limpiar búsqueda
        </NuxtLink>
        <template v-else>
          <button type="button" class="btn" @click="actions.open({ type: 'create', parentId: folderId })">
            <Icon name="lucide:folder-plus" class="size-4" aria-hidden="true" />
            Nueva carpeta
          </button>
          <button type="button" class="btn btn-primary" @click="upload.open(folderId)">
            <Icon name="lucide:upload" class="size-4" aria-hidden="true" />
            Subir
          </button>
        </template>
      </div>
    </div>

    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <div class="join" role="group" aria-label="Filtrar por tipo">
          <button
            v-for="filter in TYPE_FILTERS"
            :key="filter.label"
            type="button"
            class="btn join-item whitespace-nowrap"
            :class="{ 'btn-active btn-primary': type === filter.value }"
            :aria-pressed="type === filter.value"
            @click="setQuery({ type: filter.value })"
          >
            {{ filter.label }}
          </button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <label class="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
          <span class="shrink-0 text-sm">Ordenar por</span>
          <select
            class="select min-w-0 flex-1 lg:w-56"
            :value="sortOption"
            @change="setSort(($event.target as HTMLSelectElement).value as SortOption)"
          >
            <option v-for="(option, key) in SORTS" :key="key" :value="key">{{ option.label }}</option>
          </select>
        </label>
        <div class="join" role="group" aria-label="Vista">
          <button
            type="button"
            class="btn btn-square join-item"
            :class="{ 'btn-active': view === 'grid' }"
            :aria-pressed="view === 'grid'"
            aria-label="Ver en cuadrícula"
            @click="view = 'grid'"
          >
            <Icon name="lucide:layout-grid" class="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="btn btn-square join-item"
            :class="{ 'btn-active': view === 'list' }"
            :aria-pressed="view === 'list'"
            aria-label="Ver en lista"
            @click="view = 'list'"
          >
            <Icon name="lucide:list" class="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <SkeletonList v-if="!data && !error" :rows="12" :variant="view" />
    <ErrorState v-else-if="error" message="No pudimos cargar los archivos. Revisa tu conexión." @retry="refresh()" />
    <EmptyState
      v-else-if="isEmpty && q"
      icon="lucide:search-x"
      :title="`No encontramos nada con «${q}»`"
      description="Prueba con otra palabra o quita el filtro de tipo."
    />
    <EmptyState
      v-else-if="isEmpty && type"
      icon="lucide:filter-x"
      title="No hay archivos de este tipo aquí"
      description="Quita el filtro para ver todo el contenido."
    >
      <button type="button" class="btn" @click="setQuery({ type: undefined })">Ver todos</button>
    </EmptyState>
    <EmptyState
      v-else-if="isEmpty"
      icon="lucide:folder-open"
      title="Esta carpeta está vacía"
      description="Sube archivos o crea una carpeta para organizarlos."
    >
      <button type="button" class="btn btn-primary" @click="upload.open(folderId)">Subir archivos</button>
      <button type="button" class="btn" @click="actions.open({ type: 'create', parentId: folderId })">Nueva carpeta</button>
    </EmptyState>
    <template v-else>
      <FileGrid
        v-if="view === 'grid'"
        :folders="folders"
        :items="files"
        @file-action="(a, f) => onAction(a, 'file', f)"
        @folder-action="(a, f) => onAction(a, 'folder', f)"
      />
      <FileList
        v-else
        :folders="folders"
        :items="files"
        @file-action="(a, f) => onAction(a, 'file', f)"
        @folder-action="(a, f) => onAction(a, 'folder', f)"
      />
      <div v-if="cursor" class="flex justify-center">
        <button type="button" class="btn" :disabled="loadingMore" @click="loadMore">
          <span v-if="loadingMore" class="loading loading-spinner" aria-hidden="true" />
          Cargar más
        </button>
      </div>
    </template>

    <ItemDialogs :actions="actions" />
  </div>
</template>
