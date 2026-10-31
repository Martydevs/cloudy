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
    '@regle/nuxt',
    Sonda({ enabled: analyze, server: true, gzip: true }),
  ],
  // Sonda mide desde los source maps; `hidden` los genera sin enlazarlos desde los bundles.
  sourcemap: {
    client: analyze ? 'hidden' : false,
  },
  // Valores sobrescritos por las variables NUXT_* (ver AGENTS.md). NUXT_NEON_JWKS_URL no se usa (R17).
  runtimeConfig: {
    databaseUrl: '',
    neonRealtimeUrl: '',
    neonRealtimeSecret: '',
    openrouterApikey: '',
    // Vacío = API de OpenRouter; solo los e2e lo apuntan a un stub local.
    openrouterBaseUrl: '',
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
  // Pendientes pasó a llamarse Solicitudes (feature 003, FR-024): los accesos guardados siguen funcionando.
  routeRules: {
    '/pendientes': { redirect: { to: '/solicitudes', statusCode: 301 } },
  },
  // Los componentes se nombran por archivo (`ThemeToggle`, no `AppThemeToggle`); las carpetas solo agrupan.
  components: [{ path: '~/components', pathPrefix: false }],
  app: {
    head: {
      title: 'Cloudy',
      htmlAttrs: { lang: 'es' },
      // SVG para los navegadores actuales (se lee en barras claras y oscuras); el .ico queda de respaldo (FR-041).
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },
  icon: {
    serverBundle: { collections: ['lucide'] },
  },
  fonts: {
    families: [
      {
        name: 'DM Sans',
        provider: 'google',
        weights: [400, 500, 600, 700],
        subsets: ['latin', 'latin-ext'],
        global: true,
        // CLS (Constitución I): con `swap`, en 4G el texto se reflujo al llegar la fuente (0,15 en el
        // Inicio). `optional` nunca la cambia tras el primer pintado: se usa si llegó en el bloqueo
        // inicial (~100 ms) o está en caché (desde la segunda página); si no, queda el respaldo con
        // métricas ajustadas. `preload` la pide junto con el CSS para que normalmente llegue a tiempo.
        display: 'optional',
        preload: true,
        // Respaldos con métricas de fontaine: Roboto cubre Android, donde no existe ninguno de los demás.
        fallbacks: ['Roboto', 'Segoe UI', 'Helvetica Neue', 'Arial', 'Noto Sans'],
      },
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
