import type { Me } from '#shared/types/api'

export default defineEventHandler((event): Me => {
  const { user, profile } = requireSession(event)
  return { user, profile: toProfile(profile) }
})
