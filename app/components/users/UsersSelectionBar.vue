<script setup lang="ts">
// Barra de la selección múltiple de Usuarios: desactivar, cambiar el rol (menú con los roles) o eliminar las cuentas
// marcadas. Las confirmaciones y los avisos viven en `useUserAdmin().bulk`.
import type { Role } from '#shared/permissions'

defineProps<{ count: number, busy?: boolean }>()
const emit = defineEmits<{ disable: [], role: [role: Role], remove: [], clear: [] }>()

const ROLES: Role[] = ['editor', 'admin']
const open = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const menuId = useId()

onClickOutside(root, () => {
  open.value = false
})

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    root.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }
}

function choose(role: Role) {
  open.value = false
  emit('role', role)
}
</script>

<template>
  <SelectionBar :count="count" @clear="emit('clear')">
    <button type="button" class="btn @max-md:w-full" :disabled="busy" @click="emit('disable')">
      <Icon name="lucide:user-x" class="size-4" aria-hidden="true" />
      Desactivar
    </button>

    <!-- La barra está fija abajo: el menú se abre hacia arriba. -->
    <div ref="root" class="dropdown dropdown-top dropdown-end" :class="{ 'dropdown-open': open }" @keydown.esc.stop="open = false">
      <button
        type="button"
        class="btn"
        :disabled="busy"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-controls="open ? menuId : undefined"
        @click="toggle"
      >
        <Icon name="lucide:shield" class="size-4" aria-hidden="true" />
        Cambiar rol
        <Icon name="lucide:chevron-up" class="size-4" aria-hidden="true" />
      </button>
      <ul
        v-if="open"
        :id="menuId"
        role="menu"
        aria-label="Rol para las cuentas seleccionadas"
        class="menu dropdown-content z-30 my-1 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
      >
        <li v-for="role in ROLES" :key="role" role="none">
          <button type="button" role="menuitem" class="min-h-11" @click="choose(role)">{{ ROLE_LABELS[role] }}</button>
        </li>
      </ul>
    </div>

    <button type="button" class="btn btn-error @max-md:w-full" :disabled="busy" @click="emit('remove')">
      <span v-if="busy" class="loading loading-spinner" aria-hidden="true" />
      <Icon v-else name="lucide:trash-2" class="size-4" aria-hidden="true" />
      Eliminar
    </button>
  </SelectionBar>
</template>
