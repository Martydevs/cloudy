<script setup lang="ts">
import type { ToastType } from '~/composables/useToast'

const { toasts, dismiss } = useToast()

const styles: Record<ToastType, { alert: string, icon: string }> = {
  success: { alert: 'alert-success', icon: 'lucide:circle-check' },
  error: { alert: 'alert-error', icon: 'lucide:circle-alert' },
  info: { alert: 'alert-info', icon: 'lucide:info' },
}

// Botones del aviso: toman el color del texto del aviso (`text-current`) también para el anillo de foco y
// el fondo de hover/foco. El fantasma de daisyUI usa base-content y el anillo global usa primary: sobre el
// verde oscuro del tema claro se veían casi negros y la «x» blanca se lavaba.
const control = 'btn btn-ghost -my-1.5 text-current hover:bg-current/15 focus-visible:bg-current/15 focus-visible:outline-current'
</script>

<template>
  <!--
    La región viva existe siempre para que los lectores de pantalla anuncien cada aviso. Cada layout la
    monta dentro de su columna de contenido: el envoltorio sin alto queda pegado bajo la barra superior
    (`h-16` de AppTopbar + 1rem = `top-20`) y la pila se centra respecto a él, es decir, sobre el
    contenido y no sobre el viewport, con la barra lateral expandida o contraída. Abajo tapaba los
    botones de acción de los formularios («Comentar») y a la derecha los de la cabecera («Subir»).
    En teléfono ocupa casi todo el ancho; desde `sm` es compacta (dos líneas como máximo).
  -->
  <div class="sticky top-20 z-50 h-0 w-full" role="status" aria-live="polite">
    <div class="toast toast-top toast-center absolute top-0 max-w-[calc(100%-2rem)] sm:max-w-md">
      <!-- 48 px en una línea: relleno corto y los botones (45 px, área táctil intacta) con margen negativo. -->
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="alert min-h-12 gap-2 py-1.5 pr-1.5 pl-3 whitespace-normal shadow-lg"
        :class="styles[toast.type].alert"
      >
        <Icon :name="styles[toast.type].icon" class="size-5 shrink-0" aria-hidden="true" />
        <span class="break-words">{{ toast.message }}</span>
        <NuxtLink v-if="toast.action" :to="toast.action.to" :class="control" @click="dismiss(toast.id)">
          {{ toast.action.label }}
        </NuxtLink>
        <button type="button" class="btn-square" :class="control" aria-label="Cerrar aviso" @click="dismiss(toast.id)">
          <Icon name="lucide:x" class="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>
