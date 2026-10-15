// Resuelve una vez por petición la sesión y el perfil para `/api/**` (los guards leen `event.context.auth`).
const SKIP = ['/api/auth/', '/api/public/', '/api/cron/']

export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/') || SKIP.some(prefix => path.startsWith(prefix))) return

  const user = await getAuthUser(event)
  event.context.auth = user ? { user, profile: await ensureProfile(user) } : null
})
