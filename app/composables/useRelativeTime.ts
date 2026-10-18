// Fechas relativas coherentes entre el servidor y la hidratación (US9).
// El servidor guarda la hora de su render en el estado (`useState`, viaja en el payload) y el cliente la
// usa como referencia mientras hidrata: aunque entre un render y otro pase un límite de minuto («hace 36
// minutos» → «hace 37 minutos»), el texto coincide y Vue no marca un desajuste. Ya hidratada la página
// (navegaciones en cliente, refrescos), manda el reloj real.
export function useRelativeTime() {
  const nuxtApp = useNuxtApp()
  const renderedAt = useState('rendered-at', () => Date.now())
  const now = () => (import.meta.server || nuxtApp.isHydrating ? renderedAt.value : Date.now())
  return {
    now,
    /** Igual que `timeAgo` de `app/utils/dates.ts`, con la referencia de tiempo segura para el SSR. */
    timeAgo: (iso: string) => timeAgo(iso, now()),
  }
}
