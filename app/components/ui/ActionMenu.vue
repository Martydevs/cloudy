<script setup lang="ts">
export interface ActionMenuItem {
  key: string
  label: string
  icon: string
  danger?: boolean
  /** Si se indica, la opción es un enlace (p. ej. descargas). */
  href?: string
}

const props = defineProps<{
  label: string
  items: ActionMenuItem[]
  disabled?: boolean
  /** El menú se dibuja fuera de su contenedor (en `body`, posición fija): para tarjetas dentro de listas con desplazamiento, que lo recortarían. */
  floating?: boolean
}>()
const emit = defineEmits<{ select: [key: string] }>()

const open = ref(false)
// Abre hacia arriba cuando abajo no cabe (p. ej. una tarjeta pegada al borde inferior de la pantalla).
const openUp = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const panel = useTemplateRef<HTMLElement>('panel')
const position = ref<Record<string, string>>({})
const menuId = useId()

onClickOutside(root, () => {
  open.value = false
}, { ignore: [panel] })

// Un menú flotante no sigue a su tarjeta: se cierra al desplazar o redimensionar.
const closeFloating = () => {
  if (props.floating) open.value = false
}
useEventListener(() => (open.value ? window : undefined), 'scroll', closeFloating, { capture: true, passive: true })
useEventListener(() => (open.value ? window : undefined), 'resize', closeFloating)

// 44 px por opción + relleno, borde y separación del menú.
const OPTION_PX = 44
const MENU_CHROME_PX = 28

function toggle() {
  if (!open.value && root.value) {
    const rect = root.value.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom
    openUp.value = below < props.items.length * OPTION_PX + MENU_CHROME_PX && rect.top > below
    // Flotante: anclado al borde derecho del botón, hacia abajo (o hacia arriba si no cabe).
    position.value = {
      right: `${Math.max(8, window.innerWidth - rect.right)}px`,
      ...(openUp.value ? { bottom: `${window.innerHeight - rect.top + 4}px` } : { top: `${rect.bottom + 4}px` }),
    }
  }
  open.value = !open.value
}

function choose(key: string) {
  open.value = false
  emit('select', key)
}
</script>

<template>
  <div ref="root" class="dropdown dropdown-end" :class="{ 'dropdown-open': open, 'dropdown-top': openUp }" @keydown.esc.stop="open = false">
    <button
      type="button"
      class="btn btn-ghost btn-square"
      :aria-label="label"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      @click.stop.prevent="toggle"
    >
      <Icon name="lucide:ellipsis" class="size-5" aria-hidden="true" />
    </button>
    <Teleport to="body" :disabled="!floating">
      <ul
        v-if="open"
        :id="menuId"
        ref="panel"
        role="menu"
        class="menu z-30 w-52 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        :class="floating ? 'fixed z-50' : ['dropdown-content', openUp ? 'mb-1' : 'mt-1']"
        :style="floating ? position : undefined"
        @keydown.esc.stop="open = false"
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
    </Teleport>
  </div>
</template>
