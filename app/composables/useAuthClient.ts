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

  /** Cierra la sesión, limpia el perfil y vuelve a /login aunque Neon Auth falle. */
  async function logout() {
    try {
      await signOut()
    }
    catch {
      // La cookie caduca sola; lo importante es salir de la UI privada.
    }
    clearMe()
    await navigateTo('/login')
  }

  async function requestPasswordReset(input: { email: string, redirectTo: string }) {
    const client = await getClient()
    unwrap(await client.requestPasswordReset(input))
  }

  async function resetPassword(input: { newPassword: string, token: string }) {
    const client = await getClient()
    unwrap(await client.resetPassword(input))
  }

  async function changePassword(input: { currentPassword: string, newPassword: string }) {
    const client = await getClient()
    unwrap(await client.changePassword({ ...input, revokeOtherSessions: false }))
  }

  async function updateUser(input: { name: string }) {
    const client = await getClient()
    unwrap(await client.updateUser(input))
  }

  return { signUp, signIn, signOut, logout, requestPasswordReset, resetPassword, changePassword, updateUser }
}
