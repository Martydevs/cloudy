// Cambiar el nombre visible (FR-030). El cliente también lo actualiza en Neon Auth (`update-user`).
import { eq } from 'drizzle-orm'
import type { Profile } from '#shared/types/api'
import { profileNameInput } from '#shared/validation/auth'
import { profiles } from '../db/schema'

export default defineEventHandler(async (event): Promise<Profile> => {
  const { profile } = requireActive(event)
  const { name } = await readValid(event, profileNameInput)
  const [updated] = await useDb()
    .update(profiles)
    .set({ name, updatedAt: new Date() })
    .where(eq(profiles.userId, profile.userId))
    .returning()
  return toProfile(updated!)
})
