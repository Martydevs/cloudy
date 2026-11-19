// Detalle de un día de trabajo con su material resuelto (nombres actuales y hasta 50 elementos por adjunto).
import { setResponseHeader } from 'h3'
import type { WorkDayDetail } from '#shared/types/api'

export default defineEventHandler(async (event): Promise<WorkDayDetail> => {
  requireRole(event, 'editor')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getWorkDayDetail(paramId(event))
})
