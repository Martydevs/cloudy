// Descarga de un archivo que ya está en el navegador (feature 006, contracts/ui.md): toma el nombre de `Content-Disposition`
// (`filename*` en UTF-8 primero, luego `filename`, luego el respaldo), dispara la descarga y devuelve el `objectURL` para
// volver a descargarlo sin pedirlo otra vez. Quien lo crea lo revoca con `revokeDownload` al descartarlo.

export const DEFAULT_PRESENTATION_NAME = 'canciones.pptx'

/** Quita lo que no vale en un nombre de archivo (/ \ : * ? " < > | y control) conservando tildes y eñes. */
export function safeFilename(name: string, fallback = DEFAULT_PRESENTATION_NAME): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean === '' || clean === '.pptx' ? fallback : clean
}

/** Nombre sugerido por la cabecera `Content-Disposition`. */
export function filenameFromDisposition(header: string | null | undefined, fallback = DEFAULT_PRESENTATION_NAME): string {
  if (!header) return fallback
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (star) {
    try {
      return safeFilename(decodeURIComponent(star[1]!.trim().replace(/^"|"$/g, '')), fallback)
    }
    catch {
      // Codificación rota: se usa `filename`.
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(header)
  const value = plain?.[1] ?? plain?.[2]?.trim()
  return value ? safeFilename(value, fallback) : fallback
}

/** Dispara la descarga de un `objectURL` con su nombre. */
export function triggerDownload(url: string, filename: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
}

/** Descarga `blob` con el nombre de su `Content-Disposition`; devuelve el `objectURL` y el nombre usado. */
export function downloadBlob(blob: Blob, disposition: string | null | undefined, fallback = DEFAULT_PRESENTATION_NAME): { url: string, filename: string } {
  const filename = filenameFromDisposition(disposition, fallback)
  const url = URL.createObjectURL(blob)
  triggerDownload(url, filename)
  return { url, filename }
}

export function revokeDownload(url: string | null | undefined): void {
  if (url) URL.revokeObjectURL(url)
}
