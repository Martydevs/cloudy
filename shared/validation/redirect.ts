/** Solo rutas internas: empieza por `/`, no por `//` (ni `/\`) y no contiene `://`. */
export function isSafeRedirect(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.startsWith('/\\')
    && !value.includes('://')
}
