<script setup lang="ts">
// Dónde se monta la pila de avisos. Los diálogos se abren con `showModal()` y viven en la *top layer*: una pila fuera de
// ellos quedaría tapada, no se podría pulsar y los lectores de pantalla no la anunciarían. Por eso, mientras haya un modal
// abierto, la pila se monta dentro del `<dialog>` que quedó encima (`useOpenModal`); sin modal, en la columna del layout.
//
// El `<Teleport>` solo existe con un modal abierto (`v-if`), nunca en el HTML del servidor: un Teleport desactivado y sin
// destino que se hidrata deja su marcador de posición como ancla del destino, y al activarlo Vue se lo lleva al diálogo
// (después, volver al layout rompe el componente).
const modal = useOpenModal()
</script>

<template>
  <Teleport v-if="modal" :to="modal">
    <AppToastStack in-modal />
  </Teleport>
  <AppToastStack v-else />
</template>
