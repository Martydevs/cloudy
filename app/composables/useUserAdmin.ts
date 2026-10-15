// Acciones del administrador sobre cuentas (FR-021, FR-022): activar, desactivar, reactivar,
// cambiar rol y eliminar, con confirmación, avisos y manejo del 409 "último administrador".
import type { Role } from '#shared/permissions'
import type { Profile } from '#shared/types/api'

export function useUserAdmin(onChanged: () => Promise<unknown> | void) {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { me, refreshMe } = useMe()
  const route = useRoute()
  const busyId = ref<string | null>(null)

  async function afterChange(user: Profile) {
    await Promise.all([onChanged(), refreshPulse()])
    // Si el admin cambió su propia cuenta, la matriz de acceso decide a dónde va (p. ej. /pendiente).
    if (user.userId === me.value?.user.id) {
      await refreshMe()
      const decision = resolveAccess(route.meta, me.value, route.fullPath)
      if ('redirect' in decision) await navigateTo(decision.redirect)
    }
  }

  async function run(user: Profile, task: () => Promise<void>, fallback: string) {
    busyId.value = user.userId
    try {
      await task()
      await afterChange(user)
    }
    catch (error) {
      toast.error(serverMessage(error, fallback))
    }
    finally {
      busyId.value = null
    }
  }

  const patch = (user: Profile, body: { status?: 'active' | 'disabled', role?: Role }) =>
    api<Profile>(`/api/users/${user.userId}`, { method: 'PATCH', body })

  return {
    busyId,
    activate: (user: Profile, role: Role) => run(user, async () => {
      await patch(user, { status: 'active', role })
      toast.success(`${user.name} ya puede entrar como ${ROLE_LABELS[role].toLowerCase()}`)
    }, 'No pudimos activar la cuenta. Inténtalo de nuevo.'),
    disable: (user: Profile) => run(user, async () => {
      await patch(user, { status: 'disabled' })
      toast.success(`La cuenta de ${user.name} quedó desactivada`)
    }, 'No pudimos desactivar la cuenta. Inténtalo de nuevo.'),
    reactivate: (user: Profile) => run(user, async () => {
      await patch(user, { status: 'active' })
      toast.success(`La cuenta de ${user.name} vuelve a estar activa`)
    }, 'No pudimos reactivar la cuenta. Inténtalo de nuevo.'),
    changeRole: (user: Profile, role: Role) => run(user, async () => {
      await patch(user, { role })
      toast.success(`${user.name} ahora es ${ROLE_LABELS[role].toLowerCase()}`)
    }, 'No pudimos cambiar el rol. Inténtalo de nuevo.'),
    remove: async (user: Profile) => {
      const ok = await confirm({
        title: `¿Eliminar la cuenta de ${user.name}?`,
        message: 'Perderá el acceso a Cloudy. Sus archivos y su historial se conservan.',
        confirmLabel: 'Eliminar cuenta',
        danger: true,
      })
      if (!ok) return
      await run(user, async () => {
        await api(`/api/users/${user.userId}`, { method: 'DELETE' })
        toast.success(`La cuenta de ${user.name} fue eliminada`)
      }, 'No pudimos eliminar la cuenta. Inténtalo de nuevo.')
    },
  }
}
