// Única definición de las secciones del dashboard; la barra lateral la filtra por rol.
// «Mi perfil» (/perfil) no es una sección: se llega desde el menú de cuenta al pie de la barra lateral.
import type { Role } from '#shared/permissions'

export interface NavItem {
  to: string
  label: string
  icon: string
  roles: Role[]
}

const TEAM: Role[] = ['editor', 'admin']

export const navItems: NavItem[] = [
  { to: '/', label: 'Inicio', icon: 'lucide:house', roles: TEAM },
  { to: '/archivos', label: 'Archivos', icon: 'lucide:folder', roles: TEAM },
  { to: '/pendientes', label: 'Pendientes', icon: 'lucide:inbox', roles: TEAM },
  { to: '/papelera', label: 'Papelera', icon: 'lucide:trash-2', roles: TEAM },
  { to: '/usuarios', label: 'Usuarios', icon: 'lucide:users', roles: ['admin'] },
  { to: '/actividad', label: 'Actividad', icon: 'lucide:activity', roles: ['admin'] },
]

/** `/` solo es activo en el inicio; el resto también en sus subrutas (p. ej. /archivos/:id). */
export function isNavActive(item: Pick<NavItem, 'to'>, path: string): boolean {
  return item.to === '/' ? path === '/' : path === item.to || path.startsWith(`${item.to}/`)
}
