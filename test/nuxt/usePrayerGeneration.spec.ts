// Una generación de Peticiones (`usePrayerGeneration`, enmienda «Página de generación»): lo que guardó el servidor mezclado
// con lo que pasa ahora en el navegador. Cada grupo es una diapositiva lista, en cola, generándose, fallida, cancelada o sin
// terminar; las imágenes que terminan en esta visita y la cola solo cuentan si son de esta generación; «Generar las
// faltantes» vuelve a encolar los grupos sin terminar ligados a la generación.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, ref } from 'vue'
import { readBody, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import type { PrayerGeneratedImage, PrayerGeneration, PrayerGenerationGroup } from '#shared/types/api'
import { calls, failWith, flush, mockApi, resetCalls } from './helpers/api'
import { generated, prayer } from './prayer-fixtures'

const GEN = '30000000-0000-4000-8000-000000000001'
const OTHER = '30000000-0000-4000-8000-000000000002'
const URL = `/api/peticiones/generaciones/${GEN}`

type Reply = (event: H3Event) => unknown
interface ImageBody { fileIds: string[], generationId?: string }

const ids = (...numbers: number[]) => numbers.map(n => prayer(n).id)

/** Grupo `index` con las peticiones `numbers`; `image: true` lo da por guardado. */
const group = (index: number, numbers: number[], image = false): PrayerGenerationGroup => ({
  index,
  fileIds: ids(...numbers),
  image: image ? generated(index, { fileIds: ids(...numbers), requestCount: numbers.length, generationId: GEN }) : null,
})

const generation = (groups: PrayerGenerationGroup[]): PrayerGeneration => ({
  id: GEN,
  createdAt: '2026-11-15T10:32:00.000Z',
  author: { userId: 'u1', name: 'Ana', active: true },
  groups,
})

/** Lo que responde el servidor al generar: la imagen guardada, con la generación que llegó en el cuerpo. */
const saved: Reply = async (event) => {
  const body = await readBody<ImageBody>(event)
  setResponseStatus(event, 201)
  return generated(90, { id: `saved-${body.fileIds[0]}`, fileIds: body.fileIds, requestCount: body.fileIds.length, generationId: body.generationId ?? null })
}
const fail = (status: number, code: string): Reply => (event) => {
  setResponseStatus(event, status)
  return { statusCode: status, message: 'x', data: { code } }
}

/** Respuesta por primer id del grupo; con `hold` se queda esperando hasta `release`. */
const replies = new Map<string, Reply>()
const gates = new Map<string, () => void>()
function hold(id: string, reply: Reply = saved) {
  replies.set(id, async (event) => {
    await new Promise<void>(resolve => gates.set(id, resolve))
    return reply(event)
  })
}
const release = (id: string) => gates.get(id)?.()

const imagePosts = () => calls.filter(c => c.method === 'POST' && c.url === '/api/peticiones/imagenes')
const added = () => useState<PrayerGeneratedImage[]>(PRAYER_HISTORY_ADDED_KEY, () => [])

/** Monta el composable dentro de un componente (usa `useFetch`) y espera la primera respuesta. */
async function mountGeneration(id = GEN) {
  let api: ReturnType<typeof usePrayerGeneration> | undefined
  const Host = defineComponent({
    setup() {
      api = usePrayerGeneration(ref(id))
      return () => h('div')
    },
  })
  await mountSuspended(Host)
  await flush()
  return api!
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  clearNuxtData()
  resetCalls()
  replies.clear()
  gates.clear()
  usePrayerImages().reset()
  added().value = []
  useToast().toasts.value = []
  mockApi('GET', URL, generation([group(1, [1, 2], true), group(2, [3])]))
  mockApi('POST', '/api/peticiones/imagenes', async (event: H3Event) => {
    const body = await readBody<ImageBody>(event)
    return (replies.get(body.fileIds[0]!) ?? saved)(event)
  })
})

afterEach(() => {
  usePrayerImages().reset()
})

describe('usePrayerGeneration', () => {
  it('pide la generación por su id y da una diapositiva por grupo: lista si tiene imagen, sin terminar si no', async () => {
    const g = await mountGeneration()
    expect(calls.filter(c => c.url === URL)).toHaveLength(1)
    expect(g.generation.value?.id).toBe(GEN)
    expect(g.slides.value).toEqual([
      { key: 'g-1', index: 1, fileIds: ids(1, 2), image: expect.objectContaining({ id: generated(1).id }), state: 'ready', item: null },
      { key: 'g-2', index: 2, fileIds: ids(3), image: null, state: 'unfinished', item: null },
    ])
    expect(g.ready.value).toBe(1)
    expect(g.unfinished.value.map(slide => slide.key)).toEqual(['g-2'])
    expect(g.notFound.value).toBe(false)
    expect(g.error.value).toBeFalsy()
  })

  it('mientras carga no hay diapositivas y «Generar las faltantes» no encola nada', async () => {
    mockApi('GET', URL, () => new Promise(() => {}))
    const g = await mountGeneration()
    expect(g.pending.value).toBe(true)
    expect(g.generation.value).toBeFalsy()
    expect(g.slides.value).toEqual([])
    expect(g.ready.value).toBe(0)
    expect(g.unfinished.value).toEqual([])
    expect(g.notFound.value).toBe(false)
    expect(g.generateMissing()).toBe(0)
    expect(usePrayerImages().items.value).toEqual([])
    expect(useToast().toasts.value).toEqual([])
  })

  it('un 404 es «no encontrada»; otro fallo es un error que se puede reintentar con refresh', async () => {
    mockApi('GET', URL, failWith(404))
    const missing = await mountGeneration()
    expect(missing.notFound.value).toBe(true)
    expect(missing.slides.value).toEqual([])

    clearNuxtData()
    mockApi('GET', URL, failWith(500))
    const broken = await mountGeneration()
    expect(broken.notFound.value).toBe(false)
    expect(broken.error.value?.statusCode).toBe(500)
    expect(broken.generateMissing()).toBe(0)

    mockApi('GET', URL, generation([group(1, [1], true)]))
    await broken.refresh()
    await flush()
    expect(broken.error.value).toBeFalsy()
    expect(broken.slides.value.map(slide => slide.state)).toEqual(['ready'])
  })

  it('una imagen terminada en esta visita completa su grupo aunque los ids lleguen en otro orden; las de otra generación o de otras peticiones no', async () => {
    mockApi('GET', URL, generation([group(1, [1, 2]), group(2, [3]), group(3, [4, 5])]))
    const g = await mountGeneration()
    expect(g.slides.value.map(slide => slide.state)).toEqual(['unfinished', 'unfinished', 'unfinished'])

    const mine = generated(7, { fileIds: ids(2, 1), generationId: GEN })
    added().value = [
      mine,
      // Mismas peticiones, otra generación.
      generated(8, { fileIds: ids(3), requestCount: 1, generationId: OTHER }),
      // Esta generación, pero no coincide con ningún grupo (una petición de menos).
      generated(9, { fileIds: ids(4), requestCount: 1, generationId: GEN }),
      // Sin generación (anterior a la página).
      generated(10, { fileIds: ids(4, 5), generationId: null }),
    ]
    expect(g.slides.value.map(slide => [slide.state, slide.image?.id ?? null])).toEqual([
      ['ready', mine.id],
      ['unfinished', null],
      ['unfinished', null],
    ])
    expect(g.ready.value).toBe(1)
    expect(g.unfinished.value.map(slide => slide.index)).toEqual([2, 3])
  })

  it('la imagen que guardó el servidor manda sobre la de esta visita', async () => {
    const g = await mountGeneration()
    added().value = [generated(50, { fileIds: ids(1, 2), generationId: GEN })]
    expect(g.slides.value[0]!.image?.id).toBe(generated(1).id)
  })

  it('la cola de esta generación da el estado de cada grupo: generándose, en cola, fallida y cancelada; la de otra generación no cuenta', async () => {
    mockApi('GET', URL, generation([group(1, [1]), group(2, [2]), group(3, [3]), group(4, [4])]))
    const g = await mountGeneration()
    const images = usePrayerImages()
    hold(prayer(1).id, fail(502, 'provider'))
    hold(prayer(2).id)
    hold(prayer(3).id)
    // El grupo 4 está en la cola, pero de otra generación: aquí sigue sin terminar.
    images.enqueue([[{ id: prayer(1).id }], [{ id: prayer(2).id }], [{ id: prayer(3).id }]], { generationId: GEN })
    images.enqueue([[{ id: prayer(4).id }]], { generationId: OTHER })
    await flush()
    expect(g.slides.value.map(slide => slide.state)).toEqual(['running', 'running', 'queued', 'unfinished'])
    expect(g.slides.value.map(slide => slide.item?.key ?? null)).toEqual(['img-1', 'img-2', 'img-3', null])
    expect(g.unfinished.value.map(slide => slide.index)).toEqual([4])

    // La primera falla y la segunda se cancela: la tercera arranca.
    release(prayer(1).id)
    g.cancel('img-2')
    await flush(10)
    expect(g.slides.value.map(slide => slide.state)).toEqual(['failed', 'canceled', 'running', 'unfinished'])
    expect(g.slides.value[0]!.item).toMatchObject({ status: 'failed', errorCode: 'provider', retryable: true })
    expect(g.ready.value).toBe(0)

    // La tercera termina: sale de la cola, entra en el historial de la visita y su grupo queda listo.
    release(prayer(3).id)
    await flush(10)
    expect(g.slides.value[2]).toMatchObject({ state: 'ready', item: null, image: { id: `saved-${prayer(3).id}`, generationId: GEN } })
    expect(g.ready.value).toBe(1)
  })

  it('reintentar, volver a poner en cola y descartar son los de la cola', async () => {
    mockApi('GET', URL, generation([group(1, [1]), group(2, [2])]))
    const g = await mountGeneration()
    replies.set(prayer(1).id, fail(502, 'provider'))
    hold(prayer(2).id)
    usePrayerImages().enqueue([[{ id: prayer(1).id }], [{ id: prayer(2).id }]], { generationId: GEN })
    await flush(10)
    g.cancel('img-2')
    await flush()
    expect(g.slides.value.map(slide => slide.state)).toEqual(['failed', 'canceled'])

    // Reintentar la fallida: ahora el servidor responde bien.
    replies.set(prayer(1).id, saved)
    g.retry('img-1')
    await flush(10)
    expect(g.slides.value[0]!.state).toBe('ready')

    // La cancelada vuelve a la cola y se queda generándose.
    hold(prayer(2).id)
    g.requeue('img-2')
    await flush()
    expect(g.slides.value[1]!.state).toBe('running')

    // Descartarla la saca de la cola: el grupo queda sin terminar.
    g.dismiss('img-2')
    await flush()
    expect(g.slides.value[1]).toMatchObject({ state: 'unfinished', item: null })
    expect(usePrayerImages().items.value).toEqual([])
  })

  it('«Generar las faltantes» encola solo los grupos sin terminar, ligados a la generación, y avisa cuántas', async () => {
    mockApi('GET', URL, generation([group(1, [1, 2], true), group(2, [3, 4]), group(3, [5])]))
    const g = await mountGeneration()
    hold(prayer(3).id)
    hold(prayer(5).id)
    expect(g.generateMissing()).toBe(2)
    await flush()
    expect(imagePosts().map(c => c.body)).toEqual([
      { fileIds: ids(3, 4), generationId: GEN },
      { fileIds: ids(5), generationId: GEN },
    ])
    expect(useToast().toasts.value.map(t => t.message)).toEqual(['2 imágenes en cola'])
    expect(g.slides.value.map(slide => slide.state)).toEqual(['ready', 'running', 'running'])
    expect(g.unfinished.value).toEqual([])

    // Ya no falta ninguna: un segundo clic no gasta crédito ni avisa.
    expect(g.generateMissing()).toBe(0)
    await flush()
    expect(imagePosts()).toHaveLength(2)
    expect(useToast().toasts.value).toHaveLength(1)

    release(prayer(3).id)
    release(prayer(5).id)
    await flush(10)
    expect(g.slides.value.map(slide => slide.state)).toEqual(['ready', 'ready', 'ready'])
    expect(g.ready.value).toBe(3)
  })

  it('una sola faltante avisa en singular', async () => {
    const g = await mountGeneration()
    hold(prayer(3).id)
    expect(g.generateMissing()).toBe(1)
    expect(useToast().toasts.value.map(t => t.message)).toEqual(['1 imagen en cola'])
  })

  it('una generación sin grupos no tiene diapositivas', async () => {
    mockApi('GET', URL, generation([]))
    const g = await mountGeneration()
    expect(g.generation.value?.groups).toEqual([])
    expect(g.slides.value).toEqual([])
    expect(g.generateMissing()).toBe(0)
  })
})
