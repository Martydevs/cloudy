import { describe, expect, it } from 'vitest'
import {
  checkUploadFile,
  ensureExtension,
  fileRenameInput,
  folderInput,
  folderPatchInput,
  listQuery,
  sanitizeFileName,
  uploadInput,
} from '../../shared/validation/files'
import { ACCEPT_ATTRIBUTE, canonicalMime, categoryOf, getExtension, isAllowed } from '../../shared/constants/files'

const FOLDER = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('folderInput', () => {
  it.each(['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b'])('rechaza "%s"', (name) => {
    const res = folderInput({ name, parentId: null })
    expect(res).toEqual({ ok: false, errors: { name: 'No uses los caracteres / \\ : * ? " < > |' } })
  })

  it('rechaza vacío y más de 120 caracteres', () => {
    expect(folderInput({ name: '  ', parentId: null }).ok).toBe(false)
    expect(folderInput({ name: 'a'.repeat(121), parentId: null }).ok).toBe(false)
    expect(folderInput({ name: 'a'.repeat(120), parentId: null }).ok).toBe(true)
  })

  it('acepta raíz o una carpeta uuid', () => {
    expect(folderInput({ name: 'Domingo', parentId: null })).toEqual({ ok: true, data: { name: 'Domingo', parentId: null } })
    expect(folderInput({ name: 'Domingo', parentId: FOLDER }).ok).toBe(true)
    expect(folderInput({ name: 'Domingo', parentId: 'x' }).ok).toBe(false)
  })
})

describe('folderPatchInput y fileRenameInput', () => {
  it('exigen al menos un cambio', () => {
    expect(folderPatchInput({}).ok).toBe(false)
    expect(fileRenameInput({}).ok).toBe(false)
  })

  it('distinguen "no mover" de "mover a la raíz"', () => {
    expect(fileRenameInput({ name: 'nuevo.jpg' })).toEqual({ ok: true, data: { name: 'nuevo.jpg', folderId: undefined } })
    expect(fileRenameInput({ folderId: null })).toEqual({ ok: true, data: { name: undefined, folderId: null } })
    expect(folderPatchInput({ parentId: FOLDER })).toEqual({ ok: true, data: { name: undefined, parentId: FOLDER } })
  })

  it('limita el nombre de archivo a 200 caracteres', () => {
    expect(fileRenameInput({ name: `${'a'.repeat(197)}.jpg` }).ok).toBe(false)
    expect(fileRenameInput({ name: `${'a'.repeat(196)}.jpg` }).ok).toBe(true)
  })
})

describe('uploadInput', () => {
  const valid = { folderId: null, name: 'foto.jpg', size: 1024, mimeType: 'image/jpeg', withThumbnail: true }

  it('acepta un archivo permitido', () => {
    expect(uploadInput(valid).ok).toBe(true)
  })

  it('rechaza tamaño 0 y 104 857 601 bytes', () => {
    expect(uploadInput({ ...valid, size: 0 }).ok).toBe(false)
    expect(uploadInput({ ...valid, size: 104_857_601 }).ok).toBe(false)
    expect(uploadInput({ ...valid, size: 104_857_600 }).ok).toBe(true)
  })

  it('rechaza extensiones no permitidas o MIME incoherente', () => {
    expect(uploadInput({ ...valid, name: 'virus.exe', mimeType: 'application/x-msdownload' }))
      .toEqual({ ok: false, errors: { name: 'Formato no admitido' } })
    expect(uploadInput({ ...valid, mimeType: 'video/mp4' }).ok).toBe(false)
    expect(uploadInput({ ...valid, name: 'sin-extension' }).ok).toBe(false)
  })

  it('acepta MIME vacío (el navegador no lo reconoció)', () => {
    expect(uploadInput({ ...valid, name: 'deck.key', mimeType: '' }).ok).toBe(true)
  })

  it('rechaza nombres de más de 200 caracteres', () => {
    expect(uploadInput({ ...valid, name: `${'a'.repeat(197)}.jpg` }).ok).toBe(false)
  })
})

describe('checkUploadFile', () => {
  it('formato no admitido (415) antes que el tamaño', () => {
    expect(checkUploadFile({ name: 'setup.exe', size: 200 * 1024 * 1024, type: '' }))
      .toEqual({ code: 415, message: '«setup.exe»: formato no admitido' })
  })
  it('supera 100 MB (413)', () => {
    expect(checkUploadFile({ name: 'culto.mp4', size: 120 * 1024 * 1024, type: 'video/mp4' }))
      .toEqual({ code: 413, message: '«culto.mp4» supera 100 MB' })
  })
  it('sin problemas', () => {
    expect(checkUploadFile({ name: 'culto.mp4', size: 1, type: 'video/mp4' })).toBeNull()
  })
})

describe('utilidades de nombres', () => {
  it('sanitizeFileName reemplaza caracteres prohibidos y recorta conservando la extensión', () => {
    expect(sanitizeFileName('Ensayo: coro/voces?.mp3')).toBe('Ensayo- coro-voces-.mp3')
    const long = sanitizeFileName(`${'a'.repeat(300)}.pptx`)
    expect(long).toHaveLength(200)
    expect(long.endsWith('.pptx')).toBe(true)
    expect(sanitizeFileName('///')).toBe('---')
  })

  it('ensureExtension conserva la extensión original', () => {
    expect(ensureExtension('nuevo', 'jpg')).toBe('nuevo.jpg')
    expect(ensureExtension('nuevo.JPG', 'jpg')).toBe('nuevo.JPG')
    expect(ensureExtension('nuevo.png', 'jpg')).toBe('nuevo.png.jpg')
  })
})

describe('listQuery', () => {
  it('valida orden, dirección y tipo', () => {
    expect(listQuery({ sort: 'size', dir: 'asc', type: 'audio' }).ok).toBe(true)
    expect(listQuery({ sort: 'peso' }).ok).toBe(false)
    expect(listQuery({ type: 'zip' }).ok).toBe(false)
    expect(listQuery({}).ok).toBe(true)
  })
})

describe('constantes de archivos', () => {
  it('getExtension', () => {
    expect(getExtension('Foto.JPG')).toBe('jpg')
    expect(getExtension('.env')).toBe('')
    expect(getExtension('archivo.')).toBe('')
    expect(getExtension('sin')).toBe('')
  })
  it('categoryOf e isAllowed', () => {
    expect(categoryOf('MP3')).toBe('audio')
    expect(categoryOf('exe')).toBeNull()
    expect(isAllowed('mp3', 'audio/mpeg; charset=binary')).toBe(true)
    expect(isAllowed('mp3', 'application/octet-stream')).toBe(true)
    expect(isAllowed('mp3', 'image/png')).toBe(false)
  })
  it('canonicalMime', () => {
    expect(canonicalMime('mp3', '')).toBe('audio/mpeg')
    expect(canonicalMime('mp3', 'audio/mp3')).toBe('audio/mp3')
    expect(canonicalMime('exe', 'x/y')).toBe('x/y')
  })
  it('ACCEPT_ATTRIBUTE lista las extensiones', () => {
    expect(ACCEPT_ATTRIBUTE).toContain('.pptx')
    expect(ACCEPT_ATTRIBUTE.split(',')).toHaveLength(21)
  })
})
