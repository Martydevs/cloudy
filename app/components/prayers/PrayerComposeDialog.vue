<script setup lang="ts">
// Diálogo de generación de Peticiones (feature 007, enmienda de 2026-11-13): las peticiones elegidas agrupadas por imagen,
// cada una con su foto y un campo donde el equipo escribe lo que dice. El texto ya no se lee ni se guarda: vive en la
// selección de la página y viaja con `POST /api/peticiones/imagenes`. Se carga diferido (`LazyPrayerComposeDialog`).
import { PRAYER_TEXT_MAX_LENGTH } from '#shared/constants/prayers'
import { isLongText } from '#shared/prayers'

const props = defineProps<{ groups: PrayerSelectionEntry[][] }>()
const emit = defineEmits<{ text: [id: string, text: string], remove: [id: string], generate: [], close: [] }>()

const m = messages.prayers
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const grouped = (n: number) => n.toLocaleString('es-MX')

const entries = computed(() => props.groups.flat())
const missing = computed(() => entries.value.filter(entry => entry.text.trim() === '').length)
const tooLong = computed(() => entries.value.some(entry => entry.text.length > PRAYER_TEXT_MAX_LENGTH))
const canGenerate = computed(() => entries.value.length > 0 && missing.value === 0 && !tooLong.value)

const fieldId = (id: string) => `prayer-text-${id}`

onMounted(() => {
  dialog.value?.showModal()
})

// La última petición de la selección: al quitarla no queda nada que escribir.
watch(entries, (list) => {
  if (list.length === 0) close()
})

function close() {
  dialog.value?.close()
  emit('close')
}

function generate() {
  if (!canGenerate.value) return
  emit('generate')
  close()
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle" :aria-labelledby="titleId" @cancel.prevent="close">
    <div class="modal-box flex max-h-[95dvh] w-11/12 max-w-3xl flex-col gap-4 p-4 sm:w-full">
      <header class="flex items-start gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <h2 :id="titleId" class="text-lg font-semibold">{{ m.compose.title }}</h2>
          <p class="text-sm text-base-content/70">{{ m.compose.intro }}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-square" :aria-label="m.close" @click="close">
          <Icon name="lucide:x" class="size-5" aria-hidden="true" />
        </button>
      </header>

      <div class="flex min-h-0 flex-col gap-6 overflow-y-auto">
        <section v-for="(group, index) in groups" :key="index" class="flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-base-content/70">{{ m.compose.image(index + 1) }}</h3>

          <article
            v-for="entry in group"
            :key="entry.request.id"
            class="flex flex-col gap-3 rounded-box border border-base-300 p-3 sm:flex-row"
          >
            <!-- Caja de proporción fija: el diálogo no salta mientras llegan las fotos. -->
            <div class="aspect-[4/3] w-full shrink-0 rounded-box bg-base-200 sm:w-40">
              <img
                :src="entry.request.previewUrl"
                :alt="`Foto enviada por ${entry.request.senderName}`"
                loading="lazy"
                decoding="async"
                class="size-full rounded-box object-cover"
              >
            </div>

            <div class="flex min-w-0 flex-1 flex-col gap-2">
              <div class="flex items-start gap-2">
                <label :for="fieldId(entry.request.id)" class="min-w-0 flex-1 break-words font-medium">
                  {{ entry.request.senderName }}
                </label>
                <button
                  type="button"
                  class="btn btn-ghost lg:btn-sm"
                  :aria-label="`${m.remove} la petición de ${entry.request.senderName}`"
                  @click="emit('remove', entry.request.id)"
                >
                  <Icon name="lucide:x" class="size-4" aria-hidden="true" />
                  {{ m.remove }}
                </button>
              </div>
              <p v-if="entry.request.note" class="break-words text-sm italic text-base-content/80">{{ entry.request.note }}</p>

              <textarea
                :id="fieldId(entry.request.id)"
                class="textarea textarea-bordered min-h-28 w-full"
                :class="{ 'textarea-error': entry.text.length > PRAYER_TEXT_MAX_LENGTH }"
                :placeholder="m.compose.placeholder"
                :value="entry.text"
                @input="emit('text', entry.request.id, ($event.target as HTMLTextAreaElement).value)"
              />

              <div class="flex flex-wrap items-center gap-2 text-sm">
                <span v-if="isLongText(entry.text)" class="badge badge-info badge-soft">{{ m.long }}</span>
                <span
                  v-if="entry.text.length > PRAYER_TEXT_MAX_LENGTH"
                  class="text-error"
                >{{ m.compose.tooLong }}</span>
                <span class="ms-auto text-base-content/70">
                  {{ m.compose.counter(grouped(entry.text.length), grouped(PRAYER_TEXT_MAX_LENGTH)) }}
                </span>
              </div>
            </div>
          </article>
        </section>
      </div>

      <footer class="flex flex-col gap-2">
        <p class="text-sm text-base-content/70" role="status">
          {{ m.willGenerate(entries.length, groups.length) }} · {{ m.compose.cost }}
          <template v-if="missing > 0"> · {{ m.compose.missing(missing) }}</template>
        </p>
        <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" class="btn" @click="close">{{ m.close }}</button>
          <button type="button" class="btn btn-primary" :disabled="!canGenerate" @click="generate">
            <Icon name="lucide:sparkles" class="size-5" aria-hidden="true" />
            {{ m.compose.generate }}
          </button>
        </div>
      </footer>
    </div>
    <div class="modal-backdrop">
      <button type="button" tabindex="-1" aria-hidden="true" @click="close">{{ m.close }}</button>
    </div>
  </dialog>
</template>
