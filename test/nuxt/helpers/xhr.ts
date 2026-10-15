// XHR falso para las subidas directas al bucket: informa progreso y termina según `behaviors[url]`.
export type XhrBehavior = 'ok' | 'network' | 'hang' | number

export const behaviors = new Map<string, XhrBehavior>()
export const sent: string[] = []

export class FakeXHR {
  upload: { onprogress: ((e: { lengthComputable: boolean, loaded: number, total: number }) => void) | null } = { onprogress: null }
  status = 0
  url = ''
  headers: Record<string, string> = {}
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  open(_method: string, url: string) {
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send() {
    sent.push(this.url)
    const behavior = behaviors.get(this.url) ?? 'ok'
    if (behavior === 'hang') return
    setTimeout(() => {
      if (behavior === 'network') return this.onerror?.()
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
      this.status = behavior === 'ok' ? 200 : behavior
      this.onload?.()
    }, 0)
  }

  abort() {
    this.onabort?.()
  }
}

export function resetXhr() {
  behaviors.clear()
  sent.length = 0
}
