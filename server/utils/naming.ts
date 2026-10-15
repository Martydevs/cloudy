// Sufijos ante nombres duplicados en la misma carpeta (edge case): `foto.jpg` → `foto (2).jpg`.

function splitName(name: string): [base: string, ext: string] {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return [name, '']
  return [name.slice(0, dot), name.slice(dot)]
}

/** Devuelve `name` o la primera variante con ` (n)` antes de la extensión que no esté en `taken` (sin distinguir mayúsculas). */
export function withSuffix(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(n => n.toLowerCase()))
  if (!used.has(name.toLowerCase())) return name
  const [base, ext] = splitName(name)
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}
