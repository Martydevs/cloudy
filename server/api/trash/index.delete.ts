// Vaciar la papelera completa: solo administradores (FR-035).
export default defineEventHandler(async (event): Promise<{ purged: number }> => {
  const { profile } = requireRole(event, 'admin')
  const purged = await purgeAll()
  if (purged > 0) {
    await activityInsert(profile, 'trash.empty', { type: 'trash', id: null, label: 'Papelera' }, { items: purged })
  }
  return { purged }
})
