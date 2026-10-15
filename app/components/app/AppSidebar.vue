<script setup lang="ts">
// `badges`: contador por ruta (`item.to`), p. ej. envíos pendientes en /pendientes y cuentas por aprobar en /usuarios.
const props = defineProps<{ collapsed: boolean, badges?: Partial<Record<string, number>> }>()
const emit = defineEmits<{ navigate: [], toggleCollapse: [] }>()

const route = useRoute()
const router = useRouter()
const { profile } = useMe()

// Por rol y solo secciones con página: las historias pendientes no dejan enlaces rotos.
const items = computed(() => {
  const role = profile.value?.role
  if (!role) return []
  return navItems.filter(item => item.roles.includes(role) && router.resolve(item.to).matched.length > 0)
})
</script>

<template>
  <!-- Alto fijo al viewport y sin scroll propio: solo el `nav` se desplaza si la lista crece. -->
  <aside
    class="flex h-full min-h-dvh flex-col gap-2 overflow-hidden border-r border-base-300 bg-base-100 py-3 transition-[width]"
    :class="props.collapsed ? 'w-20 px-2' : 'w-64 px-3'"
  >
    <div class="flex h-12 shrink-0 items-center" :class="props.collapsed ? 'justify-center' : 'px-3'">
      <AppLogo :compact="props.collapsed" />
    </div>

    <nav aria-label="Secciones" class="min-h-0 flex-1 overflow-y-auto">
      <ul class="menu w-full gap-1 p-0">
        <li
          v-for="item in items"
          :key="item.to"
          :class="{ 'tooltip tooltip-right': props.collapsed }"
          :data-tip="props.collapsed ? item.label : undefined"
        >
          <NuxtLink
            :to="item.to"
            class="min-h-11 gap-3"
            :class="{ 'menu-active': isNavActive(item, route.path), 'justify-center': props.collapsed }"
            :aria-current="isNavActive(item, route.path) ? 'page' : undefined"
            :aria-label="props.collapsed ? item.label : undefined"
            @click="emit('navigate')"
          >
            <span class="relative">
              <Icon :name="item.icon" class="size-5" aria-hidden="true" />
              <span
                v-if="props.collapsed && (props.badges?.[item.to] ?? 0) > 0"
                class="badge badge-primary badge-xs absolute -right-2 -top-2"
              >{{ props.badges![item.to] }}</span>
            </span>
            <template v-if="!props.collapsed">
              <span class="nav-label flex-1">{{ item.label }}</span>
              <span
                v-if="(props.badges?.[item.to] ?? 0) > 0"
                class="badge badge-primary"
              >{{ props.badges![item.to] }}</span>
            </template>
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <button
      type="button"
      class="btn btn-ghost hidden lg:flex"
      :class="props.collapsed ? 'btn-square self-center' : 'justify-start'"
      :aria-label="props.collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'"
      :aria-expanded="!props.collapsed"
      @click="emit('toggleCollapse')"
    >
      <Icon :name="props.collapsed ? 'lucide:panel-left-open' : 'lucide:panel-left-close'" class="size-5" aria-hidden="true" />
      <span v-if="!props.collapsed">Contraer</span>
    </button>
  </aside>
</template>
