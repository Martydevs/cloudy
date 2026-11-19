// Calendario de días de trabajo (`/calendario`): límites, valores permitidos y sus textos. Los usan los validadores
// (`shared/validation/calendar.ts`), el servidor y los formularios, así no se repiten.

export const DEFAULT_AUDITORIUM = 'Skykids Auditorium'

export const WORK_DAY_TITLE_MAX = 120
export const WORK_DAY_AUDITORIUM_MAX = 80
/** Rangos de hora por día. */
export const WORK_DAY_MAX_SLOTS = 6
export const WORK_DAY_MAX_MEMBERS = 30
/** Adjuntos por tipo (colecciones, listas o carpetas) en un día. */
export const WORK_DAY_MAX_MATERIALS = 20
/** Elementos que el detalle muestra de cada colección o lista adjunta. */
export const WORK_DAY_MATERIAL_ITEMS = 50
/** Días que admite una consulta por rango: un mes completo con holgura para dos. */
export const CALENDAR_MAX_RANGE_DAYS = 62
/** Días que cubre la lista «Próximos días», contando hoy. */
export const UPCOMING_WORK_DAYS = 30

/**
 * Zona horaria de la iglesia. Las horas de un día son «de pared» y no llevan zona; esto solo decide qué fecha es «hoy»
 * para que el servidor (UTC) y el navegador coincidan en la lista «Próximos días».
 */
export const CALENDAR_TIME_ZONE = 'America/Monterrey'

export const WORK_DAY_KINDS = ['normal', 'special'] as const
export type WorkDayKind = (typeof WORK_DAY_KINDS)[number]

export const WORK_DAY_STATUSES = ['not_started', 'in_progress', 'finished'] as const
export type WorkDayStatus = (typeof WORK_DAY_STATUSES)[number]

export const WORK_DAY_KIND_LABELS: Record<WorkDayKind, string> = { normal: 'Normal', special: 'Especial' }
export const WORK_DAY_STATUS_LABELS: Record<WorkDayStatus, string> = {
  not_started: 'Sin iniciar',
  in_progress: 'En proceso',
  finished: 'Finalizado',
}

export const WORK_DAY_MATERIAL_TYPES = ['song_collection', 'youtube_playlist', 'folder'] as const
export type WorkDayMaterialType = (typeof WORK_DAY_MATERIAL_TYPES)[number]

export const USUAL_WORK_DAY_HINT = 'Los miércoles y domingos suelen ser días normales'

export const CALENDAR_MESSAGES = {
  kindRequired: 'Elige si es un día normal o especial',
  date: 'Elige una fecha válida',
  time: 'Escribe una hora válida',
  slotOrder: 'La hora de fin debe ser posterior a la de inicio',
  slotOverlap: 'Este rango se cruza con otro',
  slotsMin: 'Agrega al menos un rango de hora',
  slotsMax: `Puedes agregar como máximo ${WORK_DAY_MAX_SLOTS} rangos de hora`,
  membersMax: `Puedes elegir como máximo ${WORK_DAY_MAX_MEMBERS} miembros`,
  materialsMax: `Puedes adjuntar como máximo ${WORK_DAY_MAX_MATERIALS} de cada tipo`,
  range: `Elige un rango de hasta ${CALENDAR_MAX_RANGE_DAYS} días`,
  notFound: 'Ese día ya no está en el calendario.',
  memberUnavailable: 'Una de las personas elegidas ya no está activa. Revisa los miembros e inténtalo de nuevo.',
  materialUnavailable: 'Parte del material elegido ya no existe. Revísalo e inténtalo de nuevo.',
} as const
