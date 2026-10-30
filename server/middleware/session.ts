// Resuelve una vez por petición la sesión y el perfil para `/api/**` (los guards leen `event.context.auth`).
const SKIP = ['/api/auth/', '/api/public/', '/api/cron/']
// Perfil diferido: el pulso se sondea cada 5 s y lee el perfil en el mismo `db.batch` que sus conteos (SC-002);
// aquí solo la sesión, que sale de la cookie firmada sin ir a Neon.
const DEFERRED_PROFILE = ['/api/realtime/pulse']

export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/') || SKIP.some(prefix => path.startsWith(prefix))) return

  const user = await getAuthUser(event)
  if (DEFERRED_PROFILE.some(prefix => path.startsWith(prefix))) {
    event.context.sessionUser = user
    return
  }
  event.context.auth = user ? { user, profile: await ensureProfile(user) } : null
})
