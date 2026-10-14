import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/icon/module', 
    '@nuxt/fonts', 
    '@vueuse/nuxt/module', 
    '@nuxt/image',
    '@nuxt/test-utils/module',
  ],
  runtimeConfig: {
    session: {
      password: ""
    },
    testDatabaseUrl: "",
    databaseUrl: "",
    neonAuthBaseUrl: "",
    neonAuthCookieSecret: ""
  },
  app: {
    head: {
      title: 'Cloudy',
      htmlAttrs: { lang: 'es' },
      meta: [{ name: 'theme-color', content: '#0a0a0a' }]
    }
  },
  fonts: {
    families: [
      { name: 'DM Sans', provider: 'google', weights: [400, 500, 600, 700], subsets: ['latin', 'latin-ext'], global: true }
    ]
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  vite: {
    plugins: [
      tailwindcss({optimize: true})
    ]
  },
  css: ["~/assets/css/globals.css"]
})
