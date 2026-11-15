<script setup lang="ts">
// Avance de «Guardar en el drive» en la página de una generación (enmienda 2026-11-15): una fila por imagen con su etapa,
// una barra de progreso y **Cancelar** (en cola o en curso), **Reintentar** o **Descartar**. Solo aparece después de la
// acción (`LazyPrayerDriveSaveList v-if`).
const drive = usePrayerDriveSave()
const m = messages.prayers.generation.drive
const headingId = useId()

const STAGE = { queued: m.queued, downloading: m.downloading, uploading: m.uploading, done: m.done, error: '' } as const
</script>

<template>
  <section class="flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-4" :aria-labelledby="headingId">
    <h2 :id="headingId" class="font-semibold">{{ m.title }}</h2>
    <ul class="flex flex-col gap-3">
      <li v-for="save in drive.list.value" :key="save.imageId" class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <p class="flex flex-wrap items-baseline gap-x-2">
            <span class="font-medium">{{ save.label }}</span>
            <span v-if="save.stage === 'done'" class="break-all text-sm text-base-content/70">{{ save.message }}</span>
          </p>
          <p v-if="save.stage === 'error'" class="text-sm text-error" role="alert">{{ save.message }}</p>
          <template v-else-if="save.stage !== 'done'">
            <p class="text-sm text-base-content/70" role="status">{{ STAGE[save.stage] }}</p>
            <progress
              class="progress progress-primary w-full motion-reduce:animate-none"
              :value="save.stage === 'uploading' ? save.progress : undefined"
              max="100"
              :aria-label="STAGE[save.stage]"
            />
          </template>
          <p v-else class="flex items-center gap-1 text-sm text-base-content/70" role="status">
            <Icon name="lucide:check" class="size-4" aria-hidden="true" />
            {{ m.done }}
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap gap-2">
          <button v-if="save.stage === 'error'" type="button" class="btn btn-primary lg:btn-sm" @click="drive.retry(save.imageId)">
            <Icon name="lucide:refresh-cw" class="size-5 lg:size-4" aria-hidden="true" />
            {{ m.retry }}
          </button>
          <button v-if="save.stage === 'done' || save.stage === 'error'" type="button" class="btn btn-ghost lg:btn-sm" @click="drive.dismiss(save.imageId)">
            {{ m.dismiss }}
          </button>
          <button v-else type="button" class="btn lg:btn-sm" @click="drive.cancel(save.imageId)">{{ m.cancel }}</button>
        </div>
      </li>
    </ul>
  </section>
</template>
