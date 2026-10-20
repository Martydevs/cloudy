import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
            '~~': fileURLToPath(new URL('.', import.meta.url)),
          },
        },
        test: {
          name: 'unit',
          include: ['test/unit/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          // La caché de módulos de Vitest 5 guarda la entrada virtual de @nuxt/test-utils y en la
          // siguiente corrida rompe sus imports relativos ("Failed to resolve ./error.js").
          fsModuleCache: false,
          // Arrancar Nuxt en el entorno tarda ~8-12 s en esta máquina: con el 10 s por defecto el `beforeAll` falla al azar.
          hookTimeout: 60000,
          include: ['test/nuxt/**/*.{test,spec}.ts'],
          environment: 'nuxt',
          environmentOptions: {
            nuxt: {
              rootDir: fileURLToPath(new URL('.', import.meta.url)),
              domEnvironment: 'happy-dom',
              // Las pruebas de componentes nunca leen credenciales de producción (.env).
              dotenv: { fileName: '.env.test' },
            },
          },
        },
      }),
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.{test,spec}.ts'],
          environment: 'node',
          globalSetup: ['test/e2e/setup/global-setup.ts'],
          testTimeout: 120000,
          hookTimeout: 300000,
          fileParallelism: false,
          // Red real (Neon) y transiciones de UI: 1 s por defecto es poco para `expect.poll`.
          expect: { poll: { timeout: 10000 } },
        },
      },
    ],
    coverage: {
      enabled: false,
      provider: 'v8',
      // Todo el producto. Sin exclusiones: los e2e cubren lo mismo contra Neon real, pero corren
      // en otro proceso y no suman cobertura.
      include: ['app/**/*.{ts,vue}', 'server/**/*.ts', 'shared/**/*.ts', 'scripts/env.ts'],
      // Fase 11: umbral subido de 90 a 92 en las cuatro métricas (la constitución pide 80).
      thresholds: { lines: 92, statements: 92, branches: 92, functions: 92 },
    },
  },
})
