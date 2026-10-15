<script setup lang="ts">
import type { FolderTreeNode } from '#shared/types/api'

const props = withDefaults(defineProps<{
  title?: string
  /** Carpeta que no puede ser destino (ella y sus subcarpetas), p. ej. la que se está moviendo. */
  excludeId?: string | null
  currentId?: string | null
  confirmLabel?: string
}>(), { title: 'Mover a…', excludeId: null, currentId: null, confirmLabel: 'Mover aquí' })

const emit = defineEmits<{ select: [folderId: string | null], close: [] }>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const selected = ref<string | null>(props.currentId)

const { data, status, error, refresh } = await useApiFetch<FolderTreeNode[]>('/api/folders/tree', { server: false })

interface Row { id: string, name: string, depth: number }

// Árbol aplanado en orden de profundidad, sin la carpeta excluida ni sus descendientes.
const rows = computed<Row[]>(() => {
  const children = new Map<string | null, FolderTreeNode[]>()
  for (const node of data.value ?? []) {
    const list = children.get(node.parentId) ?? []
    list.push(node)
    children.set(node.parentId, list)
  }
  const out: Row[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      if (node.id === props.excludeId) continue
      out.push({ id: node.id, name: node.name, depth })
      walk(node.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
})

onMounted(() => dialog.value?.showModal())

function close() {
  dialog.value?.close()
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle" :aria-labelledby="titleId" @cancel.prevent="close">
    <div class="modal-box flex max-h-[85dvh] flex-col gap-3">
      <h2 :id="titleId" class="text-lg font-semibold">{{ title }}</h2>
      <SkeletonList v-if="status === 'pending'" :rows="4" />
      <ErrorState v-else-if="error" message="No pudimos cargar las carpetas." @retry="refresh()" />
      <ul v-else class="menu w-full gap-1 overflow-y-auto p-0" role="radiogroup" :aria-labelledby="titleId">
        <li>
          <button
            type="button"
            role="radio"
            class="min-h-11"
            :class="{ 'menu-active': selected === null }"
            :aria-checked="selected === null"
            @click="selected = null"
          >
            <Icon name="lucide:hard-drive" class="size-4" aria-hidden="true" />
            Archivos (raíz)
          </button>
        </li>
        <li v-for="row in rows" :key="row.id">
          <button
            type="button"
            role="radio"
            class="min-h-11"
            :class="{ 'menu-active': selected === row.id }"
            :style="{ paddingInlineStart: `${row.depth * 0.75 + 0.75}rem` }"
            :aria-checked="selected === row.id"
            @click="selected = row.id"
          >
            <Icon name="lucide:folder" class="size-4" aria-hidden="true" />
            <span class="truncate">{{ row.name }}</span>
          </button>
        </li>
      </ul>
      <div class="modal-action mt-0">
        <button type="button" class="btn" @click="close">Cancelar</button>
        <button type="button" class="btn btn-primary" :disabled="status === 'pending'" @click="emit('select', selected)">
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </dialog>
</template>
