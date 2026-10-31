// Cabeceras de seguridad en toda respuesta de Nitro (páginas SSR, /api/**, redirecciones y errores).
// Va en un middleware y no en `routeRules` para que sea una sola unidad probada (test/unit/api-core.spec.ts)
// y no dependa del preset: en Vercel, `routeRules.headers` se vuelve configuración estática del
// enrutador y no pasa por el código. Los binarios nunca salen de aquí (302 a URLs firmadas del bucket),
// así que `nosniff` y `DENY` no afectan a la vista previa ni a las descargas.
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Nadie incrusta a Cloudy. El visor de PDF incrusta /api/files/:id/content, pero el navegador
  // evalúa esta cabecera en la respuesta final del bucket, no en nuestro 302.
  'X-Frame-Options': 'DENY',
  // Solo subidas de archivos, reproducción y la cámara de invitados (feature 003): ningún otro sensor ni pago.
  // `camera=(self)`: solo el propio origen; `camera=()` bloqueaba `getUserMedia` en todo el sitio.
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()',
} as const

export default defineEventHandler((event) => {
  setResponseHeaders(event, SECURITY_HEADERS)
})
