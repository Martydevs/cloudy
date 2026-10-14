import { createNeonAuth } from "@neondatabase/auth/next/server";
import { RuntimeConfig } from 'nuxt/schema';

export const auth = (config: RuntimeConfig) => {
  return createNeonAuth({
    baseUrl: config.neonAuthBaseUrl,
    cookies: {
      secret: config.neonAuthCookieSecret,
      // sessionDataTtl: 300, // optional session_data cache TTL in seconds (default: 300)
    },
    // logLevel: 'silent', // disable Managed Better Auth logging
    // logLevel: 'debug',  // verbose proxy/upstream logging
  });
};
