// Cliente de Neon Auth (API Better Auth) que habla con el proxy same-origin `/api/auth`.
// Se importa bajo demanda para no sumar su peso al JS inicial de cada ruta.

type AuthClient = Awaited<ReturnType<typeof createClient>>

async function createClient() {
  const { createAuthClient } = await import('@neondatabase/auth')
  return createAuthClient(`${window.location.origin}/api/auth`)
}

let clientPromise: Promise<AuthClient> | undefined

function getClient(): Promise<AuthClient> {
  if (!import.meta.client) throw new Error('El cliente de autenticación solo existe en el navegador')
  clientPromise ??= createClient()
  return clientPromise
}

export class AuthRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

interface BetterAuthResult<T> {
  data: T | null
  error: { message?: string, status: number, code?: string, statusText?: string } | null
}

function unwrap<T>(result: BetterAuthResult<T>): T {
  if (result.error) {
    throw new AuthRequestError(result.error.message ?? result.error.statusText ?? 'Error', result.error.status, result.error.code)
  }
  return result.data as T
}

export function useAuthClient() {
  const { refreshMe, clearMe } = useMe()
  const loggingOut = useState('auth-logging-out', () => false)

  /**
   * Un correo ya registrado llega de Better Auth como `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (422), pero el
   * cliente de Neon no conoce ese código y **lanza** `validation_failed`; solo el mensaje lo distingue. Sin esto la
   * página mostraba el error genérico en lugar de «Ya existe una cuenta con ese correo».
   */
  async function signUp(input: { name: string, email: string, password: string }) {
    const client = await getClient()
    try {
      unwrap(await client.signUp.email(input))
    }
    catch (error) {
      const { code, message, status } = (error ?? {}) as { code?: string, message?: string, status?: number }
      const exists = code === 'user_already_exists' || code === 'email_exists'
        || (code === 'validation_failed' && /already exists/i.test(message ?? ''))
      if (exists) throw new AuthRequestError(message ?? 'User already exists', status ?? 422, 'USER_ALREADY_EXISTS')
      throw error
    }
    return refreshMe()
  }

  async function signIn(input: { email: string, password: string }) {
    const client = await getClient()
    unwrap(await client.signIn.email(input))
    return refreshMe()
  }

  async function signOut() {
    const client = await getClient()
    unwrap(await client.signOut())
    clearMe()
  }

  /**
   * Cierra la sesión, limpia el perfil y vuelve a /login aunque Neon Auth falle. `loggingOut` se
   * comparte entre botones: mientras dura, los clics repetidos no lanzan otro cierre de sesión.
   */
  async function logout() {
    if (loggingOut.value) return
    loggingOut.value = true
    try {
      await signOut().catch(() => {
        // La cookie caduca sola; lo importante es salir de la UI privada.
      })
      clearMe()
      await navigateTo('/login')
    }
    finally {
      loggingOut.value = false
    }
  }

  async function requestPasswordReset(input: { email: string, redirectTo: string }) {
    const client = await getClient()
    unwrap(await client.requestPasswordReset(input))
  }

  /**
   * Un enlace caducado o ya usado llega como `INVALID_TOKEN` (400) de Better Auth, pero el cliente de
   * Neon lo normaliza y **lanza** `bad_jwt` (401, «Invalid or expired session token»), como si fuera
   * un problema de sesión: la página lo tomaba por «Correo o contraseña incorrectos» (T162, defecto 2).
   * Aquí se devuelve siempre el código de Better Auth, que es el que entiende `restablecer.vue`.
   */
  async function resetPassword(input: { newPassword: string, token: string }) {
    const client = await getClient()
    try {
      unwrap(await client.resetPassword(input))
    }
    catch (error) {
      const { code, message, status } = (error ?? {}) as { code?: string, message?: string, status?: number }
      if (code === 'bad_jwt' || code === 'INVALID_TOKEN') throw new AuthRequestError(message ?? 'Invalid token', status ?? 400, 'INVALID_TOKEN')
      throw error
    }
  }

  /**
   * Una contraseña actual incorrecta llega de Better Auth como `INVALID_PASSWORD` (400), pero el cliente de Neon
   * **lanza** `invalid_credentials` (401): la página mostraba «Correo o contraseña incorrectos» en lugar de «La
   * contraseña actual no es correcta». Aquí se devuelve el código de Better Auth, que es el que entiende `perfil.vue`.
   */
  async function changePassword(input: { currentPassword: string, newPassword: string }) {
    const client = await getClient()
    try {
      unwrap(await client.changePassword({ ...input, revokeOtherSessions: false }))
    }
    catch (error) {
      const { code, message, status } = (error ?? {}) as { code?: string, message?: string, status?: number }
      if (code === 'invalid_credentials') throw new AuthRequestError(message ?? 'Invalid password', status ?? 400, 'INVALID_PASSWORD')
      throw error
    }
  }

  async function updateUser(input: { name: string }) {
    const client = await getClient()
    unwrap(await client.updateUser(input))
  }

  return { signUp, signIn, signOut, logout, loggingOut, requestPasswordReset, resetPassword, changePassword, updateUser }
}
