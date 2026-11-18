// Envío de un invitado (FR-016): validar en local → presignar el lote → PUT de 3 en 3 → un solo `complete`.
import { MAX_GUEST_FILES } from '#shared/constants/files'
import type { GuestUploadTicket } from '#shared/types/api'
import { checkUploadFile } from '#shared/validation/files'
import { checkPrayerPhoto } from '#shared/validation/prayers'
import type { UploadItem } from '~/composables/useUploader'

export type SubmissionStatus = 'idle' | 'submitting' | 'done' | 'error'

export interface SubmissionResult {
  accepted: number
  rejected: number
}

const CONCURRENCY = 3

export const OPEN_SUBMISSIONS_URL = '/api/public/submissions'

/** Cierre del envío de un invitado. */
export const guestCompleteUrl = (submissionId: string) => `/api/public/submissions/${submissionId}/complete`

export interface GuestSubmissionOptions {
  /** Endpoint que crea el envío y firma las subidas. */
  createUrl?: string
  /** Endpoint que cierra el envío; el alta manual de Peticiones usa el suyo. */
  completeUrl?: (submissionId: string) => string
  /** Solo imágenes (alta manual de Peticiones): los demás archivos quedan marcados con error y no se suben. */
  imagesOnly?: boolean
}

export function useGuestSubmission({ createUrl = OPEN_SUBMISSIONS_URL, completeUrl = guestCompleteUrl, imagesOnly = false }: GuestSubmissionOptions = {}) {
  const check = imagesOnly ? checkPrayerPhoto : checkUploadFile
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
      const problem = check(file)
      sources.set(id, file)
      items.value.push({ id, name: file.name, size: file.size, status: problem ? 'error' : 'queued', progress: 0, error: problem?.message ?? null, retryable: false })
    }
  }

  function remove(id: string) {
    sources.delete(id)
    items.value = items.value.filter(i => i.id !== id)
  }

  /** HEIC → JPEG: el JPEG reemplaza al archivo en la cola (nombre y tamaño incluidos). Nunca rechaza. */
  async function convertHeic(id: string) {
    const file = sources.get(id)
    if (!file || !(await shouldConvertHeic(file))) return
    patch(id, { preparing: true })
    const jpeg = await convertHeicToJpeg(file)
    patch(id, { preparing: false })
    if (!jpeg || !sources.has(id)) return
    sources.set(id, jpeg)
    patch(id, { name: jpeg.name, size: jpeg.size })
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
      // Cada HEIC se convierte a JPEG y se envía en su lugar (la HEIC no se guarda); si no se puede, va tal cual.
      await Promise.all(queued.map(item => convertHeic(item.id)))
      const ticket = await $fetch<{ submissionId: string, uploads: GuestUploadTicket[] }>(createUrl, {
        method: 'POST',
        body: {
          senderName: form.senderName,
          note: form.note || undefined,
          files: queued.map(item => ({
            name: item.name,
            size: item.size,
            mimeType: sources.get(item.id)?.type ?? '',
          })),
        },
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

      const outcome = await $fetch<SubmissionResult>(completeUrl(ticket.submissionId), { method: 'POST' })
      for (const item of queued) patch(item.id, { status: 'done', progress: 100 })
      result.value = { accepted: outcome.accepted, rejected: outcome.rejected }
      status.value = 'done'
      return result.value
    }
    catch (err) {
      for (const item of queued) patch(item.id, { status: 'queued', progress: 0 })
      // El límite por hora tiene su propio texto.
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
