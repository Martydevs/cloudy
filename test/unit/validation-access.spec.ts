// Feature 003 — validadores de pedir acceso y del envío con permiso.
import { describe, expect, it } from 'vitest'
import { accessRequestInput, permittedSubmissionInput } from '../../shared/validation/access'
import { MAX_GUEST_FILES } from '../../shared/constants/files'

const file = { name: 'foto.jpg', size: 1000, mimeType: 'image/jpeg' }

describe('accessRequestInput', () => {
  it('acepta un nombre de 1 a 80 caracteres tras recortar espacios', () => {
    expect(accessRequestInput({ senderName: '  Eva  ' })).toEqual({ ok: true, data: { senderName: 'Eva' } })
    expect(accessRequestInput({ senderName: 'a' }).ok).toBe(true)
    expect(accessRequestInput({ senderName: 'a'.repeat(80) }).ok).toBe(true)
  })

  it('rechaza vacío, solo espacios y 81 caracteres', () => {
    expect(accessRequestInput({ senderName: '' })).toMatchObject({ ok: false, errors: { senderName: 'Este campo es obligatorio' } })
    expect(accessRequestInput({ senderName: '   ' })).toMatchObject({ ok: false, errors: { senderName: 'Este campo es obligatorio' } })
    expect(accessRequestInput({})).toMatchObject({ ok: false })
    expect(accessRequestInput({ senderName: 'a'.repeat(81) })).toMatchObject({ ok: false, errors: { senderName: expect.stringContaining('80') } })
  })
})

describe('permittedSubmissionInput', () => {
  it('acepta nota opcional (≤ 500) y de 1 a MAX_GUEST_FILES archivos', () => {
    expect(permittedSubmissionInput({ files: [file] })).toEqual({ ok: true, data: { note: undefined, files: [file] } })
    expect(permittedSubmissionInput({ note: 'Fotos', files: [file] })).toMatchObject({ ok: true, data: { note: 'Fotos' } })
    expect(permittedSubmissionInput({ files: Array.from({ length: MAX_GUEST_FILES }, () => file) }).ok).toBe(true)
    expect(permittedSubmissionInput({ note: 'a'.repeat(501), files: [file] })).toMatchObject({ ok: false, errors: { note: expect.stringContaining('500') } })
  })

  it('rechaza 0 y 21 archivos', () => {
    expect(MAX_GUEST_FILES).toBe(20)
    expect(permittedSubmissionInput({ files: [] })).toMatchObject({ ok: false, errors: { files: expect.any(String) } })
    expect(permittedSubmissionInput({ files: Array.from({ length: MAX_GUEST_FILES + 1 }, () => file) }).ok).toBe(false)
  })

  it('el nombre lo da la solicitud: un senderName en el cuerpo no se permite', () => {
    expect(permittedSubmissionInput({ senderName: 'Eva', files: [file] })).toMatchObject({ ok: false, errors: { senderName: 'Campo no permitido' } })
    expect(permittedSubmissionInput({ senderName: '', files: [file] })).toMatchObject({ ok: false, errors: { senderName: 'Campo no permitido' } })
  })
})
