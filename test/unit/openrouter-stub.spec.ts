// El stub de OpenRouter de los e2e (`test/e2e/setup/openrouter-stub.ts`): reconoce la lectura y la generación por su
// preset, registra lo que llegó, aplica cada escenario y rechaza cualquier otra llamada.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { StubCalls, StubMode } from '../e2e/setup/openrouter-stub'
import { PRAYER_PRESET, startAiStub, TRANSCRIPT_PRESET } from '../e2e/setup/openrouter-stub'

let stub: Awaited<ReturnType<typeof startAiStub>>

const post = (path: string, body: unknown) =>
  fetch(`${stub.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const setMode = (mode: Partial<StubMode>) => post('/__stub/mode', mode)
const calls = async () => await (await fetch(`${stub.url}/__stub/calls`)).json() as StubCalls

const PHOTO_A = 'https://bucket.test/b/guest/s1/aaa?X-Amz-Signature=f00'
const PHOTO_B = 'https://bucket.test/b/guest/s1/bbb?X-Amz-Signature=f00'

const read = (photo = PHOTO_A) => post('/chat/completions', {
  model: TRANSCRIPT_PRESET,
  response_format: { type: 'json_schema', json_schema: { name: 'response', schema: {} } },
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Transcribe el texto' }, { type: 'image_url', image_url: { url: photo } }] }],
})

const generate = (texts: string[], photos: string[] = []) => post('/chat/completions', {
  model: PRAYER_PRESET,
  modalities: ['image', 'text'],
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Escribe cada texto en la plantilla' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/' } },
      ...texts.map(text => ({ type: 'text', text: `<peticion>\n${text}\n</peticion>` })),
      ...photos.map(url => ({ type: 'image_url', image_url: { url } })),
    ],
  }],
})

const output = async (response: Response) =>
  JSON.parse((await response.json() as { choices: { message: { content: string } }[] }).choices[0]!.message.content) as { hasText: boolean, text: string }

beforeAll(async () => {
  stub = await startAiStub()
})

afterAll(() => stub.close())

beforeEach(() => post('/__stub/reset', {}))

describe('lectura (preset de transcripción)', () => {
  it('responde el JSON de la salida estructurada, numera las lecturas y las registra sin descargar la foto', async () => {
    expect(await output(await read(PHOTO_A))).toEqual({ hasText: true, text: 'Texto leído 1' })
    expect(await output(await read(PHOTO_B))).toEqual({ hasText: true, text: 'Texto leído 2' })
    expect((await calls()).transcript).toEqual([
      { model: TRANSCRIPT_PRESET, photo: PHOTO_A, images: 1, structured: true, prompt: 'Transcribe el texto', text: 'Texto leído 1', status: 200 },
      { model: TRANSCRIPT_PRESET, photo: PHOTO_B, images: 1, structured: true, prompt: 'Transcribe el texto', text: 'Texto leído 2', status: 200 },
    ])
    expect((await calls()).prayer).toEqual([])
  })

  it('transcriptText fija el texto leído', async () => {
    await setMode({ transcriptText: 'Por mi familia\ny mi trabajo' })
    expect(await output(await read())).toEqual({ hasText: true, text: 'Por mi familia\ny mi trabajo' })
  })

  it('sin-texto: dice que la foto no tiene texto legible', async () => {
    await setMode({ scenario: 'sin-texto' })
    expect(await output(await read())).toEqual({ hasText: false, text: '' })
    expect((await calls()).transcript[0]).toMatchObject({ status: 200, text: null })
  })

  it.each([
    ['lectura-falla', 500],
    ['sin-credito', 402],
    ['clave-rechazada', 401],
  ] as const)('%s → %i', async (scenario, status) => {
    await setMode({ scenario })
    expect((await read()).status).toBe(status)
    expect((await read()).status).toBe(status)
    expect((await calls()).transcript.map(call => call.status)).toEqual([status, status])
  })

  it('match limita el escenario a las fotos cuya URL lo contiene', async () => {
    await setMode({ scenario: 'lectura-falla', match: '/bbb' })
    expect((await read(PHOTO_A)).status).toBe(200)
    expect((await read(PHOTO_B)).status).toBe(500)
  })

  it('transcriptDelayMs retrasa la respuesta', async () => {
    await setMode({ transcriptDelayMs: 60 })
    const start = Date.now()
    await read()
    expect(Date.now() - start).toBeGreaterThanOrEqual(50)
  })

  it('los escenarios solo de generación no afectan a la lectura', async () => {
    for (const scenario of ['sin-imagen', 'falla-una-vez', 'lento'] as const) {
      await setMode({ scenario, prayerDelayMs: 5000 })
      expect((await read()).status, scenario).toBe(200)
    }
  })
})

describe('generación (preset de imágenes)', () => {
  it('responde una imagen y registra la plantilla, los textos en orden y ninguna foto', async () => {
    const response = await generate(['Por mi mamá\ny mi abuela', 'Por mi trabajo'])
    const body = await response.json() as { choices: { message: { images: { image_url: { url: string } }[] } }[] }
    expect(body.choices[0]!.message.images[0]!.image_url.url).toMatch(/^data:image\/png;base64,/)
    expect((await calls()).prayer).toEqual([{
      model: PRAYER_PRESET,
      modalities: ['image', 'text'],
      template: true,
      photos: [],
      texts: ['Por mi mamá\ny mi abuela', 'Por mi trabajo'],
      prompt: 'Escribe cada texto en la plantilla\n<peticion>\nPor mi mamá\ny mi abuela\n</peticion>\n<peticion>\nPor mi trabajo\n</peticion>',
      status: 200,
    }])
    expect((await calls()).transcript).toEqual([])
  })

  it('una foto que se colara después de la plantilla queda registrada (para que la prueba falle)', async () => {
    await generate(['Hola'], [PHOTO_A])
    expect((await calls()).prayer[0]!.photos).toEqual([PHOTO_A])
  })

  it('se reconoce también por modalities con image, aunque el modelo sea otro', async () => {
    const response = await post('/chat/completions', { model: 'otro', modalities: ['image'], messages: [{ role: 'user', content: 'Hola' }] })
    expect(response.status).toBe(200)
    expect((await calls()).prayer[0]).toMatchObject({ model: 'otro', template: false, texts: [], prompt: 'Hola' })
  })

  it('sin-imagen: responde sin images', async () => {
    await setMode({ scenario: 'sin-imagen' })
    const body = await (await generate(['Hola'])).json() as { choices: { message: { images?: unknown } }[] }
    expect(body.choices[0]!.message.images).toBeUndefined()
  })

  it.each([['sin-credito', 402], ['clave-rechazada', 401]] as const)('%s → %i', async (scenario, status) => {
    await setMode({ scenario })
    expect((await generate(['Hola'])).status).toBe(status)
  })

  it('falla-una-vez: 500 en las dos primeras llamadas afectadas y luego responde bien; fijar el modo reinicia la cuenta', async () => {
    await setMode({ scenario: 'falla-una-vez' })
    expect([(await generate(['Hola'])).status, (await generate(['Hola'])).status, (await generate(['Hola'])).status]).toEqual([500, 500, 200])
    await setMode({ scenario: 'falla-una-vez' })
    expect((await generate(['Hola'])).status).toBe(500)
  })

  it('lento: espera prayerDelayMs', async () => {
    await setMode({ scenario: 'lento', prayerDelayMs: 60 })
    const start = Date.now()
    await generate(['Hola'])
    expect(Date.now() - start).toBeGreaterThanOrEqual(50)
  })

  it('match limita el escenario a las generaciones que llevan ese texto', async () => {
    await setMode({ scenario: 'sin-credito', match: 'trabajo' })
    expect((await generate(['Por mi familia'])).status).toBe(200)
    expect((await generate(['Por mi familia', 'Por mi trabajo'])).status).toBe(402)
  })

  it('los escenarios solo de lectura no afectan a la generación', async () => {
    for (const scenario of ['sin-texto', 'lectura-falla'] as const) {
      await setMode({ scenario })
      expect((await generate(['Hola'])).status, scenario).toBe(200)
    }
  })
})

describe('lo demás', () => {
  it.each([
    ['otro modelo sin modalities de imagen', { model: 'openai/gpt', messages: [{ role: 'user', content: 'Hola' }] }],
    ['sin modelo', { messages: [] }],
  ])('%s → 400 y no se registra', async (_, body) => {
    expect((await post('/chat/completions', body)).status).toBe(400)
    expect(await calls()).toEqual({ prayer: [], transcript: [] })
  })

  it('una ruta desconocida → 404', async () => {
    expect((await fetch(`${stub.url}/models`)).status).toBe(404)
  })

  it('reset vuelve al modo por defecto y vacía las llamadas', async () => {
    await setMode({ scenario: 'lectura-falla' })
    await read()
    await post('/__stub/reset', {})
    expect(await calls()).toEqual({ prayer: [], transcript: [] })
    expect((await read()).status).toBe(200)
    expect(await (await setMode({})).json()).toEqual({ prayerDelayMs: 4000, transcriptDelayMs: 0, transcriptText: null, scenario: null, match: null })
  })
})
