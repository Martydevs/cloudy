// Cola de subidas (research R5): validación local → presign → PUT directo con progreso → complete.
import { FetchError } from 'ofetch'
import type { FileItem, UploadTicket } from '#shared/types/api'
import { getExtension } from '#shared/constants/files'
import { isImageTextEligible } from '#shared/constants/image-text'
import { checkUploadFile } from '#shared/validation/files'

export type UploadStatus = 'queued' | 'uploading' | 'verifying' | 'done' | 'error'

export interface UploadItem {
  id: string
  name: string
  size: number
  status: UploadStatus
  /** 0–100 */
  progress: number
  error: string | null
  retryable: boolean
  /** Generando y subiendo la copia JPEG de una HEIC para leer su texto (feature 002). */
  preparing?: boolean
}

const CONCURRENCY = 3

/** Con estos códigos reintentar no cambia nada: el archivo o la sesión son el problema. */
const NOT_RETRYABLE = new Set([401, 403, 413, 415, 422])

/** Mensaje para el usuario (regla general de `serverMessage` con respaldos por código) y si tiene sentido reintentar. */
function uploadFailure(error: unknown, name: string): { message: string, retryable: boolean } {
  const status = error instanceof FetchError ? error.response?.status ?? 0 : 0
  const message = serverMessage(error, messages.files.uploadInterrupted(name), {
    413: messages.files.unsupported(name),
    415: messages.files.unsupported(name),
    422: messages.files.invalidContent,
    401: messages.common.sessionChanged,
    403: messages.common.sessionChanged,
  })
  return { message, retryable: !NOT_RETRYABLE.has(status) }
}

export function useUploader(options: { folderId: MaybeRefOrGetter<string | null>, onSettled?: (uploaded: FileItem[]) => void }) {
  const api = useApi()
  const toast = useToast()
  const items = ref<UploadItem[]>([])

  // Lo no reactivo vive fuera de `items`: los File, los XHR activos y el id del registro reservado.
  const sources = new Map<string, File>()
  const requests = new Map<string, XMLHttpRequest>()
  const reserved = new Map<string, string>()
  let batch: FileItem[] = []
  let failed = 0

  const active = computed(() => items.value.filter(i => i.status === 'uploading' || i.status === 'verifying').length)
  const busy = computed(() => items.value.some(i => i.status === 'queued' || i.status === 'uploading' || i.status === 'verifying'))

  function patch(id: string, changes: Partial<UploadItem>) {
    const item = items.value.find(i => i.id === id)
    if (item) Object.assign(item, changes)
  }

  function add(files: File[]) {
    for (const file of files) {
      const id = crypto.randomUUID()
      const problem = checkUploadFile(file)
      sources.set(id, file)
      items.value.push({
        id,
        name: file.name,
        size: file.size,
        status: problem ? 'error' : 'queued',
        progress: 0,
        error: problem?.message ?? null,
        retryable: false,
        preparing: false,
      })
      if (problem) failed++
    }
    pump()
  }

  function pump() {
    const queued = items.value.filter(i => i.status === 'queued')
    for (const item of queued.slice(0, Math.max(0, CONCURRENCY - active.value))) {
      start(item.id)
    }
    if (!busy.value && (batch.length > 0 || failed > 0)) settle()
  }

  function settle() {
    if (batch.length > 0) {
      toast.success(batch.length === 1 ? messages.files.uploadedOne(batch[0]!.name) : messages.files.uploadedMany(batch.length))
    }
    if (failed > 0) toast.error(messages.files.uploadFailedCount(failed))
    const uploaded = batch
    batch = []
    failed = 0
    if (uploaded.length > 0) options.onSettled?.(uploaded)
  }

  async function start(id: string) {
    const file = sources.get(id)
    if (!file) return
    patch(id, { status: 'uploading', progress: 0, error: null })
    try {
      const thumbnail = await makeThumbnail(file)
      // Una HEIC apta sube además su copia JPEG para leer el texto, sin esperar la conversión (research A4).
      const withTextSource = getExtension(file.name) === 'heic' && isImageTextEligible({ extension: 'heic', size: file.size })
      const ticket = await api<UploadTicket>('/api/uploads', {
        method: 'POST',
        body: { folderId: toValue(options.folderId), name: file.name, size: file.size, mimeType: file.type, withThumbnail: !!thumbnail, withTextSource },
      })
      if (!sources.has(id)) {
        // Se canceló mientras se pedía la firma: se libera la reserva y no se sube nada.
        api(`/api/uploads/${ticket.fileId}`, { method: 'DELETE' }).catch(() => {})
        return
      }
      reserved.set(id, ticket.fileId)

      // La copia se convierte y sube en paralelo con el original; nunca rechaza (FR-023).
      let textSource: Promise<void> = Promise.resolve()
      if (ticket.textSourceUploadUrl) {
        patch(id, { preparing: true })
        textSource = uploadTextSourceCopy(file, ticket.textSourceUploadUrl).finally(() => patch(id, { preparing: false }))
      }

      await putWithProgress(ticket.uploadUrl, file, ticket.headers, (ratio) => {
        patch(id, { progress: Math.min(99, Math.round(ratio * 100)) })
      }, xhr => requests.set(id, xhr))

      if (thumbnail && ticket.thumbUploadUrl) {
        // La miniatura es opcional: si falla, el archivo se muestra con su ícono.
        await putWithProgress(ticket.thumbUploadUrl, thumbnail, { 'content-type': 'image/webp' }, () => {}, xhr => requests.set(id, xhr)).catch(() => {})
      }

      await textSource
      patch(id, { status: 'verifying' })
      const result = await api<FileItem>(`/api/uploads/${ticket.fileId}/complete`, { method: 'POST' })
      reserved.delete(id)
      patch(id, { status: 'done', progress: 100 })
      batch.push(result)
    }
    catch (error) {
      if (error instanceof UploadAbort) return
      const { message, retryable } = uploadFailure(error, file.name)
      patch(id, { status: 'error', error: message, retryable })
      failed++
      // Sin registros a medias (Constitución II): se libera la reserva del servidor.
      const fileId = reserved.get(id)
      reserved.delete(id)
      if (fileId) api(`/api/uploads/${fileId}`, { method: 'DELETE' }).catch(() => {})
    }
    finally {
      requests.delete(id)
      pump()
    }
  }

  function retry(id: string) {
    const item = items.value.find(i => i.id === id)
    if (!item || item.status !== 'error' || !item.retryable) return
    failed = Math.max(0, failed - 1)
    patch(id, { status: 'queued', progress: 0, error: null })
    pump()
  }

  function cancel(id: string) {
    requests.get(id)?.abort()
    const fileId = reserved.get(id)
    if (fileId) api(`/api/uploads/${fileId}`, { method: 'DELETE' }).catch(() => {})
    reserved.delete(id)
    sources.delete(id)
    items.value = items.value.filter(i => i.id !== id)
    pump()
  }

  function cancelAll() {
    for (const item of [...items.value]) {
      if (item.status === 'queued' || item.status === 'uploading' || item.status === 'verifying') cancel(item.id)
    }
  }

  return { items, busy, add, retry, cancel, cancelAll }
}
