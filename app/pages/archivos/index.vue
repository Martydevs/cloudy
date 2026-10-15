<script setup lang="ts">
definePageMeta({ layout: 'dashboard', access: 'private' })
</script>

<template>
  <FileExplorer :folder-id="null" />
</template>
