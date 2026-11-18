// El `<dialog>` abierto que quedó encima. Los diálogos se abren con `showModal()` y viven en la *top layer*: nada del
// resto de la página se pinta sobre ellos ni se puede pulsar. `AppToast` usa este destino para teleportar los avisos dentro
// del diálogo de arriba mientras haya alguno abierto.

/** Orden de apertura: se conservan los que siguen abiertos y los nuevos van al final (el último es el de arriba). */
export function nextModalStack(stack: HTMLDialogElement[], open: HTMLDialogElement[]): HTMLDialogElement[] {
  const kept = stack.filter(dialog => open.includes(dialog))
  return [...kept, ...open.filter(dialog => !kept.includes(dialog))]
}

/** El diálogo abierto de más arriba, o `null`. Siempre `null` en el servidor y durante la hidratación. */
export function useOpenModal() {
  const stack = shallowRef<HTMLDialogElement[]>([])

  function sync() {
    // Solo los que siguen en el documento: un diálogo desmontado sin cerrarse conserva su atributo `open`.
    const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]
    const next = nextModalStack(stack.value, open)
    if (next.length !== stack.value.length || next.some((dialog, i) => dialog !== stack.value[i])) stack.value = next
  }

  if (import.meta.client) {
    // Un solo observador para todos los diálogos, sin tocar cada componente: `open` cambia al abrir y cerrar, y un diálogo
    // puede salir del DOM todavía abierto (`v-if`). Los demás cambios del DOM no interesan.
    useMutationObserver(
      () => document.body,
      (records) => {
        if (records.some(record => record.type === 'attributes' || record.removedNodes.length > 0)) sync()
      },
      { attributes: true, attributeFilter: ['open'], childList: true, subtree: true },
    )
    onMounted(sync)
  }

  return computed(() => stack.value.at(-1) ?? null)
}
