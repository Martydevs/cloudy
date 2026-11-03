// Formatos de la página YouTube (feature 005).

/** Duración «m:ss» o «h:mm:ss»; vacía si no se conoce (en vivo). */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Duración legible para lectores de pantalla («3 min 5 s»). */
export function spokenDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h ? `${h} h` : '', m ? `${m} min` : '', s || (!h && !m) ? `${s} s` : ''].filter(Boolean).join(' ')
}
