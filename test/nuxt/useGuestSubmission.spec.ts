// Envío de invitado con HEIC: cada HEIC se convierte a JPEG antes de pedir las firmas y se envía el JPEG en su lugar;
// si no se puede convertir, va la HEIC original. happy-dom no es un dispositivo Apple: las HEIC llevan su firma real
// para que se conviertan igual (D2a).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setResponseStatus } from 'h3'
import type { GuestUploadTicket } from '#shared/types/api'
import { calls, flush, mockApi, resetCalls } from './helpers/api'
import { behaviors, FakeXHR, resetXhr, sent } from './helpers/xhr'

const heic = vi.hoisted(() => ({ heicTo: vi.fn() }))
vi.mock('heic-to', () => ({ heicTo: heic.heicTo }))

const HEIC_HEADER = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])

const file = (name: string, type: string, size: number) => {
  const f = new File([type === 'image/heic' ? HEIC_HEADER : 'x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function mockSubmission() {
  mockApi('POST', '/api/public/submissions', (event) => {
    setResponseStatus(event, 201)
    const body = calls.at(-1)!.body as { files: unknown[] }
    const uploads: GuestUploadTicket[] = body.files.map((_, i) => ({
      fileId: `g${i + 1}`,
      uploadUrl: `https://s3.test/g${i + 1}`,
      headers: { 'content-type': 'image/jpeg' },
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

describe('useGuestSubmission · HEIC convertida a JPEG', () => {
  it('convierte cada HEIC antes de pedir las firmas y envía el JPEG con su nombre .jpg', async () => {
    let convert!: (blob: Blob) => void
    heic.heicTo.mockImplementation(() => new Promise<Blob>(resolve => (convert = resolve)))
    const submission = useGuestSubmission()
    submission.add([file('IMG_1.HEIC', 'image/heic', 3_000_000), file('foto.jpg', 'image/jpeg', 1000)])
    const done = submission.submit({ senderName: 'Eva', note: '' })
    await flush(20)

    // Mientras convierte no se crea el envío.
    expect(submission.items.value[0]).toMatchObject({ preparing: true })
    expect(calls.some(c => c.url === '/api/public/submissions')).toBe(false)
    expect(submission.status.value).toBe('submitting')

    convert(new Blob(['jpeg'], { type: 'image/jpeg' }))
    expect(await done).toEqual({ accepted: 2, rejected: 0 })
    const body = calls.find(c => c.url === '/api/public/submissions')!.body as { files: Record<string, unknown>[] }
    expect(body.files).toEqual([
      { name: 'IMG_1.jpg', size: 4, mimeType: 'image/jpeg' },
      { name: 'foto.jpg', size: 1000, mimeType: 'image/jpeg' },
    ])
    expect(sent).toEqual(['https://s3.test/g1', 'https://s3.test/g2'])
    expect(submission.items.value[0]).toMatchObject({ preparing: false, status: 'done', name: 'IMG_1.jpg', size: 4 })
  })

  it('si la conversión falla se envía la HEIC original', async () => {
    heic.heicTo.mockRejectedValue(new Error('libheif'))
    const submission = useGuestSubmission()
    submission.add([file('IMG_2.heic', 'image/heic', 3_000_000)])
    expect(await submission.submit({ senderName: 'Eva', note: '' })).toEqual({ accepted: 2, rejected: 0 })
    const body = calls.find(c => c.url === '/api/public/submissions')!.body as { files: Record<string, unknown>[] }
    expect(body.files).toEqual([{ name: 'IMG_2.heic', size: 3_000_000, mimeType: 'image/heic' }])
    expect(submission.items.value[0]).toMatchObject({ preparing: false, status: 'done', name: 'IMG_2.heic' })
  })

  it('si el envío falla y se reintenta, no vuelve a convertir', async () => {
    heic.heicTo.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))
    behaviors.set('https://s3.test/g1', 'network')
    const submission = useGuestSubmission()
    submission.add([file('IMG_3.heic', 'image/heic', 3_000_000)])
    expect(await submission.submit({ senderName: 'Eva', note: '' })).toBeNull()
    behaviors.clear()
    expect(await submission.submit({ senderName: 'Eva', note: '' })).toEqual({ accepted: 2, rejected: 0 })
    expect(heic.heicTo).toHaveBeenCalledTimes(1)
  })
})
