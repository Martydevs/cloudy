// Hilo de comentarios de un archivo (US8): carga inicial y sondeo cada 5 s (research R7) pidiendo solo
// los nuevos con `?since=`. Se pausa con la pestaña oculta, sin conexión o con el hilo fuera de la vista.
import type { MaybeElementRef } from '@vueuse/core'
import type { Comment } from '#shared/types/api'
import { POLL_INTERVAL_MS } from '#shared/constants/files'

export function useCommentThread(fileId: MaybeRefOrGetter<string>, target: MaybeElementRef) {
  const api = useApi()
  const url = () => `/api/files/${toValue(fileId)}/comments`
  const { data, error, status, refresh } = useApiFetch<Comment[]>(url, { lazy: true, server: false })

  const comments = computed(() => data.value ?? [])
  const visibility = useDocumentVisibility()
  const online = useOnline()
  const inView = useElementVisibility(target)
  let inFlight = false

  /** Agrega o reemplaza por `id` y mantiene el orden cronológico. */
  function merge(incoming: Comment[]) {
    if (incoming.length === 0) return
    const byId = new Map(comments.value.map(comment => [comment.id, comment]))
    for (const comment of incoming) byId.set(comment.id, comment)
    data.value = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  function replace(comment: Comment) {
    data.value = comments.value.map(current => (current.id === comment.id ? comment : current))
  }

  function remove(id: string) {
    data.value = comments.value.filter(comment => comment.id !== id)
  }

  async function poll() {
    if (inFlight || status.value !== 'success' || visibility.value !== 'visible' || !online.value || !inView.value) return
    inFlight = true
    const since = comments.value.at(-1)?.createdAt
    try {
      merge(await api<Comment[]>(url(), { query: since ? { since } : {} }))
    }
    catch {
      // Un sondeo fallido no interrumpe el hilo; el siguiente lo reintenta.
    }
    finally {
      inFlight = false
    }
  }

  async function post(body: string): Promise<Comment> {
    const comment = await api<Comment>(url(), { method: 'POST', body: { body } })
    merge([comment])
    return comment
  }

  const { resume } = useIntervalFn(poll, POLL_INTERVAL_MS, { immediate: false })
  onMounted(resume)
  // Al volver a la pestaña o al hilo no se esperan hasta 5 s.
  watch([visibility, inView], ([visible, shown]) => {
    if (visible === 'visible' && shown) poll()
  })

  return { comments, error, status, refresh, poll, post, replace, remove }
}
