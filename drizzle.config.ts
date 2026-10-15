import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// `bun run db:migrate:test` fija DRIZZLE_TARGET=test para migrar la BD de pruebas.
const isTest = process.env.DRIZZLE_TARGET === 'test';
const variable = isTest ? 'NUXT_TEST_DATABASE_URL' : 'NUXT_DATABASE_URL';
const url = process.env[variable];

if (!url) {
  throw new Error(`Falta la variable de entorno ${variable} para drizzle-kit.`);
}

export default defineConfig({
  out: './drizzle',
  schema: './server/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url },
});
