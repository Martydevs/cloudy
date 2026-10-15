import { describe, expect, it } from 'vitest'
import { approveInput, rejectInput, submissionInput, submissionsQuery } from '../../shared/validation/submissions'
import { MAX_GUEST_FILES } from '../../shared/constants/files'

const FOLDER = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const file = { name: 'foto.jpg', size: 1000, mimeType: 'image/jpeg' }

describe('submissionInput', () => {
  it('acepta nombre, nota opcional y de 1 a 20 archivos válidos', () => {
    expect(submissionInput({ senderName: ' Eva ', files: [file] })).toEqual({
      ok: true,
      data: { senderName: 'Eva', note: undefined, files: [file] },
    })
    expect(submissionInput({ senderName: 'Eva', note: 'Fotos del domingo', files: [file] }).ok).toBe(true)
    expect(submissionInput({ senderName: 'Eva', note: '', files: [file] })).toMatchObject({ ok: true, data: { note: undefined } })
  })

  it('exige nombre de 1 a 80 y nota de hasta 500', () => {
    expect(submissionInput({ senderName: '', files: [file] })).toMatchObject({ ok: false, errors: { senderName: 'Este campo es obligatorio' } })
    expect(submissionInput({ senderName: 'a'.repeat(81), files: [file] })).toMatchObject({ ok: false, errors: { senderName: expect.stringContaining('80') } })
    expect(submissionInput({ senderName: 'Eva', note: 'a'.repeat(501), files: [file] })).toMatchObject({ ok: false, errors: { note: expect.stringContaining('500') } })
  })

  it('exige al menos un archivo y como máximo MAX_GUEST_FILES', () => {
    expect(submissionInput({ senderName: 'Eva', files: [] })).toMatchObject({ ok: false, errors: { files: 'Agrega al menos 1 archivos' } })
    expect(submissionInput({ senderName: 'Eva' })).toMatchObject({ ok: false, errors: { files: 'Este campo es obligatorio' } })
    expect(submissionInput({ senderName: 'Eva', files: Array.from({ length: MAX_GUEST_FILES + 1 }, () => file) }).ok).toBe(false)
    expect(submissionInput({ senderName: 'Eva', files: Array.from({ length: MAX_GUEST_FILES }, () => file) }).ok).toBe(true)
  })

  it('valida cada archivo con las reglas de subida', () => {
    expect(submissionInput({ senderName: 'Eva', files: [file, { ...file, name: 'virus.exe' }] })).toMatchObject({ ok: false, errors: { files: '2: Formato no admitido' } })
    expect(submissionInput({ senderName: 'Eva', files: [{ ...file, size: 0 }] })).toMatchObject({ ok: false, errors: { files: expect.stringMatching(/^1: /) } })
    expect(submissionInput({ senderName: 'Eva', files: ['x'] })).toMatchObject({ ok: false, errors: { files: expect.stringMatching(/^1: /) } })
  })
})

describe('approveInput, rejectInput y submissionsQuery', () => {
  it('approve admite raíz o carpeta uuid', () => {
    expect(approveInput({ folderId: null })).toEqual({ ok: true, data: { folderId: null } })
    expect(approveInput({})).toEqual({ ok: true, data: { folderId: null } })
    expect(approveInput({ folderId: FOLDER }).ok).toBe(true)
    expect(approveInput({ folderId: 'x' }).ok).toBe(false)
  })

  it('reject admite motivo opcional de hasta 300', () => {
    expect(rejectInput({})).toEqual({ ok: true, data: { reason: undefined } })
    expect(rejectInput({ reason: 'Borrosa' })).toEqual({ ok: true, data: { reason: 'Borrosa' } })
    expect(rejectInput({ reason: 'a'.repeat(301) }).ok).toBe(false)
  })

  it('la cola se filtra por un estado válido', () => {
    expect(submissionsQuery({})).toEqual({ ok: true, data: { status: undefined } })
    expect(submissionsQuery({ status: 'approved' }).ok).toBe(true)
    expect(submissionsQuery({ status: 'x' }).ok).toBe(false)
  })
})
