// Crear una generación (enmienda «Página de generación», 2026-11-15): los grupos de la selección (uno por imagen, 1–4 ids
// cada uno, hasta 10). El servidor comprueba que cada petición siga disponible (`409 request_unavailable` con `data.ids`),
// guarda la generación y responde `201 { id }`; después el navegador encola sus imágenes con ese id.
import { setResponseHeader, setResponseStatus } from 'h3'
import type { PrayerGenerationCreated } from '#shared/types/api'
import { prayerGenerationInput } from '#shared/validation/prayers'

export default defineEventHandler(async (event): Promise<PrayerGenerationCreated> => {
  const { profile } = requireRole(event, 'editor')
  const { groups } = await readValid(event, prayerGenerationInput)
  const created = await createPrayerGeneration(groups, profile)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, 201)
  return created
})
