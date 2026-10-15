// Activa (o cambia de rol) un perfil en la rama de desarrollo, para pruebas manuales.
// Uso: bun scripts/dev-activate-user.ts <correo> [admin|editor]
// Solo hace un UPDATE; nunca borra nada. Con APP_ENV se elige otra rama (nunca producción por omisión).
import { neon } from '@neondatabase/serverless'
import { loadEnv, requireVar, resolveAppEnv } from './env'

const [email, role = 'editor'] = process.argv.slice(2)
if (!email || !['admin', 'editor'].includes(role)) {
  console.error('Uso: bun scripts/dev-activate-user.ts <correo> [admin|editor]')
  process.exit(1)
}

const appEnv = resolveAppEnv()
const sql = neon(requireVar(loadEnv(appEnv), 'NUXT_DATABASE_URL', appEnv))
const rows = await sql`
  UPDATE profiles SET status = 'active', role = ${role}, updated_at = now()
  WHERE email = ${email}
  RETURNING email, role, status
`
if (rows.length === 0) {
  console.error(`No existe un perfil con el correo ${email} en ${appEnv}. Regístralo primero en /registro.`)
  process.exit(1)
}
console.log(`${rows[0]!.email} → ${rows[0]!.status} (${rows[0]!.role}) en ${appEnv}`)
