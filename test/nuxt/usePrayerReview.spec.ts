// Revisión del texto de las peticiones (revisión antes de generar): una sola carga de lo guardado, lectura una a la vez y
// en el orden de las imágenes, reutilizar lo guardado, cerrar deja de leer, un fallo no detiene a las demás, sin crédito o
// sin configurar se detiene todo, y guardar, verificar, reintentar, escribir a mano y volver a leer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getQuery, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { PRAYER_TRANSCRIPT_TIMEOUT_MS } from '#shared/constants/prayers'
import type { PrayerTranscript } from '#shared/types/api'
import { calls, flush, mockApi, resetCalls } from './helpers/api'
import { prayer } from './prayer-fixtures'

// Sin red el transporte rechaza sin respuesta: se simula por encima de `$api`.
const net = vi.hoisted(() => ({ offline: false }))
mockNuxtImport('useApi', original => () => (net.offline ? (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as ReturnType<typeof original> : original()))

type Reply = (event: H3Event) => unknown

const REQUESTS = [prayer(1), prayer(2), prayer(3)]
const [A, B, C] = REQUESTS.map(request => request.id) as [string, string, string]

const transcript = (fileId: string, changes: Partial<PrayerTranscript> = {}): PrayerTranscript => ({
  fileId, text: `Texto de ${fileId.slice(-1)}`, status: 'draft', origin: 'model', verifiedAt: null, verifiedBy: null, updatedAt: '2026-11-17T10:00:00.000Z',
  ...changes,
})
const fail = (status: number, data?: Record<string, unknown>): Reply => (event) => {
  setResponseStatus(event, status)
  return { statusCode: status, message: 'x', ...(data ? { data } : {}) }
}

/** Lo guardado que devuelve el `GET`, la respuesta de cada lectura y de cada guardado, por id. */
let stored: PrayerTranscript[] = []
let listReply: Reply | null = null
let listQueries: string[] = []
const reads = new Map<string, Reply>()
const saves = new Map<string, Reply>()
const gates = new Map<string, () => void>()
/** La lectura de `id` espera hasta `release(id)`. */
function hold(id: string, reply: Reply = () => transcript(id)) {
  reads.set(id, async (event) => {
    await new Promise<void>(resolve => gates.set(id, resolve))
    return reply(event)
  })
}
const release = async (id: string) => {
  gates.get(id)?.()
  await flush(8)
}

const readCalls = () => calls.filter(c => c.method === 'POST' && c.url.endsWith('/lectura')).map(c => c.url.split('/').at(-2))
const saveCalls = () => calls.filter(c => c.method === 'PATCH')
const statuses = () => usePrayerReview().cards.value.map(card => card.status)
const card = (id: string) => usePrayerReview().cards.value.find(item => item.fileId === id)!

async function open(requests = REQUESTS) {
  const review = usePrayerReview()
  await review.open(requests)
  await flush(8)
  return review
}

beforeEach(() => {
  resetCalls()
  net.offline = false
  stored = []
  listReply = null
  listQueries = []
  reads.clear()
  saves.clear()
  gates.clear()
  usePrayerReview().close()
  useState('prayer-review').value = {}
  useState('prayer-review-requests').value = []
  useToast().toasts.value = []
  mockApi('GET', '/api/peticiones/transcripciones', (event: H3Event) => {
    listQueries.push(String(getQuery(event).ids))
    return listReply ? listReply(event) : stored
  })
  for (const id of [A, B, C]) {
    mockApi('POST', `/api/peticiones/transcripciones/${id}/lectura`, (event: H3Event) => (reads.get(id) ?? (() => transcript(id)))(event))
    mockApi('PATCH', `/api/peticiones/transcripciones/${id}`, (event: H3Event) => (saves.get(id) ?? (() => transcript(id, { status: 'verified' })))(event))
  }
})

afterEach(() => {
  vi.useRealTimers()
  usePrayerReview().close()
})

describe('usePrayerReview', () => {
  it('una sola carga para todos los ids y después lee las que faltan, una a la vez y en el orden de las imágenes', async () => {
    hold(A)
    hold(C)
    stored = [transcript(B, { status: 'verified', text: 'Ya verificada' })]
    const review = await open()
    expect(listQueries).toEqual([[A, B, C].join(',')])
    expect(review.phase.value).toBe('ready')
    // La primera se está leyendo, la segunda ya tenía texto y la tercera espera su turno.
    expect(statuses()).toEqual(['reading', 'verified', 'waiting'])
    expect(readCalls()).toEqual([A])

    await release(A)
    expect(card(A)).toMatchObject({ status: 'draft', text: 'Texto de 1' })
    expect(statuses()).toEqual(['draft', 'verified', 'reading'])
    expect(readCalls()).toEqual([A, C])

    await release(C)
    expect(statuses()).toEqual(['draft', 'verified', 'draft'])
    // La que ya tenía texto guardado no se lee: no gasta crédito.
    expect(readCalls()).toEqual([A, C])
    expect(calls.filter(c => c.url.endsWith('/lectura')).map(c => c.body)).toEqual([{ force: false }, { force: false }])
    expect(review.announcement.value).toBe('Texto de la petición de Invitado 3 listo para revisar')
  })

  it('con todo guardado no llama al modelo; cuenta verificadas y pendientes', async () => {
    stored = [transcript(A, { status: 'verified' }), transcript(B), transcript(C, { status: 'verified' })]
    const review = await open()
    expect(readCalls()).toEqual([])
    expect(review.verifiedCount.value).toBe(2)
    expect(review.pendingCount.value).toBe(1)
    expect(review.allVerified.value).toBe(false)
  })

  it('todas verificadas → se puede generar', async () => {
    stored = [A, B, C].map(id => transcript(id, { status: 'verified' }))
    const review = await open()
    expect(review.allVerified.value).toBe(true)
  })

  it('una lectura sin texto queda «empty»; un borrador manual vacío es un borrador', async () => {
    reads.set(A, () => transcript(A, { text: '' }))
    stored = [transcript(B, { text: '', origin: 'manual' })]
    const review = await open([prayer(1), prayer(2)])
    expect(statuses()).toEqual(['empty', 'draft'])
    expect(review.announcement.value).toBe('La foto de la petición de Invitado 1 no tiene texto legible')
  })

  it('si la carga falla: error con reintento, sin leer nada y sin poder generar; reintentar la carga sigue', async () => {
    listReply = fail(500)
    const review = await open()
    expect(review.phase.value).toBe('error')
    expect(readCalls()).toEqual([])
    expect(review.allVerified.value).toBe(false)
    listReply = null
    stored = [A, B, C].map(id => transcript(id, { status: 'verified' }))
    await review.reload()
    await flush()
    expect(review.phase.value).toBe('ready')
    expect(review.allVerified.value).toBe(true)
  })

  it('un fallo no detiene a las demás: la tarjeta queda fallida con «Reintentar» y la siguiente se lee', async () => {
    reads.set(A, fail(502, { code: 'provider' }))
    const review = await open()
    expect(card(A)).toMatchObject({ status: 'failed', errorCode: 'provider', retryable: true, error: 'No pudimos leer esta foto. Reintenta o escribe el texto a mano.' })
    expect(statuses()).toEqual(['failed', 'draft', 'draft'])
    expect(readCalls()).toEqual([A, B, C])
    expect(review.halted.value).toBeNull()

    reads.delete(A)
    review.retry(A)
    await flush(8)
    expect(card(A)).toMatchObject({ status: 'draft', text: 'Texto de 1' })
    expect(readCalls()).toEqual([A, B, C, A])
  })

  it.each([
    ['504', fail(504), 'timeout', 'La lectura tardó demasiado. Reintenta o escribe el texto a mano.'],
    ['429', fail(429), 'rate_limited', 'El servicio de lectura está ocupado. Espera un momento y reintenta, o escribe el texto a mano.'],
    ['500 sin código', fail(500), null, 'No pudimos leer esta foto. Reintenta o escribe el texto a mano.'],
  ])('%s → fallida y reintentable', async (_, reply, code, message) => {
    reads.set(A, reply)
    await open([prayer(1)])
    expect(card(A)).toMatchObject({ status: 'failed', errorCode: code, retryable: true, error: message })
  })

  it('sin conexión → fallida y reintentable', async () => {
    reads.set(A, fail(502, { code: 'provider' }))
    await open([prayer(1)])
    // La carga ya pasó; el reintento de la lectura se queda sin red.
    net.offline = true
    usePrayerReview().retry(A)
    await flush(8)
    expect(card(A)).toMatchObject({ status: 'failed', errorCode: null, retryable: true, error: 'Se perdió la conexión al leer la foto. Revisa tu conexión.' })
  })

  it('una foto que no se puede leer (HEIC sin copia) queda fallida sin «Reintentar» y las demás siguen', async () => {
    reads.set(A, fail(422, { code: 'unreadable_image', ids: [A] }))
    const review = await open()
    expect(card(A)).toMatchObject({
      status: 'failed', errorCode: 'unreadable_image', retryable: false,
      error: 'Esta foto no se puede leer automáticamente. Escribe el texto a mano o quítala de la selección.',
    })
    expect(statuses()).toEqual(['failed', 'draft', 'draft'])
    // «Reintentar» no hace nada con un fallo definitivo.
    review.retry(A)
    await flush()
    expect(readCalls()).toEqual([A, B, C])
  })

  it.each([
    ['quota_exceeded', 'Se agotó el crédito del servicio de lectura. Escribe el texto a mano.'],
    ['not_configured', 'La lectura de fotos no está configurada. Escribe el texto a mano.'],
  ] as const)('%s detiene la lectura de las que faltan; escribir a mano sigue funcionando', async (code, message) => {
    reads.set(A, fail(503, { code }))
    const review = await open()
    expect(review.halted.value).toBe(code)
    // Ni la segunda ni la tercera se intentan.
    expect(readCalls()).toEqual([A])
    expect(review.cards.value.map(item => [item.status, item.retryable, item.error])).toEqual([
      ['failed', false, message], ['failed', false, message], ['failed', false, message],
    ])

    review.writeByHand(B)
    expect(card(B)).toMatchObject({ status: 'draft', text: '' })
    expect(await review.save(B, 'Por mi familia')).toEqual({ ok: true })
    expect(saveCalls().map(c => c.body)).toEqual([{ text: 'Por mi familia', verified: true }])
  })

  it('una petición que ya no está disponible avisa a la página con sus ids y la lectura sigue', async () => {
    const dropped: string[][] = []
    const review = usePrayerReview()
    const { off } = review.onUnavailable(ids => void dropped.push(ids))
    reads.set(A, fail(409, { code: 'request_unavailable', ids: [A] }))
    await open()
    off()
    expect(dropped).toEqual([[A]])
    expect(card(A)).toMatchObject({ status: 'failed', retryable: false })
    expect(readCalls()).toEqual([A, B, C])
  })

  it('cerrar deja de leer: la lectura en curso se descarta y las siguientes no empiezan; reabrir vuelve a cargar', async () => {
    hold(A)
    const review = await open()
    expect(readCalls()).toEqual([A])
    review.close()
    expect(review.phase.value).toBe('idle')
    await release(A)
    expect(readCalls()).toEqual([A])
    expect(card(A).status).toBe('reading')

    // Al reabrir, el servidor ya tiene el texto de la primera (su lectura terminó allá): no se lee de nuevo.
    stored = [transcript(A)]
    await open()
    expect(listQueries).toHaveLength(2)
    expect(statuses()).toEqual(['draft', 'draft', 'draft'])
    expect(readCalls()).toEqual([A, B, C])
  })

  it('reabrir con todo conocido muestra las tarjetas al instante mientras refresca', async () => {
    stored = [A, B, C].map(id => transcript(id))
    const review = await open()
    review.close()
    stored = [transcript(A, { status: 'verified' }), transcript(B), transcript(C)]
    const opening = review.open(REQUESTS)
    expect(review.phase.value).toBe('ready')
    expect(statuses()).toEqual(['draft', 'draft', 'draft'])
    await opening
    // Otra persona verificó la primera mientras tanto.
    expect(statuses()).toEqual(['verified', 'draft', 'draft'])
  })

  it('el plazo de una lectura vence: fallida por tiempo y reintentable', async () => {
    reads.set(A, fail(502, { code: 'provider' }))
    const review = await open([prayer(1)])
    // El reintento se queda esperando al servidor hasta que vence el plazo del navegador.
    hold(A)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    review.retry(A)
    await vi.advanceTimersByTimeAsync(PRAYER_TRANSCRIPT_TIMEOUT_MS + 1)
    vi.useRealTimers()
    await flush(5)
    expect(card(A)).toMatchObject({ status: 'failed', errorCode: 'timeout', retryable: true, error: 'La lectura tardó demasiado. Reintenta o escribe el texto a mano.' })
    await release(A)
  })

  it('escribir a mano mientras el modelo lee: lo que lea después no pisa la tarjeta', async () => {
    hold(A)
    const review = await open([prayer(1)])
    expect(card(A).status).toBe('reading')
    review.writeByHand(A)
    expect(card(A)).toMatchObject({ status: 'draft', text: '' })
    await release(A)
    expect(card(A)).toMatchObject({ status: 'draft', text: '' })
  })

  it('guardar: envía el texto como verificado, actualiza la tarjeta y avisa', async () => {
    stored = [transcript(A)]
    saves.set(A, () => transcript(A, { text: 'Por mi mamá', status: 'verified', origin: 'manual' }))
    const review = await open([prayer(1)])
    expect(await review.save(A, 'Por mi mamá')).toEqual({ ok: true })
    expect(saveCalls().map(c => c.body)).toEqual([{ text: 'Por mi mamá', verified: true }])
    expect(card(A)).toMatchObject({ status: 'verified', text: 'Por mi mamá' })
    expect(card(A).saving).toBeFalsy()
    expect(useToast().toasts.value.map(t => t.message)).toContain('Texto de Invitado 1 guardado y verificado')
    expect(review.allVerified.value).toBe(true)
  })

  it('guardar rechazado por el servidor: devuelve el mensaje del campo y la tarjeta no cambia', async () => {
    stored = [transcript(A)]
    saves.set(A, fail(422, { errors: { text: 'Debe tener como máximo 1000 caracteres' } }))
    const review = await open([prayer(1)])
    expect(await review.save(A, 'x')).toEqual({ ok: false, message: 'Debe tener como máximo 1000 caracteres' })
    expect(card(A)).toMatchObject({ status: 'draft', text: 'Texto de 1', saving: false })
  })

  it('guardar una petición que ya no está disponible avisa a la página', async () => {
    const dropped: string[][] = []
    stored = [transcript(A)]
    saves.set(A, fail(409, { code: 'request_unavailable', ids: [A] }))
    const review = await open([prayer(1)])
    const { off } = review.onUnavailable(ids => void dropped.push(ids))
    expect((await review.save(A, 'x')).ok).toBe(false)
    off()
    expect(dropped).toEqual([[A]])
  })

  it('la casilla: verifica el texto guardado sin cambiarlo y lo deja sin verificar al desmarcar', async () => {
    stored = [transcript(A)]
    const review = await open([prayer(1)])
    expect(await review.setVerified(A, true)).toBe(true)
    expect(card(A).status).toBe('verified')
    saves.set(A, () => transcript(A))
    expect(await review.setVerified(A, false)).toBe(true)
    expect(card(A).status).toBe('draft')
    expect(saveCalls().map(c => c.body)).toEqual([{ text: 'Texto de 1', verified: true }, { text: 'Texto de 1', verified: false }])
    expect(useToast().toasts.value.map(t => t.message)).toEqual(expect.arrayContaining(['Petición de Invitado 1 verificada', 'La petición de Invitado 1 quedó sin verificar']))
  })

  it('un texto vacío no se puede verificar: ni siquiera se pide', async () => {
    stored = [transcript(A, { text: '' })]
    const review = await open([prayer(1)])
    expect(await review.setVerified(A, true)).toBe(false)
    expect(saveCalls()).toEqual([])
  })

  it('si la verificación falla, la tarjeta no cambia y se avisa', async () => {
    stored = [transcript(A)]
    saves.set(A, fail(500))
    const review = await open([prayer(1)])
    expect(await review.setVerified(A, true)).toBe(false)
    expect(card(A)).toMatchObject({ status: 'draft', saving: false })
    expect(useToast().toasts.value.map(t => t.message)).toContain('No pudimos cambiar la verificación. Inténtalo de nuevo.')
  })

  it('volver a leer: pide la lectura con force y reemplaza el texto por un borrador', async () => {
    stored = [transcript(A, { status: 'verified', text: 'Texto viejo' })]
    reads.set(A, () => transcript(A, { text: 'Texto nuevo' }))
    const review = await open([prayer(1)])
    review.reread(A)
    await flush(8)
    expect(calls.filter(c => c.url.endsWith('/lectura')).map(c => c.body)).toEqual([{ force: true }])
    expect(card(A)).toMatchObject({ status: 'draft', text: 'Texto nuevo' })
    expect(card(A).force).toBeFalsy()
  })

  it('si volver a leer falla, la tarjeta vuelve a como estaba (el texto guardado sigue) y se avisa', async () => {
    stored = [transcript(A, { status: 'verified', text: 'Texto viejo' })]
    reads.set(A, fail(502, { code: 'provider' }))
    const review = await open([prayer(1)])
    review.reread(A)
    await flush(8)
    expect(card(A)).toMatchObject({ status: 'verified', text: 'Texto viejo', force: false })
    expect(useToast().toasts.value.map(t => t.message)).toContain('No pudimos leer esta foto. Reintenta o escribe el texto a mano.')
  })

  it('las acciones que no aplican al estado de la tarjeta no hacen nada', async () => {
    stored = [transcript(A, { status: 'verified' })]
    hold(B)
    const review = await open([prayer(1), prayer(2)])
    // Reintentar o escribir a mano una que ya tiene texto; volver a leer una que todavía se está leyendo.
    review.retry(A)
    review.writeByHand(A)
    review.reread(B)
    review.retry('desconocida')
    review.writeByHand('desconocida')
    review.reread('desconocida')
    expect(await review.setVerified('desconocida', true)).toBe(false)
    await flush()
    expect(statuses()).toEqual(['verified', 'reading'])
    expect(readCalls()).toEqual([B])
    expect(saveCalls()).toEqual([])
    await release(B)
  })

  it('sin crédito durante «Volver a leer»: la tarjeta vuelve a como estaba y las que esperaban quedan fallidas', async () => {
    stored = [transcript(A, { status: 'verified', text: 'Texto viejo' })]
    hold(B, fail(503, { code: 'quota_exceeded' }))
    const review = await open([prayer(1), prayer(2), prayer(3)])
    // La primera queda en fila para leerse de nuevo mientras la segunda sigue leyéndose.
    review.reread(A)
    await release(B)
    expect(review.halted.value).toBe('quota_exceeded')
    expect(card(A)).toMatchObject({ status: 'verified', text: 'Texto viejo', force: false })
    expect([card(B).status, card(C).status]).toEqual(['failed', 'failed'])
    expect(readCalls()).toEqual([B])
  })

  it('reintentar la carga solo aplica con el diálogo abierto', async () => {
    const review = usePrayerReview()
    await review.reload()
    expect(listQueries).toEqual([])
  })

  it('sync: una petición que sale de la selección deja de tener tarjeta', async () => {
    stored = [A, B, C].map(id => transcript(id))
    const review = await open()
    review.sync([prayer(1), prayer(3)])
    expect(review.cards.value.map(item => item.fileId)).toEqual([A, C])
  })

  it('el estado no se filtra entre pruebas', () => {
    expect(usePrayerReview().cards.value).toEqual([])
  })
})
