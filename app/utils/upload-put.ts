// PUT directo al bucket con progreso (XMLHttpRequest: `fetch` no informa el progreso de subida).

export class UploadAbort extends Error {}

export function putWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (ratio: number) => void,
  register: (xhr: XMLHttpRequest) => void = () => {},
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    register(xhr)
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('network'))
    xhr.onabort = () => reject(new UploadAbort())
    xhr.send(body)
  })
}
