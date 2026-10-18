// Textos que comparten servidor y cliente (Constitución IV: una sola definición en `shared/`).
// El servidor los envía en la respuesta y el cliente los muestra aunque la respuesta no traiga mensaje.

/** 429 de cualquier endpoint (`hitRateLimit`); el cliente lo muestra para todo 429 (`serverMessage`). */
export const RATE_LIMITED_MESSAGE = 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'
