<script setup lang="ts">
import type { DashboardSummary } from '#shared/types/api'
import { FILE_CATEGORIES } from '#shared/constants/files'

definePageMeta({ layout: 'dashboard', access: 'private' })
useHead({ title: 'Inicio · Cloudy' })

const { profile } = useMe()
const { data, error, refresh } = await useApiFetch<DashboardSummary>('/api/dashboard', { lazy: true })
const upload = useUploadDialog()
watch(upload.version, () => refresh())

const { pendingCount } = usePulse()
const pending = computed(() => Math.max(pendingCount.value, data.value?.pendingCount ?? 0))

const toast = useToast()
const { copy, isSupported } = useClipboard()
async function copyGuestLink() {
  const link = `${window.location.origin}/enviar`
  if (isSupported.value) {
    await copy(link)
    toast.success('Enlace para invitados copiado')
  }
  else {
    toast.info(`Comparte este enlace: ${link}`)
  }
}

const firstName = computed(() => profile.value?.name.split(' ')[0] ?? '')
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold">Hola{{ firstName ? `, ${firstName}` : '' }}</h1>
      <p class="text-base-content/70">Esto es lo que pasa en el disco del equipo.</p>
    </header>

    <section aria-label="Accesos rápidos" class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-primary" @click="upload.open(null)">
        <Icon name="lucide:upload" class="size-4" aria-hidden="true" />
        Subir archivo
      </button>
      <NuxtLink to="/pendientes" class="btn">
        <Icon name="lucide:inbox" class="size-4" aria-hidden="true" />
        Ver pendientes
      </NuxtLink>
      <button type="button" class="btn" @click="copyGuestLink">
        <Icon name="lucide:link" class="size-4" aria-hidden="true" />
        Copiar enlace para invitados
      </button>
    </section>

    <SkeletonList v-if="!data && !error" :rows="8" variant="grid" />
    <ErrorState v-else-if="error" message="No pudimos cargar el resumen. Revisa tu conexión." @retry="refresh()" />
    <template v-else-if="data">
      <section aria-labelledby="resumen-title">
        <h2 id="resumen-title" class="sr-only">Resumen</h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NuxtLink to="/pendientes" class="stat rounded-box border border-base-300 bg-base-100 hover:border-primary">
            <div class="stat-figure text-primary"><Icon name="lucide:inbox" class="size-8" aria-hidden="true" /></div>
            <div class="stat-title">Pendientes de revisar</div>
            <div class="stat-value">{{ pending }}</div>
            <div class="stat-desc">Envíos de invitados</div>
          </NuxtLink>
          <div class="stat rounded-box border border-base-300 bg-base-100">
            <div class="stat-figure text-secondary"><Icon name="lucide:hard-drive" class="size-8" aria-hidden="true" /></div>
            <div class="stat-title">Espacio usado</div>
            <div class="stat-value text-2xl sm:text-3xl">{{ formatBytes(data.storage.activeBytes) }}</div>
            <div class="stat-desc">Archivos activos</div>
          </div>
          <NuxtLink to="/papelera" class="stat rounded-box border border-base-300 bg-base-100 hover:border-primary">
            <div class="stat-figure text-base-content/60"><Icon name="lucide:trash-2" class="size-8" aria-hidden="true" /></div>
            <div class="stat-title">En la papelera</div>
            <div class="stat-value text-2xl sm:text-3xl">{{ formatBytes(data.storage.trashBytes) }}</div>
            <div class="stat-desc">Se borra a los 30 días</div>
          </NuxtLink>
        </div>
      </section>

      <section aria-labelledby="tipos-title" class="flex flex-col gap-3">
        <h2 id="tipos-title" class="text-lg font-semibold">Por tipo</h2>
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <li v-for="category in FILE_CATEGORIES" :key="category">
            <NuxtLink
              :to="{ path: '/archivos', query: { type: category } }"
              class="flex items-center gap-3 rounded-box border border-base-300 bg-base-100 p-3 hover:border-primary"
            >
              <Icon :name="fileIcon(category)" class="size-6 shrink-0 text-primary" aria-hidden="true" />
              <span class="flex min-w-0 flex-col">
                <span class="truncate font-medium">{{ CATEGORY_LABELS[category] }}</span>
                <span class="text-sm text-base-content/70">
                  {{ data.totalsByCategory[category].count }} · {{ formatBytes(data.totalsByCategory[category].bytes) }}
                </span>
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section aria-labelledby="recientes-title" class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <h2 id="recientes-title" class="text-lg font-semibold">Archivos recientes</h2>
          <NuxtLink v-if="data.recentFiles.length" to="/archivos" class="link link-primary">Ver todos</NuxtLink>
        </div>
        <EmptyState
          v-if="data.recentFiles.length === 0"
          icon="lucide:cloud-upload"
          title="Sube tu primer archivo"
          description="Fotos, audios, videos y presentaciones de hasta 100 MB."
        >
          <button type="button" class="btn btn-primary" @click="upload.open(null)">Subir archivo</button>
        </EmptyState>
        <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <li v-for="file in data.recentFiles" :key="file.id">
            <FileCard :file="file" compact />
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
