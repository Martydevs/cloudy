<script setup lang="ts">
import type { ToastType } from '~/composables/useToast'

const { toasts, dismiss } = useToast()

const styles: Record<ToastType, { alert: string, icon: string }> = {
  success: { alert: 'alert-success', icon: 'lucide:circle-check' },
  error: { alert: 'alert-error', icon: 'lucide:circle-alert' },
  info: { alert: 'alert-info', icon: 'lucide:info' },
}
</script>

<template>
  <!-- La región viva existe siempre para que los lectores de pantalla anuncien cada aviso. -->
  <div class="toast toast-end toast-bottom z-50 max-w-[calc(100vw-1rem)]" role="status" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="alert whitespace-normal"
      :class="styles[toast.type].alert"
    >
      <Icon :name="styles[toast.type].icon" class="size-5 shrink-0" aria-hidden="true" />
      <span class="break-words">{{ toast.message }}</span>
      <NuxtLink v-if="toast.action" :to="toast.action.to" class="btn btn-ghost" @click="dismiss(toast.id)">
        {{ toast.action.label }}
      </NuxtLink>
      <button type="button" class="btn btn-ghost btn-square" aria-label="Cerrar aviso" @click="dismiss(toast.id)">
        <Icon name="lucide:x" class="size-4" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
