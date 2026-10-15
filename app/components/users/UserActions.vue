<script setup lang="ts">
// Controles de una cuenta; los usa la tarjeta (móvil) y la fila de tabla (escritorio).
import type { Role } from '#shared/permissions'
import type { Profile } from '#shared/types/api'

const props = defineProps<{ user: Profile, busy: boolean, isSelf: boolean }>()
const emit = defineEmits<{
  activate: [role: Role]
  disable: []
  reactivate: []
  changeRole: [role: Role]
  remove: []
}>()

const ROLES: Role[] = ['editor', 'admin']
const pendingRole = ref<Role>('editor')
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <template v-if="props.user.status === 'pending'">
      <select
        v-model="pendingRole"
        class="select w-36"
        :aria-label="`Rol para ${props.user.name}`"
        :disabled="props.busy"
      >
        <option v-for="role in ROLES" :key="role" :value="role">{{ ROLE_LABELS[role] }}</option>
      </select>
      <button type="button" class="btn btn-primary" :disabled="props.busy" @click="emit('activate', pendingRole)">
        <span v-if="props.busy" class="loading loading-spinner loading-sm" aria-hidden="true" />
        <Icon v-else name="lucide:user-check" class="size-4" aria-hidden="true" />
        Activar
      </button>
    </template>

    <template v-else-if="props.user.status === 'active'">
      <select
        class="select w-36"
        :aria-label="`Rol de ${props.user.name}`"
        :value="props.user.role"
        :disabled="props.busy"
        @change="emit('changeRole', ($event.target as HTMLSelectElement).value as Role)"
      >
        <option v-for="role in ROLES" :key="role" :value="role">{{ ROLE_LABELS[role] }}</option>
      </select>
      <button type="button" class="btn" :disabled="props.busy" @click="emit('disable')">
        <Icon name="lucide:user-x" class="size-4" aria-hidden="true" />
        Desactivar
      </button>
    </template>

    <button v-else type="button" class="btn" :disabled="props.busy" @click="emit('reactivate')">
      <Icon name="lucide:user-check" class="size-4" aria-hidden="true" />
      Reactivar
    </button>

    <button
      type="button"
      class="btn btn-ghost text-error"
      :disabled="props.busy"
      :aria-label="`Eliminar a ${props.user.name}`"
      @click="emit('remove')"
    >
      <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />
      Eliminar
    </button>
    <span v-if="props.isSelf" class="text-xs text-base-content/70">Esta es tu cuenta</span>
  </div>
</template>
