// Días de trabajo de un rango de fechas (`?from&to`, hasta 62 días) para el calendario y la lista «Próximos días».
import { setResponseHeader } from 'h3'
import type { WorkDayList } from '#shared/types/api'
import { calendarRangeQuery } from '#shared/validation/calendar'

export default defineEventHandler(async (event): Promise<WorkDayList> => {
  requireRole(event, 'editor')
  const { from, to } = queryValid(event, calendarRangeQuery)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { items: await listWorkDays(from, to) }
})
