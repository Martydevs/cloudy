<script setup lang="ts">
import type { Role } from '#shared/permissions'
import type { Profile, UsersPage } from '#shared/types/api'
import type { UserBatchAction } from '#shared/validation/users'

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
// Referencia de tiempo segura para el SSR; sustituye al util del mismo nombre en esta plantilla.
const { timeAgo } = useRelativeTime()
const pendingFirst = computed(() => data.value?.items ?? [])
// ---------------------------------------------------------------- selección múltiple
// Ids de las cuentas marcadas en esta página. Cambiar de página empieza una selección nueva.
const selected = ref<string[]>([])
watch(page, () => {
  selected.value = []
})
const selectedSet = computed(() => new Set(selected.value))
const selectedUsers = computed<Profile[]>(() => pendingFirst.value.filter(user => selectedSet.value.has(user.userId)))
// Una cuenta que ya no está en la lista (la eliminó otra persona) sale de la selección.
watch(pendingFirst, () => {
  if (selectedUsers.value.length !== selected.value.length) selected.value = selectedUsers.value.map(user => user.userId)
})
const allSelected = computed(() => pendingFirst.value.length > 0 && selectedUsers.value.length === pendingFirst.value.length)
const someSelected = computed(() => selectedUsers.value.length > 0 && !allSelected.value)

function toggle(userId: string) {
  selected.value = selectedSet.value.has(userId) ? selected.value.filter(id => id !== userId) : [...selected.value, userId]
}

function toggleAll() {
  selected.value = allSelected.value ? [] : pendingFirst.value.map(user => user.userId)
}

async function bulk(action: UserBatchAction, role?: Role) {
  if (await admin.bulk(action, selectedUsers.value, role)) selected.value = []
}

const summary = computed(() => {
  const pendingCount = pendingFirst.value.filter(u => u.status === 'pending').length
  return pendingCount === 0 ? '' : pendingCount === 1 ? '1 cuenta espera aprobación' : `${pendingCount} cuentas esperan aprobación`
})
</script>

<template>
  <div class="flex flex-col gap-4" :class="{ 'pb-40 sm:pb-24': selectedUsers.length > 0 }">
    <!-- Con algo marcado, el relleno de abajo deja sitio para que la barra de selección no tape contenido. -->
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold">Usuarios</h1>
      <p class="text-base-content/70">Aprueba cuentas nuevas, asigna roles y retira el acceso cuando haga falta.</p>
    </header>

    <SkeletonList v-if="!data && pending" :rows="5" />
    <ErrorState v-else-if="error" :message="messages.load.users" @retry="refresh()" />
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
          <!-- La casilla va en su propia columna, a la izquierda: el contenido de la tarjeta conserva su acomodo. -->
          <div class="card-body flex-row items-start gap-1 p-4 pl-2">
            <!-- Casilla siempre visible, con área táctil de 44 px. -->
            <label class="-mt-2 flex size-11 shrink-0 cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                class="checkbox checkbox-primary"
                :checked="selectedSet.has(user.userId)"
                :aria-label="`Seleccionar a ${user.name}`"
                @change="toggle(user.userId)"
              >
            </label>
            <div class="flex min-w-0 flex-1 flex-col gap-3">
              <div class="flex flex-wrap items-center gap-2">
                <!-- El nombre nunca se recorta: en teléfono ocupa su propia fila y las insignias bajan; desde `sm`
                     comparte la fila y, si es largo, salta de línea (como el remitente en SubmissionCard). -->
                <span class="min-w-0 basis-full break-words font-medium sm:flex-1 sm:basis-0">{{ user.name }}</span>
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
          </div>
        </li>
      </ul>

      <!-- Escritorio: tabla -->
      <div class="hidden overflow-x-auto rounded-box border border-base-300 bg-base-100 md:block">
        <table class="table">
          <thead>
            <tr>
              <th scope="col" class="w-11 p-0">
                <label class="flex size-11 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-primary"
                    :checked="allSelected"
                    :indeterminate="someSelected"
                    aria-label="Seleccionar todas las cuentas de esta página"
                    @change="toggleAll"
                  >
                </label>
              </th>
              <th scope="col">Nombre</th>
              <th scope="col">Correo</th>
              <th scope="col">Estado</th>
              <th scope="col">Registro</th>
              <th scope="col"><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="user in data.items"
              :key="user.userId"
              :class="{ 'bg-warning/10': user.status === 'pending', 'bg-primary/10': selectedSet.has(user.userId) && user.status !== 'pending' }"
            >
              <td class="w-11 p-0">
                <label class="flex size-11 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-primary"
                    :checked="selectedSet.has(user.userId)"
                    :aria-label="`Seleccionar a ${user.name}`"
                    @change="toggle(user.userId)"
                  >
                </label>
              </td>
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

    <LazyUsersSelectionBar
      v-if="selectedUsers.length > 0"
      :count="selectedUsers.length"
      :busy="admin.bulkBusy.value"
      @disable="bulk('disable')"
      @role="role => bulk('role', role)"
      @remove="bulk('remove')"
      @clear="selected = []"
    />
  </div>
</template>
