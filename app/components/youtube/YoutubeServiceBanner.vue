<script setup lang="ts">
// Aviso del servicio de descargas (FR-010, research D7): despertando, ocupado, caído o sin configurar.
export type YoutubeBannerState = 'waking' | 'busy' | 'down' | 'notConfigured'

const props = defineProps<{ state: YoutubeBannerState }>()
const emit = defineEmits<{ retry: [] }>()

const text = computed(() => messages.youtube.service[props.state])
const tone = computed(() => (props.state === 'down' || props.state === 'notConfigured' ? 'alert-error' : 'alert-info'))
const icon = computed(() => (props.state === 'waking' ? 'lucide:loader-circle' : props.state === 'busy' ? 'lucide:hourglass' : 'lucide:circle-alert'))
</script>

<template>
  <div role="status" class="alert alert-soft flex flex-col items-start gap-3 sm:flex-row sm:items-center" :class="tone">
    <Icon
      :name="icon"
      class="size-6 shrink-0"
      :class="{ 'animate-spin motion-reduce:animate-none': state === 'waking' }"
      aria-hidden="true"
    />
    <span class="flex-1">{{ text }}</span>
    <button v-if="state !== 'notConfigured'" type="button" class="btn" @click="emit('retry')">
      <Icon name="lucide:refresh-cw" class="size-4" aria-hidden="true" />
      Reintentar
    </button>
  </div>
</template>
