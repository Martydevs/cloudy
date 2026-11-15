// Una generación de Peticiones (enmienda «Página de generación», 2026-11-15): lo que guarda el servidor (grupos e imágenes
// ya guardadas) mezclado con lo que pasa ahora en el navegador: las imágenes que terminan en esta visita
// (`PRAYER_HISTORY_ADDED_KEY`, las escribe `usePrayerImages`) y las que siguen en la cola. Cada grupo es una diapositiva:
// lista, en cola, generándose, fallida, cancelada o **sin terminar** (sin imagen y fuera de la cola, p. ej. tras recargar).
import type { PrayerGeneratedImage, PrayerGeneration } from '#shared/types/api'
import { sameRequests } from '#shared/prayers'
import type { PrayerImageItem, PrayerImageStatus } from './usePrayerImages'

export type PrayerSlideState = 'ready' | PrayerImageStatus | 'unfinished'

export interface PrayerGenerationSlide {
  key: string
  /** 1-based. */
  index: number
  fileIds: string[]
  image: PrayerGeneratedImage | null
  state: PrayerSlideState
  /** El elemento de la cola, si está en ella. */
  item: PrayerImageItem | null
}

export function usePrayerGeneration(id: Ref<string>) {
  const images = usePrayerImages()
  const added = useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY, () => [])
  const toast = useToast()
  const m = messages.prayers.generation

  const { data, error, pending, refresh } = useApiFetch<PrayerGeneration>(() => `/api/peticiones/generaciones/${id.value}`, {
    key: `prayer-generation-${id.value}`,
  })

  const slides = computed<PrayerGenerationSlide[]>(() => {
    const generation = data.value
    if (!generation) return []
    const fresh = added.value.filter(image => image.generationId === generation.id)
    const queue = images.items.value.filter(item => item.generationId === generation.id)
    return generation.groups.map((group) => {
      const image = group.image ?? fresh.find(other => sameRequests(other.fileIds, group.fileIds)) ?? null
      const item = image ? null : queue.find(other => sameRequests(other.fileIds, group.fileIds)) ?? null
      return {
        key: `g-${group.index}`,
        index: group.index,
        fileIds: group.fileIds,
        image,
        state: image ? 'ready' : item ? item.status : 'unfinished',
        item,
      }
    })
  })

  const ready = computed(() => slides.value.filter(slide => slide.state === 'ready').length)
  const unfinished = computed(() => slides.value.filter(slide => slide.state === 'unfinished'))
  const notFound = computed(() => !data.value && error.value?.statusCode === 404)

  /** Vuelve a encolar, ligadas a esta generación, las imágenes que no llegaron a generarse. */
  function generateMissing(): number {
    const generation = data.value
    if (!generation) return 0
    const queued = images.enqueue(unfinished.value.map(slide => slide.fileIds.map(fileId => ({ id: fileId }))), { generationId: generation.id })
    if (queued > 0) toast.info(m.queuedMissing(queued))
    return queued
  }

  return {
    generation: data,
    error,
    pending,
    refresh,
    notFound,
    slides,
    ready,
    unfinished,
    generateMissing,
    retry: images.retry,
    cancel: images.cancel,
    requeue: images.regenerate,
    dismiss: images.dismiss,
  }
}
