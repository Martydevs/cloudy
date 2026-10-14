import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { RuntimeConfig } from 'nuxt/schema';

export const db = (config: RuntimeConfig) => {
  const sql = neon(config.databaseUrl);
  return drizzle({ client: sql });
};
