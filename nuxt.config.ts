import tailwindcss from '@tailwindcss/vite';
import Sonda from 'sonda/nuxt';

// Sonda solo en `bun run analyze`: los builds normales (y Vercel) no generan reportes ni publican source maps.
const analyze = process.env.SONDA === '1';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/icon/module',
    '@nuxt/fonts',
    '@vueuse/nuxt/module',
    '@nuxt/image',
    '@nuxt/test-utils/module',
    Sonda({ enabled: analyze, server: true, gzip: true }),
  ],
  // Sonda mide desde los source maps; `hidden` los genera sin enlazarlos desde los bundles.
  sourcemap: {
    client: analyze ? 'hidden' : false,
  },
  // Valores sobrescritos por las variables NUXT_* (ver AGENTS.md). NUXT_NEON_JWKS_URL no se usa (R17).
  runtimeConfig: {
    databaseUrl: '',
    neonAuthBaseUrl: '',
    neonAuthCookieSecret: '',
    awsEndpointUrlS3: '',
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    awsRegion: '',
    s3Bucket: '',
    // Vacío en producción; los e2e usan `e2e/<runId>/` para aislar sus objetos.
    storageKeyPrefix: '',
    cronSecret: process.env.CRON_SECRET ?? '',
    rateLimitSalt: '',
    public: {
      siteUrl: '',
    },
  },
  // Los componentes se nombran por archivo (`ThemeToggle`, no `AppThemeToggle`); las carpetas solo agrupan.
  components: [{ path: '~/components', pathPrefix: false }],
  app: {
    head: {
      title: 'Cloudy',
      htmlAttrs: { lang: 'es' },
    },
  },
  icon: {
    serverBundle: { collections: ['lucide'] },
  },
  fonts: {
    families: [
      { name: 'DM Sans', provider: 'google', weights: [400, 500, 600, 700], subsets: ['latin', 'latin-ext'], global: true },
    ],
  },
  nitro: {
    // Necesario para `useEvent()` en el adaptador de Neon Auth (research R1).
    experimental: { asyncContext: true },
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  vite: {
    plugins: [
      tailwindcss({ optimize: true }),
    ],
  },
  css: ['~/assets/css/globals.css'],
});
