import { defineConfig } from 'drizzle-kit';
import { ENV_FILES, loadEnv, requireVar, resolveAppEnv } from './scripts/env';

// La rama de Neon se elige con APP_ENV (development por defecto): `bun run db:migrate:test`, etc.
const appEnv = resolveAppEnv();
loadEnv(appEnv);
console.info(`drizzle-kit → ${ENV_FILES[appEnv]} (APP_ENV=${appEnv})`);

export default defineConfig({
  out: './drizzle',
  schema: './server/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: requireVar(process.env, 'NUXT_DATABASE_URL', appEnv) },
});
