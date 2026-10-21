// Envío de un invitado (FR-016): validar en local → presignar el lote → PUT de 3 en 3 → un solo `complete`.
import { getExtension, MAX_GUEST_FILES } from '#shared/constants/files'
import { isImageTextEligible } from '#shared/constants/image-text'
import type { GuestUploadTicket } from '#shared/types/api'
import { checkUploadFile } from '#shared/validation/files'
import type { UploadItem } from '~/composables/useUploader'

export type SubmissionStatus = 'idle' | 'submitting' | 'done' | 'error'

export interface SubmissionResult {
  accepted: number
  rejected: number
}

const CONCURRENCY = 3

/** HEIC apta: sube además su copia JPEG para leer el texto (feature 002, research A4). */
const wantsTextSource = (file: File | undefined) =>
  !!file && getExtension(file.name) === 'heic' && isImageTextEligible({ extension: 'heic', size: file.size })

export function useGuestSubmission() {
  const items = ref<UploadItem[]>([])
  const sources = new Map<string, File>()
  const status = ref<SubmissionStatus>('idle')
  const error = ref('')
  const result = ref<SubmissionResult | null>(null)

  const validCount = computed(() => items.value.filter(i => i.status === 'queued').length)

  function patch(id: string, changes: Partial<UploadItem>) {
    const item = items.value.find(i => i.id === id)
    if (item) Object.assign(item, changes)
  }

  function add(files: File[]) {
    for (const file of files) {
      if (items.value.length >= MAX_GUEST_FILES) {
        error.value = `Puedes enviar como máximo ${MAX_GUEST_FILES} archivos`
        break
      }
      const id = crypto.randomUUID()
      const problem = checkUploadFile(file)
      sources.set(id, file)
      items.value.push({ id, name: file.name, size: file.size, status: problem ? 'error' : 'queued', progress: 0, error: problem?.message ?? null, retryable: false })
    }
  }

  function remove(id: string) {
    sources.delete(id)
    items.value = items.value.filter(i => i.id !== id)
  }

  async function submit(form: { senderName: string, note: string }): Promise<SubmissionResult | null> {
    const queued = items.value.filter(i => i.status === 'queued')
    if (queued.length === 0) {
      error.value = 'Agrega al menos un archivo válido'
      return null
    }
    status.value = 'submitting'
    error.value = ''
    try {
      const ticket = await $fetch<{ submissionId: string, uploads: GuestUploadTicket[] }>('/api/public/submissions', {
        method: 'POST',
        body: {
          senderName: form.senderName,
          note: form.note || undefined,
          files: queued.map(item => ({
            name: item.name,
            size: item.size,
            mimeType: sources.get(item.id)?.type ?? '',
            withTextSource: wantsTextSource(sources.get(item.id)),
          })),
        },
      })

      // Las copias JPEG de las HEIC se convierten y suben en paralelo con los originales; nunca rechazan.
      const textSources = queued.flatMap((item, index) => {
        const url = ticket.uploads[index]?.textSourceUploadUrl
        if (!url) return []
        patch(item.id, { preparing: true })
        return [uploadTextSourceCopy(sources.get(item.id)!, url).finally(() => patch(item.id, { preparing: false }))]
      })

      // Las subidas van de 3 en 3; `uploads` llega en el mismo orden que `files`.
      let next = 0
      async function worker() {
        while (next < queued.length) {
          const index = next++
          const item = queued[index]!
          const upload = ticket.uploads[index]!
          patch(item.id, { status: 'uploading', progress: 0 })
          await putWithProgress(upload.uploadUrl, sources.get(item.id)!, upload.headers, (ratio) => {
            patch(item.id, { progress: Math.min(99, Math.round(ratio * 100)) })
          })
          patch(item.id, { status: 'verifying' })
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker))
      await Promise.all(textSources)

      const outcome = await $fetch<{ status: 'pending' } & SubmissionResult>(`/api/public/submissions/${ticket.submissionId}/complete`, { method: 'POST' })
      for (const item of queued) patch(item.id, { status: 'done', progress: 100 })
      result.value = { accepted: outcome.accepted, rejected: outcome.rejected }
      status.value = 'done'
      return result.value
    }
    catch (err) {
      for (const item of queued) patch(item.id, { status: 'queued', progress: 0 })
      // El límite por hora de invitados tiene su propio texto; el resto sigue la regla general.
      error.value = serverMessage(err, messages.guest.sendFailed, { 429: messages.guest.tooMany })
      status.value = 'error'
      return null
    }
  }

  function reset() {
    items.value = []
    sources.clear()
    status.value = 'idle'
    error.value = ''
    result.value = null
  }

  return { items, status, error, result, validCount, add, remove, submit, reset }
}
