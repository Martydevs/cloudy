// Los paquetes de idioma de SVAR no traen tipos. Solo los usa `app/components/calendar/WorkCalendar.vue`.
declare module '@svar-ui/core-locales' {
  export const es: Record<string, unknown> & { calendar: Record<string, unknown> }
}

declare module '@svar-ui/calendar-locales' {
  export const es: Record<string, unknown>
}
