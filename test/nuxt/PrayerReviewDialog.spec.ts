// Diálogo de revisión del texto de las peticiones (revisión antes de generar): estados (cargando, error con reintento,
// contenido), tarjetas con su estado y su casilla, corregir y guardar, la casilla «Verificada», «Generar imágenes»
// deshabilitado con su motivo hasta que todo esté verificado, confirmación al descartar cambios, lecturas fallidas,
// la foto opcional («Ver imagen») y nombres accesibles.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import type { PrayerRequest, PrayerTranscript } from '#shared/types/api'
import PrayerReviewDialog from '~/components/prayers/PrayerReviewDialog.vue'
import { buttonsWithText, calls, flush, mockApi, resetCalls } from './helpers/api'
import { prayer } from './prayer-fixtures'

type Reply = (event: H3Event) => unknown

const REQUESTS = [prayer(1), prayer(2), prayer(3)]
const [A, B, C] = REQUESTS.map(request => request.id) as [string, string, string]

const transcript = (fileId: string, changes: Partial<PrayerTranscript> = {}): PrayerTranscript => ({
  fileId, text: `Texto de ${fileId.slice(-1)}`, status: 'draft', origin: 'model', verifiedAt: null, verifiedBy: null, updatedAt: '2026-11-17T10:00:00.000Z',
  ...changes,
})
const verified = (fileId: string, text = `Texto de ${fileId.slice(-1)}`) => transcript(fileId, { status: 'verified', text })
const fail = (status: number, data?: Record<string, unknown>): Reply => (event) => {
  setResponseStatus(event, status)
  return { statusCode: status, message: 'x', ...(data ? { data } : {}) }
}

let stored: PrayerTranscript[] = []
let listReply: Reply | null = null
const reads = new Map<string, Reply>()
const saves = new Map<string, Reply>()
let gate: (() => void) | null = null

const saveBodies = () => calls.filter(c => c.method === 'PATCH').map(c => c.body)
const readBodies = () => calls.filter(c => c.url.endsWith('/lectura')).map(c => c.body)

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof PrayerReviewDialog>>>

async function mount(requests: PrayerRequest[] = REQUESTS, props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(PrayerReviewDialog, { props: { requests, ...props }, attachTo: document.body })
  await flush(8)
  return wrapper
}

const generateButton = (wrapper: Wrapper) => buttonsWithText(wrapper, 'Generar imágenes')[0]!
const reason = (wrapper: Wrapper) => wrapper.get('footer [role="status"]').text()
const cardButton = (wrapper: Wrapper, n: number) => wrapper.findAll('ul[aria-label="Peticiones elegidas"] > li > button')[n - 1]!
const box = (wrapper: Wrapper, n: number) => wrapper.get(`input[aria-label="Verificada: petición de Invitado ${n}"]`)
const isChecked = (wrapper: Wrapper, n: number) => (box(wrapper, n).element as HTMLInputElement).checked
const textarea = (wrapper: Wrapper) => wrapper.get('textarea')
const text = (wrapper: Wrapper) => (textarea(wrapper).element as HTMLTextAreaElement).value
/** El botón que muestra u oculta la foto («Ver imagen» / «Ocultar imagen»). */
const photoToggle = (wrapper: Wrapper) => wrapper.get('section button[aria-controls]')
/** El panel de la foto, el que nombra `aria-controls` del botón. */
const photoPanel = (wrapper: Wrapper) => wrapper.get(`[id="${photoToggle(wrapper).attributes('aria-controls')}"]`)

enableAutoUnmount(afterEach)

beforeEach(() => {
  resetCalls()
  stored = []
  listReply = null
  gate = null
  reads.clear()
  saves.clear()
  usePrayerReview().close()
  useState('prayer-review').value = {}
  useState('prayer-review-requests').value = []
  useToast().toasts.value = []
  mockApi('GET', '/api/peticiones/transcripciones', (event: H3Event) => (listReply ? listReply(event) : stored))
  for (const id of [A, B, C]) {
    mockApi('POST', `/api/peticiones/transcripciones/${id}/lectura`, (event: H3Event) => (reads.get(id) ?? (() => transcript(id)))(event))
    mockApi('PATCH', `/api/peticiones/transcripciones/${id}`, async (event: H3Event) => {
      const reply = saves.get(id)
      if (reply) return reply(event)
      const body = calls.at(-1)!.body as { text: string, verified: boolean }
      return transcript(id, { text: body.text, status: body.verified ? 'verified' : 'draft', origin: 'manual' })
    })
  }
})

describe('PrayerReviewDialog', () => {
  describe('estados', () => {
    it('cargando: avisa que carga los textos y no deja generar', async () => {
      listReply = async () => {
        await new Promise<void>(resolve => (gate = resolve))
        return [A, B, C].map(id => verified(id))
      }
      const wrapper = await mount()
      expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Cargando los textos guardados…')
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(generateButton(wrapper).attributes('disabled')).toBeDefined()
      expect(reason(wrapper)).toBe('Espera a que carguen los textos para generar.')
      gate!()
      await flush(8)
      expect(wrapper.find('textarea').exists()).toBe(true)
    })

    it('si no se pueden cargar: error con Reintentar, sin generar; reintentar muestra las peticiones', async () => {
      listReply = fail(500)
      const wrapper = await mount()
      expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar los textos guardados.')
      expect(generateButton(wrapper).attributes('disabled')).toBeDefined()
      expect(reason(wrapper)).toBe('No se puede generar hasta cargar los textos guardados.')
      listReply = null
      stored = [A, B, C].map(id => transcript(id))
      await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
      await flush(8)
      expect(wrapper.findAll('ul[aria-label="Peticiones elegidas"] > li')).toHaveLength(3)
    })

    it('contenido: una tarjeta por petición en el orden recibido, con nombre accesible, estado y casilla; la primera queda activa con su foto y su texto', async () => {
      stored = [transcript(A), verified(B), transcript(C, { text: '' })]
      const wrapper = await mount()
      expect(wrapper.get('dialog').attributes('aria-labelledby')).toBe(wrapper.get('h2').attributes('id'))
      expect(wrapper.get('h2').text()).toBe('Revisa el texto de las peticiones')
      expect(wrapper.findAll('ul[aria-label="Peticiones elegidas"] > li > button').map(b => b.attributes('aria-label'))).toEqual([
        'Petición de Invitado 1: sin verificar',
        'Petición de Invitado 2: verificada',
        'Petición de Invitado 3: sin texto en la foto',
      ])
      expect([1, 2, 3].map(n => isChecked(wrapper, n))).toEqual([false, true, false])
      // Sin texto que verificar, la casilla no sirve.
      expect(box(wrapper, 3).attributes('disabled')).toBeDefined()
      expect(cardButton(wrapper, 1).attributes('aria-current')).toBe('true')
      // La foto está en su panel, oculto al abrir.
      expect(photoPanel(wrapper).get(`img[alt="Foto de la petición de Invitado 1"]`).attributes('src')).toBe(prayer(1).previewUrl)
      expect(photoPanel(wrapper).attributes('inert')).toBeDefined()
      expect(text(wrapper)).toBe('Texto de 1')
      // El área de texto tiene etiqueta.
      expect(wrapper.get(`label[for="${textarea(wrapper).attributes('id')}"]`).text()).toBe('Texto de la petición')
      expect(wrapper.text()).toContain('10 de 1000 caracteres')
    })

    it('elegir una tarjeta muestra su foto y su texto', async () => {
      stored = [transcript(A), transcript(B, { text: 'Por mi trabajo' })]
      const wrapper = await mount([prayer(1), prayer(2)])
      await photoToggle(wrapper).trigger('click')
      await cardButton(wrapper, 2).trigger('click')
      await flush()
      expect(cardButton(wrapper, 2).attributes('aria-current')).toBe('true')
      expect(cardButton(wrapper, 1).attributes('aria-current')).toBeUndefined()
      expect(photoPanel(wrapper).find(`img[alt="Foto de la petición de Invitado 2"]`).exists()).toBe(true)
      expect(text(wrapper)).toBe('Por mi trabajo')
    })

    it('mientras se lee una foto, su tarjeta lo dice y se puede revisar otra ya lista', async () => {
      stored = [transcript(A)]
      reads.set(B, async () => {
        await new Promise<void>(resolve => (gate = resolve))
        return transcript(B, { text: 'Recién leída' })
      })
      const wrapper = await mount([prayer(1), prayer(2)])
      expect(cardButton(wrapper, 2).attributes('aria-label')).toBe('Petición de Invitado 2: leyendo la foto')
      // La primera ya se puede editar y verificar sin esperar.
      await textarea(wrapper).setValue('Por mi familia')
      await wrapper.get('form').trigger('submit')
      await flush(8)
      expect(isChecked(wrapper, 1)).toBe(true)
      expect(text(wrapper)).toBe('Por mi familia')
      gate!()
      await flush(8)
      expect(cardButton(wrapper, 2).attributes('aria-label')).toBe('Petición de Invitado 2: sin verificar')
      expect(wrapper.get('p[aria-live="polite"]').text()).toBe('Texto de la petición de Invitado 2 listo para revisar')
      // Lo que llegó de la segunda no tocó el editor de la primera.
      expect(text(wrapper)).toBe('Por mi familia')
    })

    it('un texto largo avisa que puede no caber, sin impedir guardarlo', async () => {
      stored = [transcript(A, { text: 'a'.repeat(601) })]
      const wrapper = await mount([prayer(1)])
      expect(wrapper.text()).toContain('Es un texto largo: puede que no quepa completo en la imagen.')
      await wrapper.get('form').trigger('submit')
      await flush(8)
      expect(saveBodies()).toEqual([{ text: 'a'.repeat(601), verified: true }])
    })
  })

  describe('foto opcional', () => {
    it('al abrir la foto está oculta: «Ver imagen» no expandido y el panel fuera del teclado y del lector de pantalla', async () => {
      stored = [transcript(A)]
      const wrapper = await mount([prayer(1)])
      const toggle = photoToggle(wrapper)
      expect(toggle.text()).toBe('Ver imagen')
      expect(toggle.attributes('type')).toBe('button')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(photoPanel(wrapper).attributes('inert')).toBeDefined()
      expect(photoPanel(wrapper).attributes('aria-hidden')).toBe('true')
      // «Abrir foto» está dentro del panel inerte: no se alcanza con Tab.
      expect(photoPanel(wrapper).find('a').text()).toBe('Abrir foto')
      // Sin la foto, el texto ocupa el espacio: llena el alto disponible en vez de un número fijo de filas.
      expect(textarea(wrapper).attributes('rows')).toBeUndefined()
      expect(textarea(wrapper).classes()).toContain('flex-1')
      // «Ver imagen» va junto a «Guardar y verificar» y «Volver a leer».
      expect(wrapper.get('form').findAll('button').map(b => b.text())).toEqual(['Guardar y verificar', 'Volver a leer', 'Ver imagen'])
    })

    it('«Ver imagen» la muestra («Ocultar imagen», expandido, «Abrir foto» alcanzable) y «Ocultar imagen» la vuelve a ocultar', async () => {
      stored = [transcript(A)]
      const wrapper = await mount([prayer(1)])
      await photoToggle(wrapper).trigger('click')
      expect(photoToggle(wrapper).text()).toBe('Ocultar imagen')
      expect(photoToggle(wrapper).attributes('aria-expanded')).toBe('true')
      expect(photoPanel(wrapper).attributes('inert')).toBeUndefined()
      expect(photoPanel(wrapper).attributes('aria-hidden')).toBeUndefined()
      expect(photoPanel(wrapper).get('img').attributes('alt')).toBe('Foto de la petición de Invitado 1')
      expect(photoPanel(wrapper).get('a').attributes('href')).toBe(prayer(1).previewUrl)
      // Mostrar la foto no toca el texto ni lo deja con cambios.
      expect(text(wrapper)).toBe('Texto de 1')
      expect(cardButton(wrapper, 1).attributes('aria-label')).toBe('Petición de Invitado 1: sin verificar')

      await photoToggle(wrapper).trigger('click')
      expect(photoToggle(wrapper).text()).toBe('Ver imagen')
      expect(photoToggle(wrapper).attributes('aria-expanded')).toBe('false')
      expect(photoPanel(wrapper).attributes('inert')).toBeDefined()
    })

    it('mostrar u ocultar la foto vale para todo el diálogo: se conserva al cambiar de tarjeta', async () => {
      stored = [transcript(A), transcript(B)]
      const wrapper = await mount([prayer(1), prayer(2)])
      await photoToggle(wrapper).trigger('click')
      await cardButton(wrapper, 2).trigger('click')
      await flush()
      expect(photoToggle(wrapper).attributes('aria-expanded')).toBe('true')
      expect(photoPanel(wrapper).attributes('inert')).toBeUndefined()
      expect(photoPanel(wrapper).get('img').attributes('alt')).toBe('Foto de la petición de Invitado 2')

      await photoToggle(wrapper).trigger('click')
      await cardButton(wrapper, 1).trigger('click')
      await flush()
      expect(photoToggle(wrapper).attributes('aria-expanded')).toBe('false')
      expect(photoPanel(wrapper).attributes('inert')).toBeDefined()
    })

    it('mientras la foto espera o se lee también se puede ver, para escribirla a mano', async () => {
      reads.set(A, () => new Promise(() => {}))
      const wrapper = await mount([prayer(1), prayer(2)])
      expect(wrapper.text()).toContain('Leyendo la foto…')
      expect(buttonsWithText(wrapper, 'Ver imagen')).toHaveLength(1)
      await photoToggle(wrapper).trigger('click')
      expect(photoToggle(wrapper).attributes('aria-expanded')).toBe('true')
      expect(photoPanel(wrapper).attributes('inert')).toBeUndefined()

      await cardButton(wrapper, 2).trigger('click')
      await flush()
      expect(wrapper.text()).toContain('En espera:')
      expect(photoToggle(wrapper).text()).toBe('Ocultar imagen')
      expect(photoPanel(wrapper).get('img').attributes('alt')).toBe('Foto de la petición de Invitado 2')
    })

    it('con la lectura fallida también se puede ver la foto', async () => {
      reads.set(A, fail(422, { code: 'unreadable_image', ids: [A] }))
      const wrapper = await mount([prayer(1)])
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(buttonsWithText(wrapper, 'Ver imagen')).toHaveLength(1)
      await photoToggle(wrapper).trigger('click')
      expect(photoToggle(wrapper).attributes('aria-expanded')).toBe('true')
      expect(photoPanel(wrapper).attributes('aria-hidden')).toBeUndefined()
      // Al escribir a mano, la foto sigue a la vista.
      await buttonsWithText(wrapper, 'Escribir a mano')[0]!.trigger('click')
      await flush()
      expect(wrapper.find('textarea').exists()).toBe(true)
      expect(photoToggle(wrapper).attributes('aria-expanded')).toBe('true')
    })
  })

  describe('generar', () => {
    it('con peticiones sin verificar el botón está deshabilitado y dice cuántas faltan', async () => {
      stored = [verified(A), transcript(B), transcript(C)]
      const wrapper = await mount()
      const button = generateButton(wrapper)
      expect(button.attributes('disabled')).toBeDefined()
      expect(reason(wrapper)).toBe('1 de 3 verificada. Falta verificar 2 peticiones para generar.')
      expect(button.attributes('aria-describedby')).toBe(wrapper.get('footer [role="status"]').attributes('id'))
      await button.trigger('click')
      expect(wrapper.emitted('generate')).toBeUndefined()
    })

    it('con todas verificadas se habilita, dice cuántas imágenes saldrán y emite generate', async () => {
      stored = [A, B, C].map(id => verified(id))
      const wrapper = await mount()
      expect(reason(wrapper)).toBe('3 de 3 verificadas. Todo verificado: saldrá 1 imagen.')
      expect(generateButton(wrapper).attributes('disabled')).toBeUndefined()
      await generateButton(wrapper).trigger('click')
      expect(wrapper.emitted('generate')).toHaveLength(1)
    })

    it('marcar la casilla de la última pendiente verifica su texto tal cual y habilita generar', async () => {
      stored = [verified(A), transcript(B)]
      const wrapper = await mount([prayer(1), prayer(2)])
      expect(reason(wrapper)).toContain('Falta verificar 1 petición para generar.')
      await box(wrapper, 2).setValue(true)
      await flush(8)
      expect(saveBodies()).toEqual([{ text: 'Texto de 2', verified: true }])
      expect(isChecked(wrapper, 2)).toBe(true)
      expect(generateButton(wrapper).attributes('disabled')).toBeUndefined()
      expect(useToast().toasts.value.map(t => t.message)).toContain('Petición de Invitado 2 verificada')
    })

    it('desmarcar la casilla deja la petición sin verificar y vuelve a deshabilitar generar', async () => {
      stored = [verified(A)]
      const wrapper = await mount([prayer(1)])
      await box(wrapper, 1).setValue(false)
      await flush(8)
      expect(saveBodies()).toEqual([{ text: 'Texto de 1', verified: false }])
      expect(isChecked(wrapper, 1)).toBe(false)
      expect(generateButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('mientras la página crea la generación el botón queda ocupado', async () => {
      stored = [verified(A)]
      const wrapper = await mount([prayer(1)], { busy: true })
      expect(generateButton(wrapper).attributes('disabled')).toBeDefined()
      expect(generateButton(wrapper).attributes('aria-busy')).toBe('true')
    })
  })

  describe('corregir y verificar', () => {
    it('«Guardar y verificar» guarda el texto corregido (recortado) y marca la tarjeta', async () => {
      stored = [transcript(A)]
      const wrapper = await mount([prayer(1)])
      await textarea(wrapper).setValue('  Por mi mamá\ny mi abuela  ')
      await wrapper.get('form').trigger('submit')
      await flush(8)
      expect(saveBodies()).toEqual([{ text: 'Por mi mamá\ny mi abuela', verified: true }])
      expect(isChecked(wrapper, 1)).toBe(true)
      expect(cardButton(wrapper, 1).attributes('aria-label')).toBe('Petición de Invitado 1: verificada')
      expect(text(wrapper)).toBe('Por mi mamá\ny mi abuela')
      expect(wrapper.get('p[aria-live="polite"]').text()).toBe('Texto de Invitado 1 guardado y verificado')
    })

    it('editar una verificada la deja sin verificar hasta guardarla: la tarjeta lo dice y no se puede generar', async () => {
      stored = [verified(A)]
      const wrapper = await mount([prayer(1)])
      expect(generateButton(wrapper).attributes('disabled')).toBeUndefined()
      await textarea(wrapper).setValue('Texto de 1 corregido')
      expect(isChecked(wrapper, 1)).toBe(false)
      expect(cardButton(wrapper, 1).attributes('aria-label')).toBe('Petición de Invitado 1: con cambios sin guardar')
      expect(generateButton(wrapper).attributes('disabled')).toBeDefined()
      expect(reason(wrapper)).toContain('Guarda o descarta los cambios de esta petición para generar.')
      // Marcarla de nuevo como verificada guarda lo que se ve.
      await box(wrapper, 1).setValue(true)
      await flush(8)
      expect(saveBodies()).toEqual([{ text: 'Texto de 1 corregido', verified: true }])
      expect(generateButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('un texto vacío o en blanco no se guarda: el campo dice qué falta', async () => {
      stored = [transcript(A)]
      const wrapper = await mount([prayer(1)])
      await textarea(wrapper).setValue('   ')
      await wrapper.get('form').trigger('submit')
      await flush()
      expect(saveBodies()).toEqual([])
      expect(textarea(wrapper).attributes('aria-invalid')).toBe('true')
      const error = wrapper.get('p.text-error')
      expect(error.text()).toBe('Escribe el texto de la petición para marcarla como verificada')
      expect(textarea(wrapper).attributes('aria-describedby')).toContain(error.attributes('id'))
    })

    it('un texto más largo que el máximo muestra el límite sin enviarlo', async () => {
      stored = [transcript(A)]
      const wrapper = await mount([prayer(1)])
      await textarea(wrapper).setValue('a'.repeat(1001))
      await wrapper.get('form').trigger('submit')
      await flush()
      expect(saveBodies()).toEqual([])
      expect(wrapper.get('p.text-error').text()).toBe('Debe tener como máximo 1000 caracteres')
      expect(wrapper.text()).toContain('1001 de 1000 caracteres')
    })

    it('si el servidor rechaza el texto, su mensaje aparece en el campo y lo escrito se conserva', async () => {
      stored = [transcript(A)]
      saves.set(A, fail(422, { errors: { text: 'Debe tener como máximo 1000 caracteres' } }))
      const wrapper = await mount([prayer(1)])
      await textarea(wrapper).setValue('Por mi hermano')
      await wrapper.get('form').trigger('submit')
      await flush(8)
      expect(wrapper.get('p.text-error').text()).toBe('Debe tener como máximo 1000 caracteres')
      expect(text(wrapper)).toBe('Por mi hermano')
      expect(isChecked(wrapper, 1)).toBe(false)
    })

    it('una foto sin texto: lo dice, deja el área en blanco y se puede escribir a mano', async () => {
      reads.set(A, () => transcript(A, { text: '' }))
      const wrapper = await mount([prayer(1)])
      expect(wrapper.text()).toContain('No encontramos texto en esta foto. Si lo tiene, escríbelo a mano.')
      expect(text(wrapper)).toBe('')
      await textarea(wrapper).setValue('Por mi vecina')
      await wrapper.get('form').trigger('submit')
      await flush(8)
      expect(saveBodies()).toEqual([{ text: 'Por mi vecina', verified: true }])
      expect(isChecked(wrapper, 1)).toBe(true)
    })

    it('«Volver a leer» pide confirmación y, al aceptar, lee de nuevo con force', async () => {
      stored = [verified(A, 'Texto viejo')]
      reads.set(A, () => transcript(A, { text: 'Texto nuevo' }))
      const wrapper = await mount([prayer(1)])
      await buttonsWithText(wrapper, 'Volver a leer')[0]!.trigger('click')
      await flush()
      expect(useConfirm().options.value).toMatchObject({ title: '¿Volver a leer la foto?', confirmLabel: 'Volver a leer' })
      useConfirm().cancel()
      await flush()
      expect(readBodies()).toEqual([])

      await buttonsWithText(wrapper, 'Volver a leer')[0]!.trigger('click')
      await flush()
      useConfirm().accept()
      await flush(8)
      expect(readBodies()).toEqual([{ force: true }])
      expect(text(wrapper)).toBe('Texto nuevo')
      expect(isChecked(wrapper, 1)).toBe(false)
    })
  })

  describe('cambios sin guardar', () => {
    it('cambiar de tarjeta con cambios pide confirmación: cancelar se queda, aceptar los descarta', async () => {
      stored = [transcript(A), transcript(B)]
      const wrapper = await mount([prayer(1), prayer(2)])
      await textarea(wrapper).setValue('A medias')
      await cardButton(wrapper, 2).trigger('click')
      await flush()
      expect(useConfirm().options.value).toMatchObject({ title: '¿Descartar los cambios?', confirmLabel: 'Descartar cambios', danger: true })
      useConfirm().cancel()
      await flush()
      expect(cardButton(wrapper, 1).attributes('aria-current')).toBe('true')
      expect(text(wrapper)).toBe('A medias')

      await cardButton(wrapper, 2).trigger('click')
      await flush()
      useConfirm().accept()
      await flush()
      expect(cardButton(wrapper, 2).attributes('aria-current')).toBe('true')
      expect(text(wrapper)).toBe('Texto de 2')
      // Al volver, la primera muestra su texto guardado.
      await cardButton(wrapper, 1).trigger('click')
      await flush()
      expect(text(wrapper)).toBe('Texto de 1')
      expect(saveBodies()).toEqual([])
    })

    it('cerrar sin cambios emite close; con cambios pregunta antes (también con Escape)', async () => {
      stored = [transcript(A)]
      const wrapper = await mount([prayer(1)])
      await textarea(wrapper).setValue('A medias')
      await wrapper.get('dialog').trigger('cancel')
      await flush()
      expect(useConfirm().options.value?.title).toBe('¿Descartar los cambios?')
      useConfirm().cancel()
      await flush()
      expect(wrapper.emitted('close')).toBeUndefined()

      await wrapper.get('button[aria-label="Cerrar"]').trigger('click')
      await flush()
      useConfirm().accept()
      await flush()
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('Escape sin cambios cierra sin preguntar', async () => {
      stored = [transcript(A)]
      const wrapper = await mount([prayer(1)])
      await wrapper.get('dialog').trigger('cancel')
      await flush()
      expect(useConfirm().options.value).toBeNull()
      expect(wrapper.emitted('close')).toHaveLength(1)
    })
  })

  describe('lecturas que fallan', () => {
    it('fallo pasajero: mensaje, «Reintentar» y «Escribir a mano»; las demás peticiones se leen', async () => {
      reads.set(A, fail(502, { code: 'provider' }))
      const wrapper = await mount([prayer(1), prayer(2)])
      expect(cardButton(wrapper, 1).attributes('aria-label')).toBe('Petición de Invitado 1: no se pudo leer')
      expect(cardButton(wrapper, 2).attributes('aria-label')).toBe('Petición de Invitado 2: sin verificar')
      expect(wrapper.get('section [role="alert"]').text()).toBe('No pudimos leer esta foto. Reintenta o escribe el texto a mano.')
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(box(wrapper, 1).attributes('disabled')).toBeDefined()
      expect(buttonsWithText(wrapper, 'Quitar de la selección')).toHaveLength(0)

      reads.delete(A)
      await buttonsWithText(wrapper, 'Reintentar')[0]!.trigger('click')
      await flush(8)
      expect(text(wrapper)).toBe('Texto de 1')
    })

    it('«Escribir a mano» abre el área de texto en blanco y guardar la verifica', async () => {
      reads.set(A, fail(502, { code: 'provider' }))
      const wrapper = await mount([prayer(1)])
      await buttonsWithText(wrapper, 'Escribir a mano')[0]!.trigger('click')
      await flush()
      expect(text(wrapper)).toBe('')
      expect(document.activeElement).toBe(textarea(wrapper).element)
      await textarea(wrapper).setValue('Por mi salud')
      await wrapper.get('form').trigger('submit')
      await flush(8)
      expect(saveBodies()).toEqual([{ text: 'Por mi salud', verified: true }])
      expect(generateButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('una foto que no se puede leer no ofrece «Reintentar»: escribir a mano o quitarla de la selección', async () => {
      reads.set(A, fail(422, { code: 'unreadable_image', ids: [A] }))
      const wrapper = await mount([prayer(1), prayer(2)])
      expect(wrapper.get('section [role="alert"]').text()).toBe('Esta foto no se puede leer automáticamente. Escribe el texto a mano o quítala de la selección.')
      expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(0)
      expect(buttonsWithText(wrapper, 'Escribir a mano')).toHaveLength(1)
      await buttonsWithText(wrapper, 'Quitar de la selección')[0]!.trigger('click')
      expect(wrapper.emitted('remove')).toEqual([[A]])
      // La página la quita de la selección: su tarjeta sale y la siguiente queda activa.
      await wrapper.setProps({ requests: [prayer(2)] })
      await flush()
      expect(wrapper.findAll('ul[aria-label="Peticiones elegidas"] > li')).toHaveLength(1)
      expect(cardButton(wrapper, 1).attributes('aria-current')).toBe('true')
      expect(text(wrapper)).toBe('Texto de 2')
    })

    it.each([
      ['quota_exceeded', 'Se agotó el crédito del servicio de lectura. Avisa a un administrador; mientras tanto puedes escribir cada texto a mano.'],
      ['not_configured', 'La lectura de fotos no está configurada. Avisa a un administrador; mientras tanto puedes escribir cada texto a mano.'],
    ])('%s: avisa que hace falta un administrador, deja de leer y permite escribir a mano', async (code, banner) => {
      reads.set(A, fail(503, { code }))
      const wrapper = await mount()
      expect(wrapper.findAll('section [role="alert"]')[0]!.text()).toBe(banner)
      expect(readBodies()).toHaveLength(1)
      expect(buttonsWithText(wrapper, 'Reintentar')).toHaveLength(0)
      expect([1, 2, 3].map(n => cardButton(wrapper, n).attributes('aria-label'))).toEqual([
        'Petición de Invitado 1: no se pudo leer', 'Petición de Invitado 2: no se pudo leer', 'Petición de Invitado 3: no se pudo leer',
      ])
      await buttonsWithText(wrapper, 'Escribir a mano')[0]!.trigger('click')
      await flush()
      expect(wrapper.find('textarea').exists()).toBe(true)
    })

    it('mientras una foto espera o se lee también se puede escribir a mano', async () => {
      reads.set(A, () => new Promise(() => {}))
      const wrapper = await mount([prayer(1), prayer(2)])
      expect(wrapper.text()).toContain('Leyendo la foto… suele tardar unos segundos.')
      await cardButton(wrapper, 2).trigger('click')
      await flush()
      expect(wrapper.text()).toContain('En espera: la foto se lee en cuanto terminen las anteriores.')
      await buttonsWithText(wrapper, 'Escribir a mano')[0]!.trigger('click')
      await flush()
      expect(text(wrapper)).toBe('')
      expect(cardButton(wrapper, 2).attributes('aria-label')).toBe('Petición de Invitado 2: sin verificar')
    })
  })

  it('desmontar el diálogo deja de leer', async () => {
    reads.set(A, () => new Promise(() => {}))
    const wrapper = await mount([prayer(1), prayer(2)])
    expect(usePrayerReview().phase.value).toBe('ready')
    wrapper.unmount()
    expect(usePrayerReview().phase.value).toBe('idle')
    await flush(8)
    expect(readBodies()).toHaveLength(1)
  })

  it('los controles táctiles miden al menos 44 px: sin btn-sm ni btn-xs como tamaño base', async () => {
    stored = [transcript(A)]
    const wrapper = await mount([prayer(1)])
    for (const el of wrapper.findAll('.btn')) expect(el.classes().some(c => c === 'btn-sm' || c === 'btn-xs'), el.html()).toBe(false)
    expect(wrapper.get('ul[aria-label="Peticiones elegidas"] label').classes()).toContain('size-11')
    expect(cardButton(wrapper, 1).classes()).toContain('min-h-14')
  })
})
