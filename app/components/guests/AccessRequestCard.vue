<script setup lang="ts">
// Una solicitud de acceso abierta (feature 003, FR-008–FR-010, FR-025): "Dar acceso" con un toque y
// "Rechazar" con confirmación. Si otra persona ya decidió, el servidor explica qué pasó (409/410/404).
import { FetchError } from 'ofetch'
import type { AccessRequest } from '#shared/types/api'

const props = defineProps<{ request: AccessRequest }>()
const emit = defineEmits<{ decided: [] }>()

const api = useApi()
const toast = useToast()
const { confirm } = useConfirm()
const { timeAgo, now } = useRelativeTime()
const busy = ref(false)
const titleId = useId()

// Reloj reactivo: `now()` no lo es y el computed se quedaría con el primer valor. Durante la hidratación vale la hora del
// render del servidor (sin desajustes) y, ya montada, la real, cada medio minuto.
const clock = ref(now())
onMounted(() => {
  clock.value = Date.now()
})
useIntervalFn(() => {
  clock.value = Date.now()
}, 30_000)
const minutesLeft = computed(() => Math.max(1, Math.round((Date.parse(props.request.expiresAt) - clock.value) / 60_000)))

async function decide(verb: 'approve' | 'reject') {
  const name = props.request.senderName
  if (verb === 'reject' && !await confirm({ title: messages.access.confirmReject(name), confirmLabel: 'Rechazar', danger: true })) return
  busy.value = true
  try {
    await api(`/api/access-requests/${props.request.id}/${verb}`, { method: 'POST' })
    toast.success(verb === 'approve' ? messages.access.granted(name) : messages.access.rejected(name))
    await refreshPulse()
  }
  catch (err) {
    // 409: otra persona ya decidió (informativo); 410/404 y el resto: no se pudo.
    const message = serverMessage(err, messages.access.decideFailed)
    if (err instanceof FetchError && err.response?.status === 409) toast.info(message)
    else toast.error(message)
  }
  finally {
    busy.value = false
    emit('decided')
  }
}
</script>

<template>
  <article class="card border border-base-300 bg-base-100" :aria-labelledby="titleId">
    <div class="card-body gap-3 p-4 sm:flex-row sm:items-center">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <Icon name="lucide:door-open" class="size-6 shrink-0 text-primary" aria-hidden="true" />
        <div class="flex min-w-0 flex-col">
          <h3 :id="titleId" class="truncate font-semibold">{{ request.senderName }}</h3>
          <p class="text-sm text-base-content/70">{{ timeAgo(request.createdAt) }} · caduca en {{ minutesLeft }} min</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:flex">
        <button type="button" class="btn btn-outline" :disabled="busy" @click="decide('reject')">
          <Icon name="lucide:x" class="size-4" aria-hidden="true" />
          Rechazar
        </button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="decide('approve')">
          <span v-if="busy" class="loading loading-spinner loading-sm" aria-hidden="true" />
          <Icon v-else name="lucide:check" class="size-4" aria-hidden="true" />
          Dar acceso
        </button>
      </div>
    </div>
  </article>
</template>
