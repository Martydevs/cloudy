// Pistas `preconnect` para el almacenamiento (feature 007, T082): las fotos llegan por un 302 de `/api/files/:id/content` a una
// URL firmada de Neon Object Storage (estilo ruta, así que su host es el del endpoint). Abrir esa conexión junto con el HTML
// ahorra el saludo TCP + TLS después de la redirección. El origen ya va en cada URL firmada: no es un secreto.

/** `<link rel="preconnect">` al origen del endpoint de almacenamiento; nada si no es una URL http(s) válida. */
export function storagePreconnect(endpoint: string | undefined): { rel: 'preconnect', href: string }[] {
  if (!endpoint || !URL.canParse(endpoint)) return []
  const url = new URL(endpoint)
  return url.protocol === 'https:' || url.protocol === 'http:' ? [{ rel: 'preconnect', href: url.origin }] : []
}
