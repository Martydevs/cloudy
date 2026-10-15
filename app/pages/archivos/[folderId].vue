<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  access: 'private',
  // Solo ids con forma de uuid; el resto es un 404.
  validate: route => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(route.params.folderId)),
})

const route = useRoute()
const folderId = computed(() => String(route.params.folderId))
</script>

<template>
  <FileExplorer :key="folderId" :folder-id="folderId" />
</template>
