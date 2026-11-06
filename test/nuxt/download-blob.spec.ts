// T042 — Descarga de un archivo ya en el navegador (feature 006): nombre por `filename*`/`filename`/respaldo, nombres
// seguros con tildes y eñes, y el `objectURL` para volver a descargar.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob, filenameFromDisposition, revokeDownload, safeFilename, triggerDownload } from '~/utils/download-blob'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('filenameFromDisposition', () => {
  it('filename* en UTF-8 primero, decodificando las tildes', () => {
    expect(filenameFromDisposition('attachment; filename="Cancion.pptx"; filename*=UTF-8\'\'Canci%C3%B3n.pptx')).toBe('Canción.pptx')
    expect(filenameFromDisposition('attachment; filename*=utf-8\'\'%C3%91and%C3%BA.pptx')).toBe('Ñandú.pptx')
  })

  it('luego filename (con o sin comillas) y luego el respaldo', () => {
    expect(filenameFromDisposition('attachment; filename="Señor.pptx"')).toBe('Señor.pptx')
    expect(filenameFromDisposition('attachment; filename=Simple.pptx')).toBe('Simple.pptx')
    expect(filenameFromDisposition('attachment')).toBe('canciones.pptx')
    expect(filenameFromDisposition(null)).toBe('canciones.pptx')
    expect(filenameFromDisposition(undefined, 'Mi canción.pptx')).toBe('Mi canción.pptx')
  })

  it('una codificación rota usa filename', () => {
    expect(filenameFromDisposition('attachment; filename="Bien.pptx"; filename*=UTF-8\'\'%E0%A4%A.pptx')).toBe('Bien.pptx')
  })

  it('quita lo que no vale en un nombre y conserva tildes y eñes', () => {
    expect(filenameFromDisposition('attachment; filename*=UTF-8\'\'..%2F..%2Fa%3Ab%3F.pptx')).toBe('.. .. a b .pptx')
    expect(safeFilename('Canción: «Señor» / 2?')).toBe('Canción «Señor» 2')
    expect(safeFilename('  ')).toBe('canciones.pptx')
    expect(safeFilename('.pptx')).toBe('canciones.pptx')
  })
})

describe('downloadBlob', () => {
  it('crea un objectURL, dispara un <a download> con el nombre y lo devuelve para volver a descargar', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cloudy/1')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('Canción.pptx')
      expect(this.getAttribute('href')).toBe('blob:cloudy/1')
    })
    const blob = new Blob(['x'])
    expect(downloadBlob(blob, 'attachment; filename*=UTF-8\'\'Canci%C3%B3n.pptx')).toEqual({ url: 'blob:cloudy/1', filename: 'Canción.pptx' })
    expect(create).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a[download]')).toBeNull()

    triggerDownload('blob:cloudy/1', 'Canción.pptx')
    expect(click).toHaveBeenCalledTimes(2)
  })

  it('revokeDownload libera el objectURL (y no hace nada sin uno)', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    revokeDownload('blob:cloudy/1')
    revokeDownload(null)
    expect(revoke).toHaveBeenCalledTimes(1)
  })
})
