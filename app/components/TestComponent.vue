<template>
  <div>
    aquí un componente de prueba...
    <button class="btn btn-primary" @click="handleFetch">Da click aquí!</button>

    <span>{{ fetchResult }}</span>
  </div>
</template>

<script setup lang="ts">

const fetchResult = ref<string>("")

const handleFetch = async () => {
  const data = await $fetch("/api/test")

  fetchResult.value = data.message
}

</script>

<style scoped>

</style>