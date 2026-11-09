// Acciones del administrador sobre cuentas (FR-021, FR-022): activar, desactivar, reactivar,
// cambiar rol y eliminar, con confirmación, avisos y manejo del 409 "último administrador".
// `bulk` hace lo mismo con varias cuentas a la vez (selección múltiple de `/usuarios`).
// Desactivar a otra persona es reversible y no pregunta; desactivar la propia cuenta cierra el acceso al
// instante y solo otro administrador puede deshacerlo, así que se confirma.
import type { Role } from '#shared/permissions'
import type { Profile, UsersBatchResult } from '#shared/types/api'
import type { UserBatchAction } from '#shared/validation/users'

export function useUserAdmin(onChanged: () => Promise<unknown> | void) {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { me, refreshMe } = useMe()
  const route = useRoute()
  const busyId = ref<string | null>(null)
  /** Hay un cambio de varias cuentas en curso (barra de selección). */
  const bulkBusy = ref(false)

  async function afterChange(changedSelf: boolean) {
    await Promise.all([onChanged(), refreshPulse()])
    // Si el admin cambió su propia cuenta, la matriz de acceso decide a dónde va (p. ej. /pendiente).
    if (changedSelf) {
      await refreshMe()
      const decision = resolveAccess(route.meta, me.value, route.fullPath)
      if ('redirect' in decision) await navigateTo(decision.redirect)
    }
  }

  async function run(user: Profile, task: () => Promise<void>, fallback: string) {
    busyId.value = user.userId
    try {
      await task()
      await afterChange(isSelf(user))
    }
    catch (error) {
      toast.error(serverMessage(error, fallback))
    }
    finally {
      busyId.value = null
    }
  }

  const isSelf = (user: Profile) => user.userId === me.value?.user.id

  const patch = (user: Profile, body: { status?: 'active' | 'disabled', role?: Role }) =>
    api<Profile>(`/api/users/${user.userId}`, { method: 'PATCH', body })

  /**
   * Desactiva, elimina o cambia el rol de varias cuentas a la vez. Eliminar siempre se confirma; desactivar solo si la
   * propia cuenta está en la selección (el mismo aviso que al hacerlo de una en una). Avisa cuántas cambiaron y, si el
   * servidor se saltó alguna, por qué. Devuelve `true` si la petición se hizo (para limpiar la selección).
   */
  async function bulk(action: UserBatchAction, users: Profile[], role?: Role): Promise<boolean> {
    if (users.length === 0 || bulkBusy.value) return false
    const self = users.some(isSelf)
    if (action === 'remove') {
      const ok = await confirm({
        title: messages.users.bulkRemoveConfirm(users.length),
        message: messages.users.bulkRemoveHint(users.length, self),
        confirmLabel: users.length === 1 ? 'Eliminar cuenta' : 'Eliminar cuentas',
        danger: true,
      })
      if (!ok) return false
    }
    else if (action === 'disable' && self) {
      const ok = await confirm({
        title: messages.users.bulkDisableSelfConfirm(users.length),
        message: messages.users.bulkDisableSelfHint,
        confirmLabel: users.length === 1 ? 'Desactivar mi cuenta' : 'Desactivar cuentas',
        danger: true,
      })
      if (!ok) return false
    }

    bulkBusy.value = true
    try {
      const result = await api<UsersBatchResult>('/api/users/batch', {
        method: 'POST',
        body: { ids: users.map(user => user.userId), action, ...(action === 'role' ? { role } : {}) },
      })
      const lastAdmin = result.skipped.filter(item => item.reason === 'last_admin').length
      const message = messages.users.bulkDone(result.updated.length, lastAdmin, result.skipped.length - lastAdmin)
      if (result.updated.length > 0) toast.success(message)
      else toast.info(message)
      await afterChange(result.updated.includes(me.value?.user.id ?? ''))
      return true
    }
    catch (error) {
      toast.error(serverMessage(error, messages.users.bulkFailed))
      return false
    }
    finally {
      bulkBusy.value = false
    }
  }

  return {
    busyId,
    bulkBusy,
    bulk,
    activate: (user: Profile, role: Role) => run(user, async () => {
      await patch(user, { status: 'active', role })
      toast.success(messages.users.activated(user.name, ROLE_LABELS[role].toLowerCase()))
    }, messages.users.activateFailed),
    disable: async (user: Profile) => {
      if (isSelf(user)) {
        const ok = await confirm({
          title: '¿Desactivar tu propia cuenta?',
          message: 'Perderás el acceso a Cloudy en cuanto confirmes. Solo otro administrador podrá reactivarla.',
          confirmLabel: 'Desactivar mi cuenta',
          danger: true,
        })
        if (!ok) return
      }
      await run(user, async () => {
        await patch(user, { status: 'disabled' })
        toast.success(messages.users.disabled(user.name))
      }, messages.users.disableFailed)
    },
    reactivate: (user: Profile) => run(user, async () => {
      await patch(user, { status: 'active' })
      toast.success(messages.users.reactivated(user.name))
    }, messages.users.reactivateFailed),
    changeRole: (user: Profile, role: Role) => run(user, async () => {
      await patch(user, { role })
      toast.success(messages.users.roleChanged(user.name, ROLE_LABELS[role].toLowerCase()))
    }, messages.users.roleFailed),
    remove: async (user: Profile) => {
      const ok = await confirm(isSelf(user)
        ? {
            title: '¿Eliminar tu propia cuenta?',
            message: 'Perderás el acceso a Cloudy en cuanto confirmes. Tus archivos y tu historial se conservan.',
            confirmLabel: 'Eliminar mi cuenta',
            danger: true,
          }
        : {
            title: `¿Eliminar la cuenta de ${user.name}?`,
            message: 'Perderá el acceso a Cloudy. Sus archivos y su historial se conservan.',
            confirmLabel: 'Eliminar cuenta',
            danger: true,
          })
      if (!ok) return
      await run(user, async () => {
        await api(`/api/users/${user.userId}`, { method: 'DELETE' })
        toast.success(messages.users.removed(user.name))
      }, messages.users.removeFailed)
    },
  }
}
