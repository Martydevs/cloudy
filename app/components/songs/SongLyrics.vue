<script setup lang="ts">
// Letra de la canción por estrofas, solo lectura (feature 006, contracts/ui.md). Es texto real (nunca `v-html`): una `<p>` por
// estrofa con sus líneas separadas por saltos.
import { LYRICS_MAX_LINES } from '#shared/constants/songs'

const props = defineProps<{ stanzas: string[][] }>()

const headingId = useId()
const lineCount = computed(() => props.stanzas.reduce((total, stanza) => total + stanza.length, 0))
</script>

<template>
  <section class="flex flex-col gap-3" :aria-labelledby="headingId">
    <header class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 :id="headingId" class="text-lg font-semibold">Letra</h2>
      <span class="text-sm text-base-content/70">{{ lineCount === 1 ? '1 línea' : `${lineCount} líneas` }}</span>
    </header>
    <p v-if="lineCount > LYRICS_MAX_LINES" role="alert" class="text-sm text-error">{{ messages.songs.present.lyricsTooLong }}</p>
    <div class="flex max-w-prose flex-col gap-5 text-base leading-relaxed sm:text-lg">
      <p v-for="(stanza, index) in stanzas" :key="index" class="whitespace-pre-line break-words">{{ stanza.join('\n') }}</p>
    </div>
  </section>
</template>
