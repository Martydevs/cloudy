<script setup lang="ts" generic="F extends YoutubeFormat = YoutubeFormat">
// Menú de formato (Video 720p · Video 1080p · Audio MP3, o los de `formats`). Elegir una opción la marca (`v-model`) y emite `select`,
// así «Descargar → Audio MP3» es un solo gesto. Con `heights` avisa si el video no llega a 1080p (FR-007).
import type { YoutubeFormat } from '#shared/types/api'
import { YOUTUBE_FORMAT_VALUES, YOUTUBE_FORMATS } from '#shared/constants/youtube'

const props = withDefaults(defineProps<{
  label?: string
  icon?: string
  heights?: number[] | null
  /** Formatos que se ofrecen (por defecto los tres). */
  formats?: readonly F[]
  disabled?: boolean
  primary?: boolean
  block?: boolean
  /** Abre el menú hacia arriba (p. ej. en la barra de selección fija abajo). */
  top?: boolean
  /** Botón circular solo con el icono; `label` queda como nombre accesible. */
  iconOnly?: boolean
  /** El menú se abre en el flujo (dentro de listas con desplazamiento, donde uno flotante quedaría recortado). */
  inline?: boolean
}>(), { label: 'Descargar', icon: 'lucide:download', heights: null, formats: () => YOUTUBE_FORMAT_VALUES as readonly F[], disabled: false, primary: true, block: false, top: false, iconOnly: false, inline: false })

const model = defineModel<F>()
/** Sin `v-model` la opción marcada es Video 720p. */
const current = computed<YoutubeFormat>(() => model.value ?? 'mp4_720')
const emit = defineEmits<{ select: [format: F] }>()

const open = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const menuId = useId()
const noteId = useId()

const options = computed(() => YOUTUBE_FORMATS.filter(option => (props.formats as readonly YoutubeFormat[]).includes(option.value)))
const short1080 = computed(() => !!props.heights?.length && Math.max(...props.heights) < 1080)

onClickOutside(root, () => {
  open.value = false
})

function choose(format: YoutubeFormat) {
  const chosen = format as F
  model.value = chosen
  open.value = false
  emit('select', chosen)
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    root.value?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus()
  }
}
</script>

<template>
  <div
    ref="root"
    class="dropdown"
    :class="[{ 'dropdown-open': open, 'dropdown-top': top, 'w-full sm:w-auto': block, 'w-full': inline && open }, top || iconOnly ? 'dropdown-end' : 'dropdown-start']"
    @keydown.esc.stop="open = false"
  >
    <button
      type="button"
      class="btn"
      :class="{ 'btn-primary': primary, 'btn-block sm:w-auto': block, 'btn-circle': iconOnly }"
      :disabled="disabled"
      :aria-label="iconOnly ? label : undefined"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      @click.stop.prevent="toggle"
    >
      <Icon :name="icon" class="size-5" aria-hidden="true" />
      <template v-if="!iconOnly">
        {{ label }}
        <Icon name="lucide:chevron-down" class="size-4" aria-hidden="true" />
      </template>
    </button>
    <ul
      v-if="open"
      :id="menuId"
      role="menu"
      :aria-label="`Formato para ${label.toLowerCase()}`"
      class="menu dropdown-content z-30 my-1 rounded-box border border-base-300 bg-base-100 p-2"
      :class="inline ? 'static! w-full shadow-none' : iconOnly ? 'w-56 shadow-lg' : 'w-64 shadow-lg'"
    >
      <li v-for="option in options" :key="option.value" role="none">
        <button
          type="button"
          role="menuitemradio"
          class="min-h-11 flex-col items-start gap-0"
          :aria-checked="current === option.value"
          :aria-describedby="option.value === 'mp4_1080' && short1080 ? noteId : undefined"
          @click.stop.prevent="choose(option.value)"
        >
          <span class="flex items-center gap-2">
            <Icon :name="option.extension === 'mp3' ? 'lucide:music' : 'lucide:film'" class="size-4" aria-hidden="true" />
            {{ option.label }}
            <Icon v-if="current === option.value" name="lucide:check" class="size-4" aria-hidden="true" />
          </span>
          <span v-if="option.value === 'mp4_1080' && short1080" :id="noteId" class="text-xs text-base-content/70">
            {{ messages.youtube.downloads.bestAvailable }}
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
