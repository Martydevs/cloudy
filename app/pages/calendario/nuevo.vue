<script setup lang="ts">
// Agendar un día de trabajo (solo administradores). `?fecha=AAAA-MM-DD` es la fecha que mostraba el calendario; si no
// viene o no es válida, el campo empieza vacío.
import { parseIsoDate } from '#shared/validation/calendar'

definePageMeta({ layout: 'dashboard', access: 'private', roles: ['admin'] })
useHead({ title: 'Agendar día · Cloudy' })

const route = useRoute()
const initialDate = typeof route.query.fecha === 'string' && parseIsoDate(route.query.fecha) !== null ? route.query.fecha : ''
</script>

<template>
  <WorkDayForm :initial-date="initialDate" />
</template>
