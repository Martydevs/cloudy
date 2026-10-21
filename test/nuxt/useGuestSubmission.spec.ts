// Envío de invitado con copia JPEG de las HEIC (feature 002, research A4): la conversión corre en paralelo
// con la subida del original y la copia se sube antes de `complete`; nunca impide el envío.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setResponseStatus } from 'h3'
import type { GuestUploadTicket } from '#shared/types/api'
import { calls, flush, mockApi, resetCalls } from './helpers/api'
import { behaviors, FakeXHR, resetXhr, sent } from './helpers/xhr'

const heic = vi.hoisted(() => ({ heicTo: vi.fn() }))
vi.mock('heic-to', () => ({ heicTo: heic.heicTo }))

const file = (name: string, type: string, size: number) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function mockSubmission() {
  mockApi('POST', '/api/public/submissions', (event) => {
    setResponseStatus(event, 201)
    const body = calls.at(-1)!.body as { files: { withTextSource: boolean }[] }
    const uploads: GuestUploadTicket[] = body.files.map((f, i) => ({
      fileId: `g${i + 1}`,
      uploadUrl: `https://s3.test/g${i + 1}`,
      headers: { 'content-type': 'image/heic' },
      ...(f.withTextSource ? { textSourceUploadUrl: `https://s3.test/textsrc/g${i + 1}.jpg` } : {}),
    }))
    return { submissionId: 'sub1', uploads }
  })
  mockApi('POST', '/api/public/submissions/sub1/complete', { status: 'pending', accepted: 2, rejected: 0 })
}

beforeEach(() => {
  resetCalls()
  resetXhr()
  heic.heicTo.mockReset()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  mockSubmission()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useGuestSubmission · copia JPEG de las HEIC', () => {
  it('pide withTextSource solo para HEIC aptas, convierte en paralelo y sube la copia antes de complete', async () => {
    let convert!: (blob: Blob) => void
    heic.heicTo.mockImplementation(() => new Promise<Blob>(resolve => (convert = resolve)))
    const submission = useGuestSubmission()
    submission.add([file('IMG_1.heic', 'image/heic', 3_000_000), file('foto.jpg', 'image/jpeg', 1000)])
    const done = submission.submit({ senderName: 'Eva', note: '' })
    await flush(20)

    const body = calls.find(c => c.url === '/api/public/submissions')!.body as { files: { name: string, withTextSource: boolean }[] }
    expect(body.files.map(f => [f.name, f.withTextSource])).toEqual([['IMG_1.heic', true], ['foto.jpg', false]])
    // Los originales ya subieron mientras la copia se sigue convirtiendo; complete espera a la copia.
    expect(sent).toEqual(['https://s3.test/g1', 'https://s3.test/g2'])
    expect(submission.items.value[0]).toMatchObject({ preparing: true })
    expect(calls.some(c => c.url === '/api/public/submissions/sub1/complete')).toBe(false)
    expect(submission.status.value).toBe('submitting')

    convert(new Blob(['jpeg'], { type: 'image/jpeg' }))
    expect(await done).toEqual({ accepted: 2, rejected: 0 })
    expect(sent).toEqual(['https://s3.test/g1', 'https://s3.test/g2', 'https://s3.test/textsrc/g1.jpg'])
    expect(submission.items.value[0]).toMatchObject({ preparing: false, status: 'done' })
  })

  it('si la copia falla el envío termina igual', async () => {
    heic.heicTo.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))
    behaviors.set('https://s3.test/textsrc/g1.jpg', 403)
    const submission = useGuestSubmission()
    submission.add([file('IMG_1.heic', 'image/heic', 3_000_000)])
    expect(await submission.submit({ senderName: 'Eva', note: '' })).toEqual({ accepted: 2, rejected: 0 })

    heic.heicTo.mockRejectedValue(new Error('libheif'))
    const again = useGuestSubmission()
    again.add([file('IMG_2.heic', 'image/heic', 3_000_000)])
    expect(await again.submit({ senderName: 'Eva', note: '' })).toEqual({ accepted: 2, rejected: 0 })
    expect(calls.filter(c => c.url === '/api/public/submissions/sub1/complete')).toHaveLength(2)
  })
})
