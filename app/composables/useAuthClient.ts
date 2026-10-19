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

  async function signUp(input: { name: string, email: string, password: string }) {
    const client = await getClient()
    unwrap(await client.signUp.email(input))
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

  async function changePassword(input: { currentPassword: string, newPassword: string }) {
    const client = await getClient()
    unwrap(await client.changePassword({ ...input, revokeOtherSessions: false }))
  }

  async function updateUser(input: { name: string }) {
    const client = await getClient()
    unwrap(await client.updateUser(input))
  }

  return { signUp, signIn, signOut, logout, loggingOut, requestPasswordReset, resetPassword, changePassword, updateUser }
}
