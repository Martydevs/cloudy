import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import type { FileItem, FolderItem, Me } from '#shared/types/api'
import { baseName } from '~/composables/useItemActions'
import { calls, failWith, flush, mockApi, resetCalls } from './helpers/api'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const auth = vi.hoisted(() => {
  const ok = () => Promise.resolve({ data: {}, error: null })
  return {
    client: {
      signUp: { email: vi.fn(ok) },
      signIn: { email: vi.fn(ok) },
      signOut: vi.fn(ok),
      requestPasswordReset: vi.fn(ok),
      resetPassword: vi.fn(ok),
      changePassword: vi.fn(ok),
      updateUser: vi.fn(ok),
    },
    createAuthClient: vi.fn(),
  }
})
vi.mock('@neondatabase/auth', () => ({ createAuthClient: auth.createAuthClient.mockImplementation(() => auth.client) }))

const me: Me = {
  user: { id: 'u1', email: 'a@x.org', name: 'Ana' },
  profile: { userId: 'u1', email: 'a@x.org', name: 'Ana', role: 'editor', status: 'active', createdAt: '' },
}

const file: FileItem = {
  id: 'f1', folderId: null, name: 'foto.jpg', extension: 'jpg', mimeType: 'image/jpeg', category: 'image', sizeBytes: 1,
  hasThumbnail: false, origin: 'team', uploadedBy: null, guestName: null, createdAt: '', updatedAt: '',
}
const folder: FolderItem = { id: 'd1', name: 'Domingo', parentId: null, createdAt: '', updatedAt: '' }

beforeEach(() => {
  navigateToMock.mockReset()
  resetCalls()
  useToast().toasts.value = []
  mockApi('GET', '/api/me', me)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useItemActions', () => {
  it('crea carpetas e informa si se agregó un sufijo', async () => {
    const changed = vi.fn()
    const actions = useItemActions(changed)
    mockApi('POST', '/api/folders', { ...folder, name: 'Domingo (2)' })
    actions.open({ type: 'create', parentId: null })
    await actions.submitName('Domingo')
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { name: 'Domingo', parentId: null } })
    expect(useToast().toasts.value.at(-1)?.message).toBe('Ya existía «Domingo»: se creó «Domingo (2)»')
    expect(changed).toHaveBeenCalledWith('created', 'folder', expect.objectContaining({ name: 'Domingo (2)' }))
    expect(actions.dialog.value).toBeNull()

    mockApi('POST', '/api/folders', folder)
    actions.open({ type: 'create', parentId: 'd0' })
    await actions.submitName('Domingo')
    expect(useToast().toasts.value.at(-1)?.message).toBe('Carpeta «Domingo» creada')
  })

  it('renombra archivos agregando su extensión y carpetas tal cual', async () => {
    const changed = vi.fn()
    const actions = useItemActions(changed)
    mockApi('PATCH', '/api/files/f1', { ...file, name: 'portada.jpg' })
    actions.open({ type: 'rename', kind: 'file', item: file })
    await actions.submitName('portada')
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: '/api/files/f1', body: { name: 'portada.jpg' } })

    mockApi('PATCH', '/api/folders/d1', { ...folder, name: 'Ensayo' })
    actions.open({ type: 'rename', kind: 'folder', item: folder })
    await actions.submitName('Ensayo')
    expect(calls.at(-1)).toMatchObject({ url: '/api/folders/d1', body: { name: 'Ensayo' } })
    expect(changed).toHaveBeenLastCalledWith('renamed', 'folder', expect.objectContaining({ name: 'Ensayo' }))
  })

  it('muestra el error del servidor en el diálogo y lo mantiene abierto', async () => {
    const actions = useItemActions(vi.fn())
    mockApi('PATCH', '/api/folders/d1', failWith(422, { errors: { name: 'No uses los caracteres / \\ : * ? " < > |' } }))
    actions.open({ type: 'rename', kind: 'folder', item: folder })
    await actions.submitName('a')
    expect(actions.serverError.value).toBe('No uses los caracteres / \\ : * ? " < > |')
    expect(actions.dialog.value?.type).toBe('rename')
    expect(actions.busy.value).toBe(false)
  })

  it('mueve archivos y carpetas; un fallo al mover avisa con un toast', async () => {
    const changed = vi.fn()
    const actions = useItemActions(changed)
    mockApi('PATCH', '/api/files/f1', { ...file, folderId: 'd1' })
    actions.open({ type: 'move', kind: 'file', item: file })
    await actions.submitMove('d1')
    expect(calls.at(-1)?.body).toEqual({ folderId: 'd1' })
    expect(useToast().toasts.value.at(-1)?.message).toBe('Se movió «foto.jpg»')

    mockApi('PATCH', '/api/folders/d1', failWith(409, undefined, 'No puedes mover una carpeta dentro de una de sus subcarpetas'))
    actions.open({ type: 'move', kind: 'folder', item: folder })
    await actions.submitMove(null)
    expect(calls.at(-1)?.body).toEqual({ parentId: null })
    // El endpoint simulado no transmite `message` (el servidor real sí; lo cubre el e2e del 422).
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'error', message: 'No pudimos mover el elemento. Inténtalo de nuevo.' })

    // Sin diálogo abierto no hace nada.
    actions.close()
    await actions.submitMove('d1')
    await actions.submitName('x')
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('pide confirmación con el número de elementos antes de enviar una carpeta a la papelera', async () => {
    const changed = vi.fn()
    const actions = useItemActions(changed)
    const confirm = useConfirm()
    mockApi('GET', '/api/folders/d1/count', { items: 3 })
    mockApi('DELETE', '/api/folders/d1', { trashedItems: 4 })

    const pending = actions.trash('folder', folder)
    await flush()
    expect(confirm.options.value).toMatchObject({ title: '¿Eliminar «Domingo»?', danger: true })
    expect(confirm.options.value?.message).toContain('Se enviarán 3 elementos a la papelera')
    confirm.accept()
    await pending
    expect(changed).toHaveBeenCalledWith('trashed', 'folder', folder)
    expect(useToast().toasts.value.at(-1)?.message).toBe('«Domingo» se envió a la papelera')
  })

  it('cancelar la confirmación no borra nada; un fallo se informa', async () => {
    const changed = vi.fn()
    const actions = useItemActions(changed)
    const confirm = useConfirm()
    mockApi('DELETE', '/api/files/f1', failWith(500))

    const canceled = actions.trash('file', file)
    await flush()
    expect(confirm.options.value?.message).toBe('Podrás restaurarlo desde la papelera durante 30 días.')
    confirm.cancel()
    await canceled
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)

    const failed = actions.trash('file', file)
    await flush()
    confirm.accept()
    await failed
    expect(changed).not.toHaveBeenCalled()
    expect(useToast().toasts.value.at(-1)).toMatchObject({ type: 'error', message: 'No pudimos eliminarlo. Inténtalo de nuevo.' })
  })

  it('baseName quita solo la extensión propia del archivo', () => {
    expect(baseName(file, 'file')).toBe('foto')
    expect(baseName({ ...file, name: 'raro' }, 'file')).toBe('raro')
    expect(baseName(folder, 'folder')).toBe('Domingo')
  })
})

// Las rutas de prueba no existen en el árbol tipado de Nitro: se usa `useApi` como fetch genérico.
const apiGet = (url: string) => (useApi() as unknown as (u: string) => Promise<unknown>)(url)

describe('useApi + plugin de errores', () => {
  it('401 limpia la sesión y lleva a login conservando la ruta', async () => {
    useMe().me.value = me
    mockApi('GET', '/api/x401', failWith(401))
    await expect(apiGet('/api/x401')).rejects.toBeTruthy()
    expect(useMe().me.value).toBeNull()
    expect(navigateToMock).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?redirect=/))
  })

  it('403 por estado de cuenta refresca el perfil y lleva a /pendiente', async () => {
    mockApi('GET', '/api/x403a', failWith(403, { reason: 'disabled' }))
    await expect(apiGet('/api/x403a')).rejects.toBeTruthy()
    expect(navigateToMock).toHaveBeenCalledWith('/pendiente')
    expect(calls.some(c => c.url === '/api/me')).toBe(true)
  })

  it('otro 403 lleva a acceso denegado; otros errores no navegan', async () => {
    mockApi('GET', '/api/x403b', failWith(403))
    await expect(apiGet('/api/x403b')).rejects.toBeTruthy()
    expect(navigateToMock).toHaveBeenCalledWith('/acceso-denegado')

    navigateToMock.mockReset()
    mockApi('GET', '/api/x500', failWith(500))
    await expect(apiGet('/api/x500')).rejects.toBeTruthy()
    expect(navigateToMock).not.toHaveBeenCalled()
    mockApi('GET', '/api/ok', { ok: true })
    expect(await apiGet('/api/ok')).toEqual({ ok: true })
  })
})

describe('useMe', () => {
  it('carga el perfil y deriva el rol; un 401 deja la sesión vacía', async () => {
    const { refreshMe, isActive, isEditor, isAdmin, clearMe, loaded } = useMe()
    await refreshMe()
    expect(isActive.value && isEditor.value && !isAdmin.value).toBe(true)
    mockApi('GET', '/api/me', failWith(401))
    expect(await refreshMe()).toBeNull()
    expect(isActive.value).toBe(false)
    clearMe()
    expect(loaded.value).toBe(true)
    mockApi('GET', '/api/me', me)
  })
})

describe('useAuthClient', () => {
  beforeEach(() => {
    for (const fn of [auth.client.signUp.email, auth.client.signIn.email, auth.client.signOut, auth.client.requestPasswordReset, auth.client.resetPassword, auth.client.changePassword, auth.client.updateUser]) {
      fn.mockClear()
    }
  })

  it('registra e inicia sesión contra el proxy y recarga el perfil', async () => {
    const client = useAuthClient()
    expect(await client.signUp({ name: 'Ana', email: 'a@x.org', password: '12345678' })).toEqual(me)
    expect(await client.signIn({ email: 'a@x.org', password: '12345678' })).toEqual(me)
    expect(auth.createAuthClient).toHaveBeenCalledTimes(1)
    expect(auth.createAuthClient.mock.calls[0]![0]).toMatch(/\/api\/auth$/)
  })

  it('convierte los errores de Better Auth en AuthRequestError', async () => {
    auth.client.signIn.email.mockResolvedValueOnce({ data: null, error: { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid' } } as never)
    await expect(useAuthClient().signIn({ email: 'a@x.org', password: 'x' })).rejects.toMatchObject({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' })
    auth.client.resetPassword.mockResolvedValueOnce({ data: null, error: { status: 400, statusText: 'Bad Request' } } as never)
    await expect(useAuthClient().resetPassword({ newPassword: '12345678', token: 't' })).rejects.toThrow('Bad Request')
  })

  it('recuperación, cambio de contraseña y nombre', async () => {
    const client = useAuthClient()
    await client.requestPasswordReset({ email: 'a@x.org', redirectTo: 'http://x/restablecer' })
    await client.resetPassword({ newPassword: '12345678', token: 't' })
    await client.changePassword({ currentPassword: 'a', newPassword: '12345678' })
    await client.updateUser({ name: 'Ana' })
    expect(auth.client.changePassword).toHaveBeenCalledWith({ currentPassword: 'a', newPassword: '12345678', revokeOtherSessions: false })
    expect(auth.client.requestPasswordReset).toHaveBeenCalledWith({ email: 'a@x.org', redirectTo: 'http://x/restablecer' })
  })

  it('logout cierra la sesión y vuelve a login aunque Neon Auth falle', async () => {
    useMe().me.value = me
    await useAuthClient().logout()
    expect(useMe().me.value).toBeNull()
    expect(navigateToMock).toHaveBeenCalledWith('/login')

    auth.client.signOut.mockRejectedValueOnce(new Error('red'))
    useMe().me.value = me
    await useAuthClient().logout()
    expect(useMe().me.value).toBeNull()
  })
})

describe('usePulsePolling', () => {
  it('pide un pulso al montar, guarda el contador y avanza el cursor', async () => {
    let n = 0
    mockApi('GET', '/api/realtime/pulse', () => ({ cursor: `2026-10-14T10:00:0${++n}.000Z`, pendingCount: n, newSubmissions: [] }))
    const Probe = defineComponent({
      setup() {
        const { poll } = usePulsePolling()
        return () => h('button', { onClick: poll }, 'pulso')
      },
    })
    const wrapper = await mountSuspended(Probe)
    await flush(10)
    const { pendingCount, cursor } = usePulse()
    expect(pendingCount.value).toBe(1)
    expect(cursor.value).toBe('2026-10-14T10:00:01.000Z')
    await wrapper.get('button').trigger('click')
    await flush(10)
    expect(pendingCount.value).toBe(2)

    // Un pulso fallido no rompe nada.
    mockApi('GET', '/api/realtime/pulse', failWith(500))
    await wrapper.get('button').trigger('click')
    await flush(10)
    expect(pendingCount.value).toBe(2)
    wrapper.unmount()
  })
})

describe('useUploadDialog', () => {
  it('abre en la carpeta indicada o en la raíz y avisa a las vistas', () => {
    const dialog = useUploadDialog()
    dialog.open('d1')
    expect([dialog.isOpen.value, dialog.folderId.value]).toEqual([true, 'd1'])
    dialog.open(null)
    expect(dialog.folderId.value).toBeNull()
    dialog.open()
    expect(dialog.folderId.value).toBeNull()
    const before = dialog.version.value
    dialog.notifyUploaded()
    expect(dialog.version.value).toBe(before + 1)
    dialog.close()
    expect(dialog.isOpen.value).toBe(false)
  })
})

describe('utilidades del cliente', () => {
  it('authErrorMessage traduce los códigos de Neon Auth', () => {
    expect(authErrorMessage({ status: 429 }, 'x')).toContain('Demasiados intentos')
    expect(authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 'x')).toBe('Correo o contraseña incorrectos.')
    expect(authErrorMessage({ code: 'USER_ALREADY_EXISTS' }, 'x')).toContain('Ya existe una cuenta')
    expect(authErrorMessage({ code: 'PASSWORD_TOO_SHORT' }, 'x')).toContain('8 caracteres')
    expect(authErrorMessage({ code: 'INVALID_TOKEN' }, 'x')).toBe('El enlace caducó o ya se usó.')
    expect(authErrorMessage({ status: 401 }, 'x')).toBe('Correo o contraseña incorrectos.')
    expect(authErrorMessage({ status: 503 }, 'x')).toContain('no responde')
    expect(authErrorMessage(null, 'Genérico')).toBe('Genérico')
  })

  it('fileIcon, formatBytes, menús y tiempo relativo', () => {
    expect(fileIcon('audio')).toBe('lucide:music')
    expect(useFileIcon().CATEGORY_LABELS.presentation).toBe('Presentaciones')
    expect(useFormatBytes().formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
    expect(fileMenuItems('f1', { includeOpen: false }).map(i => i.key)).toEqual(['download', 'rename', 'move', 'trash'])
    expect(folderMenuItems.map(i => i.key)).toEqual(['open', 'rename', 'move', 'trash'])
    expect(timeAgo(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe('hace 2 horas')
    expect(isNavActive({ to: '/archivos' }, '/archivos/d1')).toBe(true)
    expect(isNavActive({ to: '/' }, '/archivos')).toBe(false)
  })

  it('makeThumbnail genera WEBP de 320 px o devuelve null si no puede', async () => {
    expect(await makeThumbnail(new File(['x'], 'a.heic', { type: 'image/heic' }))).toBeNull()
    // happy-dom no decodifica imágenes: sin createImageBitmap se usa el ícono.
    expect(await makeThumbnail(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBeNull()

    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1280, height: 640, close })))
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob([`${this.width}x${this.height}`], { type: 'image/webp' }))
    })
    const thumb = await makeThumbnail(new File(['x'], 'a.png', { type: 'image/png' }))
    expect(await thumb!.text()).toBe('320x160')
    expect(close).toHaveBeenCalled()
    toBlob.mockRestore()
  })
})
