// Traduce los errores de Neon Auth (Better Auth) a mensajes accionables en español.
interface AuthLikeError {
  status?: number
  code?: string
}

export function authErrorMessage(error: unknown, fallback: string): string {
  const { status, code } = (error ?? {}) as AuthLikeError
  if (status === 429) return 'Demasiados intentos, espera unos minutos e inténtalo de nuevo.'
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
      return 'Correo o contraseña incorrectos.'
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.'
    case 'PASSWORD_TOO_SHORT':
      return 'La contraseña debe tener al menos 8 caracteres.'
    case 'INVALID_TOKEN':
      return 'El enlace caducó o ya se usó.'
  }
  if (status === 401) return 'Correo o contraseña incorrectos.'
  if (status && status >= 500) return 'El servicio de cuentas no responde. Inténtalo en unos minutos.'
  return fallback
}
