<script setup lang="ts">
// Solicitudes de acceso abiertas (feature 003, FR-008) con sus cuatro estados; se recarga con el pulso.
import type { AccessRequest } from '#shared/types/api'

const { openAccessRequests } = usePulse()
const { data, error, pending, refresh } = await useApiFetch<AccessRequest[]>('/api/access-requests', { lazy: true })
watch(openAccessRequests, () => refresh())

// Una recarga fallida no borra la lista que ya se ve (Nuxt vacía `data` al fallar).
const list = ref<AccessRequest[] | null>(null)
watch(data, (value) => {
  if (value) list.value = value
}, { immediate: true })
</script>

<template>
  <SkeletonList v-if="!list && pending" :rows="2" />
  <ErrorState v-else-if="error && !list" :message="messages.load.accessRequests" @retry="refresh()" />
  <EmptyState
    v-else-if="!list || list.length === 0"
    icon="lucide:door-closed"
    title="Nadie está pidiendo acceso ahora"
    description="Cuando un invitado pida permiso desde la página Subir, aparecerá aquí."
  />
  <ul v-else class="flex flex-col gap-3" aria-label="Solicitudes de acceso">
    <li v-for="request in list" :key="request.id">
      <AccessRequestCard :request="request" @decided="refresh()" />
    </li>
  </ul>
</template>
