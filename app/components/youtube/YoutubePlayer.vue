<script setup lang="ts">
// Reproductor incrustado oficial de YouTube (feature 005, research D5 revisado). Reproduce desde YouTube sin preparar
// ninguna copia ni despertar el servicio de descargas, así que arranca al instante aun con red lenta. El `<iframe>`
// (dominio sin cookies) pesa bastante: hasta pulsar Play solo se carga la miniatura, y se avisa al navegador para
// que abra la conexión (`preconnect`) cuando el cursor o el foco se acercan al botón. Los controles, la pantalla
// completa y el teclado son los de YouTube. No depende del servicio de descargas ni de los datos del video: basta el
// ID (sin miniatura propia usa la de YouTube), así que la ficha lo muestra al instante.
const props = withDefaults(defineProps<{
  videoId: string
  poster?: string | null
  title?: string
  /** Ocupa todo el alto disponible (ventana externa) en lugar de 16:9. */
  fill?: boolean
  /** Arranca sin pulsar Play (ventana externa, que se abre con un clic). */
  autoplay?: boolean
}>(), { poster: null, title: '', fill: false, autoplay: false })

const EMBED_ORIGIN = 'https://www.youtube-nocookie.com'

const posterSrc = computed(() => props.poster ?? `https://i.ytimg.com/vi/${encodeURIComponent(props.videoId)}/hqdefault.jpg`)
const started = ref(props.autoplay)
const warm = ref(false)

useHead({
  link: computed(() => (warm.value || started.value
    ? [{ rel: 'preconnect', href: EMBED_ORIGIN }, { rel: 'preconnect', href: 'https://i.ytimg.com' }]
    : [])),
})

const embedUrl = computed(() => `${EMBED_ORIGIN}/embed/${encodeURIComponent(props.videoId)}?autoplay=1&rel=0&playsinline=1&hl=es`)

// Un video nuevo (misma instancia) vuelve a la miniatura.
watch(() => props.videoId, () => { started.value = props.autoplay })
</script>

<template>
  <div
    class="relative w-full overflow-hidden rounded-box bg-neutral text-neutral-content"
    :class="fill ? 'min-h-64 flex-1 self-stretch' : 'aspect-video'"
    role="region"
    :aria-label="title ? `Reproductor: ${title}` : 'Reproductor'"
  >
    <iframe
      v-if="started"
      :src="embedUrl"
      :title="title ? `YouTube: ${title}` : 'Reproductor de YouTube'"
      class="absolute inset-0 size-full border-0"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    />
    <button
      v-else
      type="button"
      class="group absolute inset-0 size-full outline-offset-[-4px] focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="title ? `Reproducir: ${title}` : 'Reproducir'"
      @click="started = true"
      @pointerenter="warm = true"
      @focus="warm = true"
    >
      <!-- Miniatura con dimensiones declaradas (sin saltos de diseño). -->
      <img
        :src="posterSrc"
        alt=""
        width="480"
        height="360"
        class="absolute inset-0 size-full object-cover"
      >
      <span class="btn btn-primary btn-circle btn-xl pointer-events-none absolute left-1/2 top-1/2 -translate-1/2 transition-transform group-hover:scale-110 motion-reduce:transition-none">
        <Icon name="lucide:play" class="size-8" aria-hidden="true" />
      </span>
    </button>
  </div>
</template>
