<script setup lang="ts">
import type { UsersPage } from '#shared/types/api'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['admin'] })
useHead({ title: 'Usuarios · Cloudy' })

const PAGE_SIZE = 20
const page = ref(1)
const { data, error, pending, refresh } = await useApiFetch<UsersPage>('/api/users', {
  lazy: true,
  query: { page, pageSize: PAGE_SIZE },
})
const { me } = useMe()
const { pendingUsers } = usePulse()
// Alguien se registró mientras la página estaba abierta: se recarga la lista.
watch(pendingUsers, () => refresh())

const total = computed(() => data.value?.total ?? 0)
const { currentPage, pageCount, isFirstPage, isLastPage, prev, next } = useOffsetPagination({
  total,
  page,
  pageSize: PAGE_SIZE,
})

const admin = useUserAdmin(() => refresh())
const pendingFirst = computed(() => data.value?.items ?? [])
const summary = computed(() => {
  const pendingCount = pendingFirst.value.filter(u => u.status === 'pending').length
  return pendingCount === 0 ? '' : pendingCount === 1 ? '1 cuenta espera aprobación' : `${pendingCount} cuentas esperan aprobación`
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold">Usuarios</h1>
      <p class="text-base-content/70">Aprueba cuentas nuevas, asigna roles y retira el acceso cuando haga falta.</p>
    </header>

    <SkeletonList v-if="!data && pending" :rows="5" />
    <ErrorState v-else-if="error" message="No pudimos cargar los usuarios. Revisa tu conexión." @retry="refresh()" />
    <EmptyState
      v-else-if="!data || data.items.length === 0"
      icon="lucide:users"
      title="Todavía no hay otras cuentas"
      description="Cuando alguien se registre aparecerá aquí para que lo apruebes."
    />
    <template v-else>
      <!-- Sin `alert-soft`: en el tema claro pondría texto amarillo sobre base-100 (1.85:1). -->
      <p v-if="summary" role="status" class="alert alert-warning">
        <Icon name="lucide:bell" class="size-5" aria-hidden="true" />
        <span>{{ summary }}</span>
      </p>

      <!-- Móvil: tarjetas apiladas -->
      <ul class="flex flex-col gap-3 md:hidden" aria-label="Usuarios">
        <li
          v-for="user in data.items"
          :key="user.userId"
          class="card border bg-base-100"
          :class="user.status === 'pending' ? 'border-warning' : 'border-base-300'"
        >
          <div class="card-body gap-3 p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 flex-1 truncate font-medium">{{ user.name }}</span>
              <span class="badge" :class="STATUS_BADGE[user.status]">{{ STATUS_LABELS[user.status] }}</span>
              <span v-if="user.role" class="badge badge-primary badge-soft">{{ ROLE_LABELS[user.role] }}</span>
            </div>
            <span class="break-all text-sm text-base-content/70">{{ user.email }}</span>
            <span class="text-xs text-base-content/70">Se registró {{ timeAgo(user.createdAt) }}</span>
            <UserActions
              :user="user"
              :busy="admin.busyId.value === user.userId"
              :is-self="user.userId === me?.user.id"
              @activate="role => admin.activate(user, role)"
              @disable="admin.disable(user)"
              @reactivate="admin.reactivate(user)"
              @change-role="role => admin.changeRole(user, role)"
              @remove="admin.remove(user)"
            />
          </div>
        </li>
      </ul>

      <!-- Escritorio: tabla -->
      <div class="hidden overflow-x-auto rounded-box border border-base-300 bg-base-100 md:block">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Correo</th>
              <th scope="col">Estado</th>
              <th scope="col">Registro</th>
              <th scope="col"><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in data.items" :key="user.userId" :class="{ 'bg-warning/10': user.status === 'pending' }">
              <td class="font-medium">{{ user.name }}</td>
              <td class="break-all">{{ user.email }}</td>
              <td>
                <span class="flex flex-wrap gap-1">
                  <span class="badge" :class="STATUS_BADGE[user.status]">{{ STATUS_LABELS[user.status] }}</span>
                  <span v-if="user.role" class="badge badge-primary badge-soft">{{ ROLE_LABELS[user.role] }}</span>
                </span>
              </td>
              <td class="whitespace-nowrap text-base-content/70">{{ timeAgo(user.createdAt) }}</td>
              <td>
                <UserActions
                  :user="user"
                  :busy="admin.busyId.value === user.userId"
                  :is-self="user.userId === me?.user.id"
                  @activate="role => admin.activate(user, role)"
                  @disable="admin.disable(user)"
                  @reactivate="admin.reactivate(user)"
                  @change-role="role => admin.changeRole(user, role)"
                  @remove="admin.remove(user)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav v-if="pageCount > 1" aria-label="Paginación" class="flex items-center justify-between gap-2">
        <span class="text-sm text-base-content/70">Página {{ currentPage }} de {{ pageCount }} · {{ total }} usuarios</span>
        <div class="join">
          <button type="button" class="btn join-item" :disabled="isFirstPage" aria-label="Página anterior" @click="prev()">
            <Icon name="lucide:chevron-left" class="size-4" aria-hidden="true" />
          </button>
          <button type="button" class="btn join-item" :disabled="isLastPage" aria-label="Página siguiente" @click="next()">
            <Icon name="lucide:chevron-right" class="size-4" aria-hidden="true" />
          </button>
        </div>
      </nav>
    </template>
  </div>
</template>
