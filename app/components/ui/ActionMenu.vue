<script setup lang="ts">
export interface ActionMenuItem {
  key: string
  label: string
  icon: string
  danger?: boolean
  /** Si se indica, la opción es un enlace (p. ej. descargas). */
  href?: string
}

defineProps<{ label: string, items: ActionMenuItem[] }>()
const emit = defineEmits<{ select: [key: string] }>()

const open = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const menuId = useId()

onClickOutside(root, () => {
  open.value = false
})

function choose(key: string) {
  open.value = false
  emit('select', key)
}
</script>

<template>
  <div ref="root" class="dropdown dropdown-end" :class="{ 'dropdown-open': open }" @keydown.esc.stop="open = false">
    <button
      type="button"
      class="btn btn-ghost btn-square"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      @click.stop.prevent="open = !open"
    >
      <Icon name="lucide:ellipsis" class="size-5" aria-hidden="true" />
    </button>
    <ul
      v-if="open"
      :id="menuId"
      role="menu"
      class="menu dropdown-content z-30 mt-1 w-52 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
    >
      <li v-for="item in items" :key="item.key" role="none">
        <a
          v-if="item.href"
          :href="item.href"
          role="menuitem"
          class="min-h-11"
          download
          @click="open = false"
        >
          <Icon :name="item.icon" class="size-4" aria-hidden="true" />
          {{ item.label }}
        </a>
        <button
          v-else
          type="button"
          role="menuitem"
          class="min-h-11"
          :class="{ 'text-error': item.danger }"
          @click.stop.prevent="choose(item.key)"
        >
          <Icon :name="item.icon" class="size-4" aria-hidden="true" />
          {{ item.label }}
        </button>
      </li>
    </ul>
  </div>
</template>
