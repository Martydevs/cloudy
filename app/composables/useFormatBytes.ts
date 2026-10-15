const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** Tamaños legibles en español: `1,5 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  const formatter = new Intl.NumberFormat('es', { maximumFractionDigits: exponent === 0 || value >= 100 ? 0 : 1 })
  return `${formatter.format(value)} ${UNITS[exponent]}`
}

export function useFormatBytes() {
  return { formatBytes }
}
